// Navigation, as in the FESTU.Navigator demo: scan a room sign, confirm the number, pick a destination,
// then follow chevrons on the floor. Route preview and a simulated walk work on any device; the AR walk
// needs WebXR (Chrome on an ARCore Android phone).
import { listMaps } from './db.js';
import { roomsOf, placeOf, findRoom, nearestNode } from './graph.js';
import { buildRoute, Walker, makeAlign, fmtDist, walkMinutes } from './route.js';
import { drawMap } from './minimap.js';
import { loadOCR, readNumber } from './ocr.js';
import { xrSupported, openXR } from './xrkit.js';
import { speak } from './voice.js';
import { $, el, show, xrMode, fillRooms, sleep } from './ui.js';

let S = null;
const PHASES = ['nScan', 'nConfirm', 'nPick', 'nRoute'];
const SCAN_HINT = 'Point the camera at the room number. Keep the sign inside the frame.';
const msg = t => $('nMsg').textContent = t;
function phase(p){
  PHASES.forEach(id => $(id).hidden = id !== p);
  $('nBox').hidden = p !== 'nScan'; $('nHud').hidden = !(p === 'nScan' || p === 'nConfirm');
  if(p !== 'nConfirm') $('nChip').hidden = true;
}
function stopCam(){ S.token++; if(S.stream){ S.stream.getTracks().forEach(t => t.stop()); S.stream = null; } }
function stopSim(){ clearInterval(S.sim); S.sim = 0; $('nSim').textContent = 'Simulate the walk'; }
function leave(){ stopSim(); stopCam(); S.back(); }

export async function openNavigate(back, { map = null } = {}){
  S = { maps: await listMaps(), back, map: null, start: null, end: null, stream: null, token: 0, last: null, sim: 0, supported: false, items: [], onPick: null, route: null };
  show('nav'); xrSupported().then(v => S.supported = v);
  $('nCancel').onclick = $('nPickBack').onclick = leave;
  $('nType').onclick = () => { stopCam(); pickStart(map && S.maps.find(m => m.id === map.id)); };
  $('nNo').onclick = () => scan();
  $('nYes').onclick = () => confirmed();
  $('nSearch').oninput = () => fillRooms($('nList'), S.items, $('nSearch').value, S.onPick);
  $('nChange').onclick = () => pickStart();
  $('nRouteBack').onclick = () => { stopSim(); pickEnd(); };
  $('nGo').onclick = startAR; $('nSim').onclick = simulate;
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
  $('nGo').disabled = !S.supported;
  $('nRNote').textContent = S.supported
    ? `Stand where you scanned ${S.start.room}, facing its sign. Then tap Start AR and point the phone at the floor for a moment.`
    : 'AR needs Chrome on an Android phone with ARCore. You can still preview the route and simulate the walk here.';
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
  if(!x){ xrMode(null); show('nav'); return $('nRNote').textContent = 'AR could not start. Check that camera access is allowed.'; }
  $('wExit').onclick = () => x.end();
  $('wRecal').onclick = () => sheet('Which sign are you facing?', roomsOf(S.map).map(n => ({ map: S.map, n })), n => { calib = { node: n }; say(`Aligned to ${n.room}`); });
  $('wEnd').onclick = () => sheet('Where to?', roomsOf(S.map).filter(n => n.id !== node.id).map(n => ({ map: S.map, n })), n => {
    S.end = n; $('wEndV').textContent = n.room; arrived = false; $('wExit').textContent = 'Exit';
    const from = nearestNode(S.map, user) || node; walker = new Walker(S.map, from.id, n.id); say('Follow the arrows');
  });
  $('xsClose').onclick = () => $('xrSheet').hidden = true;
}
