import { $, show } from './ui.js';
import { loadModels, labelFrame } from './ai.js';
const P = 8, OH = 75 * P;
const n180 = a => ((a % 360) + 540) % 360 - 180;

const sm = document.createElement('canvas'); sm.width = 160; sm.height = 90;
const sg = sm.getContext('2d', { willReadFrequently: true });
function gray(src){
  sg.drawImage(src, 0, 0, 160, 90);
  const d = sg.getImageData(0, 0, 160, 90).data, o = new Float32Array(14400);
  for(let i=0;i<14400;i++) o[i] = .299*d[i*4] + .587*d[i*4+1] + .114*d[i*4+2];
  return o;
}
const bright = o => o.reduce((a,b) => a+b, 0) / o.length;
function sharp(o){
  let s=0, s2=0, n=0;
  for(let y=1;y<89;y++) for(let x=1;x<159;x++){ const i=y*160+x, l=4*o[i]-o[i-1]-o[i+1]-o[i-160]-o[i+160]; s+=l; s2+=l*l; n++; }
  return s2/n - (s/n)**2;
}
const diff = (a,b) => { let s=0; for(let i=0;i<a.length;i+=10) s += Math.abs(a[i]-b[i]); return s/(a.length/10); };

// Guided sweep. done(file, more): more = true means "record another sweep straight away"
export async function sweep(done, deg = 360){
  show('capture'); $('cPrev').hidden = true; $('cCam').hidden = false; $('cUse').hidden = true; $('cMore').hidden = true; $('cRetake').hidden = true;
  const msg = t => $('cMsg').textContent = t;
  let abs = false, h = 0, hasHeading = false, run = false, stream;
  const setHeading = value => {
    const next = (value + 360) % 360;
    h = hasHeading ? (h + 0.2*n180(next - h) + 360) % 360 : next;
    hasHeading = true;
  };
  const ask = typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission
    ? DeviceOrientationEvent.requestPermission() : Promise.resolve();
  const onAbs = e => { if(e.alpha != null){ abs = true; setHeading(360 - e.alpha); } };
  const onRel = e => { if(!abs) setHeading(e.webkitCompassHeading != null ? e.webkitCompassHeading : 360 - (e.alpha||0)); };
  const stop = () => {
    run = false; removeEventListener('deviceorientationabsolute', onAbs, true); removeEventListener('deviceorientation', onRel, true);
    stream && stream.getTracks().forEach(t => t.stop());
  };
  $('cCancel').onclick = () => { stop(); done(null); };
  try{ await ask; stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' } }); }
  catch{ return msg('Camera or compass is blocked. Allow access, then try again.'); }
  const v = $('cCam'); v.srcObject = stream;
  addEventListener('deviceorientationabsolute', onAbs, true); addEventListener('deviceorientation', onRel, true);
  $('cStart').hidden = false; $('cBar').style.width = '0';
  msg('Stand in the middle of the spot. Hold the phone upright at one height, tap Start, then turn slowly to your right.');
  $('cStart').onclick = () => {
    if(bright(gray(v)) < 45) return msg('Too dark. Turn on a light, then try again.');
    const out = document.createElement('canvas'); out.width = deg*P; out.height = OH;
    const g = out.getContext('2d'), s = OH / v.videoHeight; let last = h, cum = 0; run = true; $('cStart').hidden = true;
    const tick = () => {
      if(!run) return;
      const d = n180(h - last);
      if(d < -3){ msg('Turn to the RIGHT, not left.'); }
      else if(d >= 1){
        const sw = (d*P + 2) / s;
        g.drawImage(v, (v.videoWidth - sw)/2, 0, sw, v.videoHeight, cum*P, 0, d*P + 2, OH);
        cum += d; last = h; $('cBar').style.width = Math.min(100, cum/(deg/100)) + '%';
        msg(d > 8 ? 'Too fast. Turn slower.' : `Keep turning: ${Math.round(cum)} of ${deg} degrees`);
      }
      if(cum >= deg){
        stop();
        out.toBlob(b => {
          const file = new File([b], 'sweep-' + Date.now() + '.jpg', {type:'image/jpeg'});
          $('cPrev').src = URL.createObjectURL(file); $('cPrev').hidden = false; $('cCam').hidden = true;
          $('cUse').hidden = false; $('cMore').hidden = false; $('cRetake').hidden = false; msg('Happy with this sweep?');
          $('cUse').onclick = () => done(file, false);
          $('cMore').onclick = () => done(file, true);
          $('cRetake').onclick = () => sweep(done, deg);
        }, 'image/jpeg', 0.9);
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  };
}

// Record a walk with live room labels. done(videoBlob, labels) where labels = [{t, label, conf}]
export async function recordWalk(done){
  show('record');
  const msg = t => $('rMsg').textContent = t, lab = t => $('rLabel').textContent = t;
  let stream, rec, chunks = [], labels = [], timer = 0, busy = false, t0 = 0;
  const stop = () => { clearInterval(timer); stream && stream.getTracks().forEach(t => t.stop()); };
  $('rCancel').onclick = () => { stop(); if(rec && rec.state === 'recording'){ rec.onstop = null; rec.stop(); } done(null); };
  $('rStart').hidden = false; $('rStop').hidden = true; lab('Loading AI...'); msg('');
  try{ await loadModels(msg); stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' } }); }
  catch{ return msg('Camera is blocked. Allow access, then try again.'); }
  const v = $('rCam'); v.srcObject = stream; lab('Ready'); msg('Walk slowly. The AI names each room as you go.');
  $('rStart').onclick = () => {
    rec = new MediaRecorder(stream, MediaRecorder.isTypeSupported('video/mp4') ? { mimeType:'video/mp4' } : {});
    rec.ondataavailable = e => { if(e.data.size) chunks.push(e.data); };
    rec.onstop = () => { stop(); done(new Blob(chunks, { type: rec.mimeType || 'video/webm' }), labels); };
    rec.start(1000); t0 = Date.now(); $('rStart').hidden = true; $('rStop').hidden = false;
    timer = setInterval(async () => {                                 // a room guess every 2.5 seconds
      if(busy) return; busy = true;
      const c = document.createElement('canvas'); c.width = c.height = 224; const s = Math.min(v.videoWidth, v.videoHeight);
      c.getContext('2d').drawImage(v, (v.videoWidth - s)/2, (v.videoHeight - s)/2, s, s, 0, 0, 224, 224);
      try{ const r = await labelFrame(c.toDataURL('image/jpeg', 0.8)); labels.push({ t:(Date.now() - t0)/1000, ...r }); lab(r.conf >= 0.4 ? r.label : r.label + '?'); }catch{}
      busy = false;
    }, 2500);
  };
  $('rStop').onclick = () => rec.stop();
}

// Cut a video into frames: drop dark, blurry and repeated ones. Each frame blob gets .t (seconds)
export async function videoFrames(file, say){
  const v = document.createElement('video'); v.src = URL.createObjectURL(file); v.muted = true; v.playsInline = true;
  await new Promise(r => v.onloadedmetadata = r);
  if(!isFinite(v.duration)){                                           // recordings from the browser need this to find their length
    v.currentTime = 1e101; await new Promise(r => v.ontimeupdate = r); v.ontimeupdate = null;
    await new Promise(r => { v.onseeked = r; v.currentTime = 0; });
  }
  const total = v.duration, w = Math.min(1280, v.videoWidth), h = Math.round(w * v.videoHeight / v.videoWidth);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  const N = Math.min(24, Math.max(4, Math.round(total / 3))), seg = total / N, out = [];
  for(let i = 0; i < N; i++){                                          // every part of the walk keeps one spot
    say(`Reading the video: ${Math.round(i / N * 100)}%`);
    let best = null;
    for(const f of [0.2, 0.5, 0.8]){                                   // three tries in each part, keep the clearest
      const t = Math.min(total - 0.05, (i + f) * seg);
      await new Promise(r => { v.onseeked = r; v.currentTime = t; });
      g.drawImage(v, 0, 0, w, h);
      const o = gray(c), s = sharp(o), lit = bright(o) >= 40;
      if(!best || (lit && !best.lit) || (lit === best.lit && s > best.s)){
        best = { s, lit, t, b: await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9)) };
      }
    }
    out.push(Object.assign(best.b, { t: best.t }));
  }
  return out;
}