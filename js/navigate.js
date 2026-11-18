// Navigation, as in the FESTU.Navigator demo: scan a room sign, confirm the number, pick a destination,
// then follow chevrons on the floor or compass screen arrows. The WebXR walk needs an ARCore Android phone.
import { listMaps } from './db.js';
import { byId, roomsOf, placeOf, findRoom, nearestNode } from './graph.js';
import { buildRoute, Walker, makeAlign, fmtDist, walkMinutes } from './route.js';
import { drawMap } from './minimap.js';
import { loadOCR, readNumber } from './ocr.js';
import { xrSupported, openXR } from './xrkit.js';
import { startHeading, stopHeading, getHeading, hasCompass } from './heading.js';
import { speak } from './voice.js';
import { $, el, show, xrMode, fillRooms, sleep } from './ui.js';

let S = null;
const PHASES = ['nScan', 'nConfirm', 'nPick', 'nRoute'];
const SCAN_HINT = 'Point the camera at the room number. Keep the sign inside the frame.';
const wrapDeg = a => ((a % 360) + 540) % 360 - 180;
const msg = t => $('nMsg').textContent = t;
let qrReaderPromise = null;
function loadQRReader(){
  if(window.jsQR) return Promise.resolve();
  if(!qrReaderPromise) qrReaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
    script.onload = () => window.jsQR ? resolve() : reject(new Error('QR scanner did not initialize.'));
    script.onerror = () => reject(new Error('QR scanner could not load.'));
    document.head.append(script);
  });
  return qrReaderPromise;
}
function phase(p){
  PHASES.forEach(id => $(id).hidden = id !== p);
  $('nBox').hidden = p !== 'nScan'; $('nHud').hidden = !(p === 'nScan' || p === 'nConfirm');
  if(p !== 'nConfirm') $('nChip').hidden = true;
  $('nGuideHud').hidden = p !== 'nGuide'; $('nGuideArrow').hidden = p !== 'nGuide'; $('nGuideDock').hidden = p !== 'nGuide';
}
function stopCam(){ S.token++; if(S.stream){ S.stream.getTracks().forEach(t => t.stop()); S.stream = null; } $('nVideo').srcObject = null; }
function stopSim(){ clearInterval(S.sim); S.sim = 0; $('nSim').textContent = 'Simulate the walk'; }
function stopArrowGuide(){
  if(!S.guideActive) return;
  S.guideActive = false; S.guideScanning = false; clearInterval(S.guideTimer); S.guideTimer = 0;
  $('nGuideCheckpoint').textContent = 'Scan checkpoint';
  stopHeading(); stopCam(); phase('nRoute'); $('nGuideArrow').style.transform = '';
}
function leave(){ stopArrowGuide(); stopSim(); stopCam(); S.back(); }

export async function openNavigate(back, { map = null } = {}){
  const [maps, supported] = await Promise.all([listMaps(), xrSupported()]);
  S = { maps, back, map: null, start: null, end: null, stream: null, token: 0, last: null, sim: 0, supported, items: [], onPick: null, route: null, guideActive: false, guideScanning: false, guidePaused: false, guideTimer: 0 };
  show('nav');
  $('nCancel').onclick = $('nPickBack').onclick = leave;
  $('nType').onclick = () => { stopCam(); pickStart(map && S.maps.find(m => m.id === map.id)); };
  $('nNo').onclick = () => scan();
  $('nYes').onclick = () => confirmed();
  $('nSearch').oninput = () => fillRooms($('nList'), S.items, $('nSearch').value, S.onPick);
  $('nChange').onclick = () => pickStart();
  $('nRouteBack').onclick = () => { stopSim(); pickEnd(); };
  $('nGo').onclick = () => S.supported ? startAR() : startArrowGuidance(); $('nSim').onclick = simulate;
  $('nGuideCheckpoint').onclick = scanCheckpoint;
  $('nGuideStop').onclick = stopArrowGuide;
  if(map) pickStart(S.maps.find(m => m.id === map.id)); else scan();
}

// ---- 1. scan the sign ----
async function scan(){
  phase('nScan'); S.last = null; const my = ++S.token; msg(SCAN_HINT);
  try{
    if(!S.stream){ S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); $('nVideo').srcObject = S.stream; }
  }catch{ return msg('The camera is blocked. Allow access, or choose "Type the number".'); }
  try{ await loadOCR(msg); }catch{ return msg('The text reader could not load. Choose "Type the number".'); }
  if(S.token !== my) return; msg(SCAN_HINT);
  const v = $('nVideo'), c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
  while(S.token === my){
    await sleep(800);
    if(!v.videoWidth) continue;
    const sw = v.videoWidth * .84, sh = v.videoHeight * .32;                        // the frame drawn on screen: the middle band
    c.width = 640; c.height = Math.round(640 * sh / sw);
    g.drawImage(v, v.videoWidth * .08, v.videoHeight * .29, sw, sh, 0, 0, c.width, c.height);
    let r = null; try{ r = await readNumber(c); }catch{}
    if(S.token !== my) return;
    if(r && r.text === S.last) return found(r.text);                               // the same number twice in a row
    S.last = r ? r.text : null;
  }
}
function found(text){
  S.token++; S.number = text; phase('nConfirm');
  $('nChip').textContent = text; $('nChip').hidden = false;
  $('nAsk').textContent = `Is ${text} the number on the sign?`; $('nYes').textContent = 'Yes, I am here';
  msg('');
}
function confirmed(){
  const hits = S.maps.map(map => ({ map, n: findRoom(map, S.number) })).filter(x => x.n);
  if(!hits.length){ scan(); return msg(`Room ${S.number} is not on any map yet. Scan another sign, or choose "Type the number".`); }
  if(hits.length === 1) return setStart(hits[0].map, hits[0].n);
  stopCam(); S.items = hits; openList('start', `Room ${S.number} is on more than one map`, (m, n) => setStart(m, n));
}

// ---- 2. pick the start by hand, and the destination ----
function openList(mode, title, onPick){
  phase('nPick'); S.onPick = onPick; $('nPickTitle').textContent = title; $('nSearch').value = '';
  $('nFrom').hidden = mode !== 'end'; $('nChange').hidden = mode !== 'end';
  if(mode === 'end') $('nFrom').textContent = `From ${S.start.room}, ${placeOf(S.map)}`;
  fillRooms($('nList'), S.items, '', onPick);
}
function pickStart(only){
  stopCam(); stopSim();
  S.items = (only ? [only] : S.maps).flatMap(map => roomsOf(map).map(n => ({ map, n })));
  openList('start', 'Where are you?', (m, n) => setStart(m, n));
  if(!S.items.length) $('nList').replaceChildren(el('li', 'none', 'No rooms are marked on the maps yet.'));
}
function setStart(map, n){ stopCam(); S.map = map; S.start = n; S.end = null; pickEnd(); }
function pickEnd(){
  S.items = roomsOf(S.map).filter(n => n.id !== S.start.id).map(n => ({ map: S.map, n }));
  openList('end', 'Where to?', (m, n) => { S.end = n; showRoute(); });
}

// ---- 3. the route ----
function showRoute(){
  stopCam(); phase('nRoute');
  const r = S.route = buildRoute(S.map, S.start.id, S.end.id);
  $('nRTitle').textContent = `To ${S.end.room}`;
  drawMap($('nMap'), S.map, { route: r, start: S.start.id, end: S.end.id });
  $('nRStatus').textContent = '';
  $('nGo').hidden = $('nSim').hidden = !r;
  if(!r){ $('nRSub').textContent = `The map has no path from ${S.start.room} to ${S.end.room}.`; $('nRNote').textContent = 'The corridors between them were not walked in one go. Map the missing stretch, or pick another room.'; return; }
  $('nRSub').textContent = `${placeOf(S.map)}, ${fmtDist(r.length)}, about ${walkMinutes(r.length)} min`;
  $('nGo').disabled = false;
  $('nGo').textContent = S.supported ? 'Start AR' : 'Start arrow guidance';
  $('nRNote').textContent = S.supported
    ? `Stand where you scanned ${S.start.room}, facing its sign. Then tap Start AR and point the phone at the floor for a moment.`
    : 'No floor AR on this device. Start arrow guidance uses the compass and mapped route; scan each room sign or QR at junctions to re-check your position.';
}
function simulate(){
  if(S.sim) return stopSim();
  const w = new Walker(S.map, S.start.id, S.end.id), pts = w.route.pts; let s = 0, t = 0;
  $('nSim').textContent = 'Stop simulation';
  S.sim = setInterval(() => {
    s += 3 * .1; t += 100;                                 // 3 m/s: a fast-forward, not a real pace
    const p = pts[Math.min(pts.length - 1, Math.round(s / w.step))], r = w.update(p.p, p.yaw, t);
    drawMap($('nMap'), S.map, { route: w.route, start: S.start.id, end: S.end.id, you: p.p, heading: p.yaw });
    $('nRStatus').textContent = r.arrived ? `You have arrived at ${S.end.room}` : `Follow the arrows to ${S.end.room}, ${fmtDist(r.remaining)} left`;
    if(r.arrived) stopSim();
  }, 100);
}

// ---- screen-arrow fallback for devices without WebXR floor tracking ----
function nextGuideStop(){
  if(!S.route) return null;
  const i = S.route.ids.indexOf(S.start.id);
  if(i < 0) return null;
  for(const id of S.route.ids.slice(i + 1)){
    const n = byId(S.map, id);
    if(n && (n.room || n.checkpoint || n.id === S.end.id)) return n;
  }
  return S.end;
}
function updateArrowGuide(){
  if(!S.guideActive || S.guideScanning || S.guidePaused || !hasCompass()) return;
  const target = nextGuideStop();
  if(!target){ $('nGuideMsg').textContent = 'No mapped route from this checkpoint to the destination.'; $('nGuideArrow').hidden = true; return; }
  if(target.id === S.start.id){
    $('nGuideMsg').textContent = `You are at ${target.room ? `room ${target.room}` : 'the checkpoint'}.`;
    $('nGuideSub').textContent = 'Choose another destination to continue.';
    $('nGuideArrow').hidden = true; return;
  }
  if(S.guideTargetId !== target.id){
    S.guideTargetId = target.id;
    S.guideSegment = buildRoute(S.map, S.start.id, target.id);
  }
  const segment = S.guideSegment;
  if(!segment || !segment.pts.length){
    $('nGuideMsg').textContent = 'There is no mapped path to the next checkpoint.';
    $('nGuideArrow').hidden = true; return;
  }
  const yaw = segment.pts[0].yaw * 180 / Math.PI;
  const turn = wrapDeg(yaw - (getHeading() + S.guideOffset));
  const text = Math.abs(turn) < 22 ? 'Continue straight' : turn > 0 ? 'Turn left' : 'Turn right';
  const label = target.room ? `room ${target.room}` : 'the QR checkpoint';
  $('nGuideMsg').textContent = `${text} toward ${label}`;
  $('nGuideSub').textContent = `About ${fmtDist(segment.length)} along this mapped section. Scan the sign or QR to confirm your position; the arrow does not track walking progress.`;
  $('nGuideTarget').textContent = `Next: ${label}`;
  $('nGuideStatus').textContent = `Destination: ${S.end.room}`;
  $('nGuideArrow').hidden = false;
  $('nGuideArrow').style.transform = `rotate(${-turn}deg)`;
}
async function startArrowGuidance(){
  stopSim(); stopCam();
  if(!Number.isFinite(S.start.yaw)){
    $('nRNote').textContent = 'This map has no saved direction at the start room. Remap that room while facing its sign, then try again.';
    return;
  }
  const orientation = window.DeviceOrientationEvent;
  try{
    if(orientation && typeof orientation.requestPermission === 'function'){
      const permission = await orientation.requestPermission();
      if(permission !== 'granted') throw new Error('Compass permission was not granted.');
    }
    startHeading();
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Camera access is not available in this browser.');
    S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = $('nVideo'); video.srcObject = S.stream;
    await video.play();
    const deadline = Date.now() + 2500;
    while(!hasCompass() && Date.now() < deadline) await sleep(100);
    if(!hasCompass()) throw new Error('This phone did not provide compass direction.');
    S.guideOffset = wrapDeg(S.start.yaw * 180 / Math.PI - getHeading());
    S.guideTargetId = null; S.guidePaused = false; S.guideActive = true;
    phase('nGuide'); updateArrowGuide();
    S.guideTimer = setInterval(updateArrowGuide, 200);
  }catch(error){
    S.guideActive = false; stopHeading(); stopCam(); phase('nRoute');
    $('nRNote').textContent = `Screen-arrow guidance could not start: ${error.message}`;
  }
}
function reanchorGuide(node){
  if(!Number.isFinite(node.yaw)){
    $('nGuideMsg').textContent = `Room ${node.room || ''} has no saved facing direction. Its map entry needs to be corrected.`;
    S.guidePaused = true; $('nGuideArrow').hidden = true;
    return false;
  }
  const route = buildRoute(S.map, node.id, S.end.id);
  if(!route){
    $('nGuideMsg').textContent = `${node.room ? `Room ${node.room}` : 'That checkpoint'} is not connected to ${S.end.room} on this map.`;
    S.guidePaused = true; $('nGuideArrow').hidden = true;
    return false;
  }
  S.start = node; S.route = route; S.guidePaused = false; S.guideOffset = wrapDeg(node.yaw * 180 / Math.PI - getHeading());
  S.guideTargetId = null; updateArrowGuide();
  return true;
}
async function scanCheckpoint(){
  if(!S.guideActive) return;
  if(S.guideScanning){
    S.token++; S.guideScanning = false; $('nGuideCheckpoint').textContent = 'Scan checkpoint';
    $('nGuideMsg').textContent = 'Checkpoint scan cancelled.'; return;
  }
  const my = ++S.token, video = $('nVideo'), canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let detector = null, qrReady = false, ocrReady = false, lastText = '', repeats = 0;
  S.guideScanning = true; $('nGuideCheckpoint').textContent = 'Cancel scanning';
  $('nGuideMsg').textContent = 'Point the camera steadily at a room sign or the QR checkpoint.';
  try{
    try{ await loadOCR(t => { $('nGuideSub').textContent = t; }); ocrReady = true; }
    catch(error){ $('nGuideSub').textContent = `Room sign reader unavailable: ${error.message}`; }
    try{
      if('BarcodeDetector' in window){
        try{ detector = new BarcodeDetector({ formats: ['qr_code'] }); }
        catch{ await loadQRReader(); }
      }else await loadQRReader();
      qrReady = true;
    }catch(error){ $('nGuideSub').textContent = `QR reader unavailable: ${error.message}. Room signs can still be scanned.`; }
    if(!ocrReady && !qrReady){
      $('nGuideMsg').textContent = 'No room-sign or QR scanner could be started. Check the connection and try again.';
      return;
    }
    while(S.token === my && S.guideActive){
      await sleep(350);
      if(!video.videoWidth) continue;
      let raw = null;
      if(qrReady){
        if(detector){
          const codes = await detector.detect(video);
          if(S.token !== my || !S.guideActive) return;
          raw = codes.length ? codes[0].rawValue : null;
        }else{
          const w = 640, h = Math.round(w * video.videoHeight / video.videoWidth);
          canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
          const code = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
          raw = code ? code.data : null;
        }
      }
      let foundNode = null, identity = '';
      const match = raw && /^sgmap:checkpoint:([A-Za-z0-9_-]{8,100})$/.exec(raw.trim());
      if(match){
        foundNode = S.map.nodes.find(n => n.checkpoint === match[1]) || null;
        identity = `qr:${match[1]}`;
        if(!foundNode){ $('nGuideSub').textContent = 'That QR checkpoint is not part of this map.'; }
      }
      if(!foundNode && ocrReady){
        const sw = video.videoWidth * .84, sh = video.videoHeight * .32;
        canvas.width = 640; canvas.height = Math.round(640 * sh / sw);
        ctx.drawImage(video, video.videoWidth * .08, video.videoHeight * .29, sw, sh, 0, 0, canvas.width, canvas.height);
        const result = await readNumber(canvas);
        if(S.token !== my || !S.guideActive) return;
        if(result && result.text){
          foundNode = findRoom(S.map, result.text);
          identity = `room:${result.text}`;
          if(!foundNode) $('nGuideSub').textContent = `Room ${result.text} is not marked on this map.`;
        }
      }
      if(foundNode){
        if(identity === lastText) repeats++; else { lastText = identity; repeats = 1; }
        $('nGuideMsg').textContent = `Recognized ${foundNode.room ? `room ${foundNode.room}` : 'QR checkpoint'}. Hold steady...`;
        if(repeats >= 2){
          if(reanchorGuide(foundNode)) $('nGuideMsg').textContent = `Position confirmed at ${foundNode.room ? `room ${foundNode.room}` : 'QR checkpoint'}.`;
          return;
        }
      }else{ lastText = ''; repeats = 0; }
    }
  }catch(error){
    if(S.token === my) $('nGuideMsg').textContent = `Checkpoint scan failed: ${error.message}`;
  }finally{
    if(S.token === my){ S.guideScanning = false; $('nGuideCheckpoint').textContent = 'Scan checkpoint'; }
  }
}

// ---- 4. the AR walk ----
async function startAR(){
  stopSim(); stopCam();
  const overlay = $('xrOverlay'), say = t => $('wMsg').textContent = t;
  let node = S.start, align = null, walker = null, calib = null, arrived = false, user = [0, 0, 0], last = 0, lastHint = 'ahead';
  xrMode('xrWalk'); $('wStart').textContent = node.room; $('wEndV').textContent = S.end.room; $('wExit').textContent = 'Exit';
  $('wSub').textContent = `To ${S.end.room}, ${placeOf(S.map)}`; say('Point the phone at the floor for a moment');
  const sheet = (title, items, onPick) => { $('xsTitle').textContent = title; $('xsKeys').hidden = true; $('xsList').hidden = false; $('xrSheet').hidden = false; fillRooms($('xsList'), items, '', (m, n) => { $('xrSheet').hidden = true; onPick(n); }); };
  const x = await openXR({
    overlay,
    onEnd: () => { xrMode(null); show('nav'); },
    onFrame: f => {
      if(f.floorY == null) return;
      if(!align || calib){
        const e = calib ? calib.node : node; node = e;
        align = makeAlign(e.pos, e.yaw || 0, f.pos, f.heading, f.floorY); walker = new Walker(S.map, e.id, S.end.id); calib = null; arrived = false;
        $('wStart').textContent = e.room; say('Follow the arrows');
      }
      user = align.toGraph(f.pos);
      const r = walker.update(user, f.heading - align.delta, f.t);
      if(r.error) return say('No route from here');
      x.setChevrons(r.chevrons.map(c => ({ p: align.toNav(c.p), yaw: c.yaw + align.delta, a: c.a })));
      if(r.arrived && !arrived){ arrived = true; x.setChevrons([]); say('You have arrived'); speak('You have arrived'); $('wExit').textContent = 'Done'; }
      if(f.t - last > 250 && !arrived){
        last = f.t; const text = { ahead: 'Follow the arrows', left: 'Turn left', right: 'Turn right', back: 'Turn around' }[r.hint];
        say(text); if(r.hint !== lastHint){ lastHint = r.hint; if(r.hint !== 'ahead') speak(text); }
        $('wSub').textContent = `To ${S.end.room}, ${placeOf(S.map)}, ${fmtDist(r.remaining)} left`;
      }
    },
  });
  if(!x){
    xrMode(null); show('nav'); S.supported = false; $('nGo').textContent = 'Start arrow guidance';
    $('nRNote').textContent = 'AR could not start on this phone. Try screen-arrow guidance instead; it needs camera and compass access, and QR checkpoints at junctions.';
    return;
  }
  $('wExit').onclick = () => x.end();
  $('wRecal').onclick = () => sheet('Which sign are you facing?', roomsOf(S.map).map(n => ({ map: S.map, n })), n => { calib = { node: n }; say(`Aligned to ${n.room}`); });
  $('wEnd').onclick = () => sheet('Where to?', roomsOf(S.map).filter(n => n.id !== node.id).map(n => ({ map: S.map, n })), n => {
    S.end = n; $('wEndV').textContent = n.room; arrived = false; $('wExit').textContent = 'Exit';
    const from = nearestNode(S.map, user) || node; walker = new Walker(S.map, from.id, n.id); say('Follow the arrows');
  });
  $('xsClose').onclick = () => $('xrSheet').hidden = true;
}
