import { loadModels, locate, route, findRoom } from './ai.js';
import { listen, speak } from './voice.js';
import { $, show } from './ui.js';
import { startHeading, stopHeading, getHeading, hasCompass } from './heading.js';
import { xrSupported, startXR } from './xr.js';

let tour, cur, dest, path, linkYaw = null, offset = 0, heading = 0, pitch = 0, stream, gotAbs = false, last = '', raf = 0, canXR = false, auto = 0, busy = false, goal = null;
const n180 = a => ((a % 360) + 540) % 360 - 180;
const name = id => tour.nodes.find(n => n.id === id).name;
const errorText = error => `${error && error.name ? error.name + ': ' : ''}${error && error.message ? error.message : String(error)}`;
function debug(text, level = 'info'){
  const log = $('arDebugLog');
  if(!log) return;
  const line = document.createElement('div');
  const time = new Date().toLocaleTimeString();
  line.className = level;
  line.textContent = `${time} ${text}`;
  log.append(line);
  while(log.children.length > 30) log.firstElementChild.remove();
  log.scrollTop = log.scrollHeight;
  $('arDebugState').textContent = text;
}
const onAbs = e => { if(e.alpha != null){ gotAbs = true; heading = (360 - e.alpha) % 360; } if(e.beta != null) pitch = 90 - e.beta; };
const onRel = e => {
  if(e.beta != null) pitch = 90 - e.beta;                      // how far the phone looks down
  if(!gotAbs) heading = e.webkitCompassHeading != null ? e.webkitCompassHeading : (360 - (e.alpha||0)) % 360;
};

async function startCam(){
  stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' } });
  $('cam').srcObject = stream;
}

export async function openAR(t, back){
  tour = t; cur = dest = path = linkYaw = null; offset = 0; goal = { tour }; show('ar');
  $('arDebugLog').replaceChildren(); $('arDebug').open = true;
  debug(`Starting scene comparison for ${t.nodes.length} saved spots`);
  const ask = typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission
    ? DeviceOrientationEvent.requestPermission() : Promise.resolve('granted');   // must start on the tap (iPhone)
  const msg = m => $('arMsg').textContent = m;
  msg('Loading AI...');
  try{
    await loadModels(m => { msg(m); debug(m); });
    debug('Scene-matching models ready');
  }catch(error){
    debug(`AI model loading failed: ${errorText(error)}`, 'error');
    msg(`AI models could not load: ${errorText(error)}. See Diagnostics.`);
    return;
  }
  try{ debug(`Motion permission: ${await ask}`); }
  catch(error){ debug(`Motion permission request failed: ${errorText(error)}`, 'error'); }
  try{
    await startCam();
    debug(`Camera ready (${ $('cam').videoWidth || 'waiting for video' } x ${ $('cam').videoHeight || 'waiting' })`);
  }catch(error){
    debug(`Camera start failed: ${errorText(error)}`, 'error');
    msg(`Camera could not start: ${errorText(error)}. Check permission. See Diagnostics.`);
    return;
  }
  canXR = /Android/i.test(navigator.userAgent) && await xrSupported();
  $('arXR').hidden = !canXR;
  $('arXR').onclick = async () => {
    if(linkYaw == null || !dest) return;
    const turn = n180(linkYaw - (heading + offset));
    stream && stream.getTracks().forEach(t => t.stop());          // free the camera for the AR session
    await startXR({ turn, label: name(dest), onEnd: () => startCam() });
  };
  addEventListener('deviceorientationabsolute', onAbs, true); startHeading(); addEventListener('deviceorientation', onRel, true);
  const sel = $('arDest'); sel.innerHTML = '<option value="">Where to?</option>';
  t.nodes.forEach(n => sel.add(new Option(n.name, n.id)));
  sel.onchange = () => { dest = sel.value || null; plan(); };
  $('arMic').onclick = () => listen(async q => { const n = await findRoom(t.nodes, q); sel.value = n.id; dest = n.id; plan(); });
  $('arLook').onclick = () => look(false);
  auto = setInterval(async () => {                      // checks your spot by itself
    if(busy || (cur && (!dest || (cur === dest && goal && goal.tour === tour)))) return;
    busy = true; try{ await look(true); } finally { busy = false; }
  }, 3500);
  $('arBack').onclick = () => { close(); back(); };
  raf = requestAnimationFrame(render);
  heading = getHeading();
  msg('Hold the phone upright, point into the room or at its label, then tap "Where am I?"');
}

async function look(silent){
  debug(`${silent ? 'Automatic' : 'Manual'} scene check started`);
  const v = $('cam'); if(!v.videoWidth){ debug('Camera frame not ready yet', 'error'); return; }          // camera not ready (for example during AR path)
  if(!silent) $('arMsg').textContent = 'Looking...';
  const h0 = getHeading();                               // the compass heading at the moment of the picture
  let c, mean, sd;
  try{
    c = document.createElement('canvas'); c.width = c.height = 512;
    const s = Math.min(v.videoWidth, v.videoHeight);
    c.getContext('2d').drawImage(v, (v.videoWidth-s)/2, (v.videoHeight-s)/2, s, s, 0, 0, 512, 512);
    const t = document.createElement('canvas'); t.width = t.height = 64; const tg = t.getContext('2d'); tg.drawImage(c, 0, 0, 64, 64);
    const px = tg.getImageData(0, 0, 64, 64).data; let sum = 0, sum2 = 0;      // a dark or blank picture is never used
    for(let i = 0; i < px.length; i += 4){ const y = .299*px[i] + .587*px[i+1] + .114*px[i+2]; sum += y; sum2 += y*y; }
    const cnt = px.length / 4; mean = sum / cnt; sd = Math.sqrt(sum2 / cnt - mean*mean);
  }catch(error){
    debug(`Camera frame capture failed: ${errorText(error)}`, 'error');
    if(!silent) $('arMsg').textContent = `Camera frame capture failed: ${errorText(error)}. See Diagnostics.`;
    return;
  }
  debug(`Frame quality: brightness ${mean.toFixed(1)}/255, detail ${sd.toFixed(1)} (need 35 and 12)`);
  if(mean < 35 || sd < 12){ debug('Frame too dark or unclear; comparison skipped', 'error'); if(!silent) $('arMsg').textContent = 'The camera sees nothing clear. Check that it is on and not covered.'; return; }
  try{
    const started = performance.now();
    const r = await locate(tour.nodes, c.toDataURL('image/jpeg', 0.85), false, result => {
      debug(`Compare ${result.accepted ? 'matched' : 'rejected'}: ${result.room}, score ${result.score.toFixed(3)}, z ${result.z.toFixed(2)}, margin ${result.margin.toFixed(3)} (${result.candidates} views); content: ${result.semantic} ${(result.semanticConf * 100).toFixed(0)}%${result.usedSemantic ? ', content cue selected this spot' : ''}${result.visualRoom !== result.room ? `; visual match: ${result.visualRoom}` : ''}`);
    });
    debug(`Scene comparison took ${(performance.now() - started).toFixed(0)} ms`);
    if(!r){ if(!silent) $('arMsg').textContent = 'I can’t tell which nearby room this is yet. Point farther inside the room or at its label, hold still, and try again.'; return; }
    if(silent && r.node.id === cur){ offset = n180(offset + 0.25 * n180((r.yaw - h0) - offset)); return; }   // same spot: arrows stay steady, direction improves slowly
    cur = r.node.id; offset = n180(r.yaw - h0);            // ties the compass to the panorama
    debug(`Current spot: ${name(cur)}`);
    plan();
  }catch(error){
    debug(`Scene comparison failed: ${errorText(error)}`, 'error');
    if(!silent) $('arMsg').textContent = `Scene comparison failed: ${errorText(error)}. See Diagnostics.`;
  }
}
function plan(){
  linkYaw = null; path = null; $('arXR').hidden = true;
  if(!cur){ $('arMsg').textContent = 'Looking for your spot... point the camera around.'; return; }
  if(!dest){ $('arMsg').textContent = 'You are in ' + name(cur) + '. Pick where to go.'; return; }
  path = route(tour.nodes, cur, dest);
  if(!path){ $('arMsg').textContent = 'No route found.'; return; }
  if(path.length === 1){ $('arMsg').textContent = 'You have arrived: ' + name(dest); speak('You have arrived'); return; }
  linkYaw = tour.nodes.find(n => n.id === cur).links.find(l => l.to === path[1]).yaw;
  $('arXR').hidden = !(canXR && linkYaw != null);
}

// ---- every frame: work out the turn, then paint chevrons lying on the floor ----
function render(t){
  raf = requestAnimationFrame(render);
  const cv = $('arCv'), W = cv.clientWidth, H = cv.clientHeight, dpr = devicePixelRatio || 1;
  if(cv.width !== Math.round(W*dpr)){ cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,W,H);
  const arrow = $('arrow'); if(linkYaw == null){ arrow.hidden = true; return; }
  if(!hasCompass()){ $('arMsg').textContent = 'No compass on this device. Test AR on a phone.'; arrow.hidden = true; return; }  const a = n180(linkYaw - (heading + offset));
  const text = Math.abs(a) < 25 ? 'Walk forward' : Math.abs(a) > 150 ? 'Turn around' : a > 0 ? 'Turn right' : 'Turn left';
  $('arMsg').textContent = text + ' to ' + name(dest);
  if(text !== last){ last = text; speak(text); }
  arrow.hidden = Math.abs(a) <= 45;                          // side arrow only when the route is off screen
  if(!arrow.hidden) arrow.style.transform = `rotate(${a}deg)`;
  floor(g, W, H, a, t);
}

function floor(g, W, H, aDeg, t){
  const hc = 1.4, F = (H/2) / Math.tan(32*Math.PI/180), p = pitch*Math.PI/180, a = aDeg*Math.PI/180;
  const sA = Math.sin(a), cA = Math.cos(a), sp = Math.sin(p), cp = Math.cos(p);
  const proj = (l, s, d) => {                                 // a point on the floor -> a point on the screen
    const X = d*sA + l*cA + s*sA, Z = d*cA - l*sA + s*cA, zc = hc*sp + Z*cp, yc = -hc*cp + Z*sp;
    return zc > 0.2 ? [W/2 + F*X/zc, H/2 - F*yc/zc] : null;
  };
  const SHAPE = [[-.22,-.11],[0,.08],[.22,-.11],[.22,-.2],[0,-.02],[-.22,-.2]], base = (t/1000*0.8) % 1.3;
  g.lineJoin = 'round'; g.shadowColor = '#4da3ff'; g.shadowBlur = 12;
  for(let k = 8; k >= 0; k--){                                // far to near, flowing forward
    const d = 1 + k*1.3 + base, al = Math.min(1, Math.max(0, (d-1)/1.2)) * Math.min(1, Math.max(0, (11-d)/3));
    const pts = SHAPE.map(([l,s]) => proj(l, s, d)); if(pts.some(x => !x) || al <= 0) continue;
    g.beginPath(); pts.forEach((q,i) => i ? g.lineTo(q[0],q[1]) : g.moveTo(q[0],q[1])); g.closePath();
    g.fillStyle = `rgba(77,163,255,${.9*al})`; g.strokeStyle = `rgba(255,255,255,${al})`; g.lineWidth = 3; g.fill(); g.stroke();
  }
  g.shadowBlur = 0;
}

function close(){
  stopHeading();
  clearInterval(auto);
  cancelAnimationFrame(raf);
  removeEventListener('deviceorientationabsolute', onAbs, true); removeEventListener('deviceorientation', onRel, true);
  stream && stream.getTracks().forEach(t => t.stop()); $('arrow').hidden = true;
}
