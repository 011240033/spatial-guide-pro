// Mapping: the equivalent of the FESTU admin mode. Walk with AR on; breadcrumbs become corridors, and
// "Mark room" (facing a sign, typing its number on a keypad) turns a spot into a destination.
import { saveMap } from './db.js';
import { newMap, Recorder, roomsOf } from './graph.js';
import { openXR } from './xrkit.js';
import { $, el, show, xrMode } from './ui.js';

export function openMapNew(back){
  show('mapnew'); $('mHint').textContent = '';
  $('mStart').onclick = () => run(back);
}

async function run(back){
  const hint = t => $('mHint').textContent = t;
  const building = $('mBuilding').value.trim(), floor = $('mFloor').value.trim();
  if(!building) return hint('Enter the building name.');
  if(!navigator.xr) return hint('AR mapping is unavailable in this browser. It requires Chrome on an ARCore-supported Android phone, Google Play Services for AR, and HTTPS. You can still open maps and preview or simulate routes on this device.');
  const map = newMap({ building, floor }), rec = new Recorder(map), say = t => $('mMsg').textContent = t;
  let cur = null, ready = false, changed = false, lastDraw = 0, discard = false, x = null;
  const stats = () => $('mStats').textContent = `${map.nodes.length} points, ${roomsOf(map).length} rooms, ${map.nodes.filter(n => n.checkpoint).length} QR checkpoints`;
  xrMode('xrMap'); say('Point the phone at the floor for a moment'); stats();
  x = await openXR({
    overlay: $('xrOverlay'),
    onEnd: async () => {
      xrMode(null);
      if(!discard && map.nodes.length > 1 && roomsOf(map).length){ await saveMap(map); return back(); }
      show('mapnew'); hint(discard ? '' : 'Nothing saved. Walk a few metres and mark at least one room.');
    },
    onFrame: f => {
      cur = f; if(f.floorY == null) return;
      if(!ready){ ready = true; say('Stand in front of a room sign, facing it. Tap Mark room.'); }
      if(rec.update([f.pos[0], f.floorY, f.pos[2]])) changed = true;
      if(changed && f.t - lastDraw > 400){ lastDraw = f.t; changed = false; x.setMarkers(map.nodes.map(n => ({ p: n.pos, room: n.room || (n.checkpoint ? 'QR' : null) }))); stats(); }
    },
  });
  if(!x){ xrMode(null); show('mapnew'); return hint('AR mapping could not start. Check that you are using Chrome on a supported Android phone over HTTPS, that Google Play Services for AR is installed, and that camera access is allowed.'); }

  // the keypad: no soft keyboard is needed inside the AR view
  let digits = '', at = null;
  const sheet = $('xrSheet'), disp = $('xsDisp'), grid = $('xsGrid'); grid.innerHTML = '';
  const refresh = () => { disp.textContent = digits || 'Room number'; disp.classList.toggle('ph', !digits); };
  const save = () => {
    if(!digits || !at) return;
    rec.mark(at.pos, at.yaw, digits); changed = true; lastDraw = 0; sheet.hidden = true; say(`Marked ${digits}. Walk on to the next room.`); stats();
  };
  [...'123456789', '\u232b', '0', 'Save'].forEach(k => {
    const b = el('button', k === 'Save' ? '' : 'ghost key', k); b.type = 'button';
    b.onclick = () => { if(k === 'Save') save(); else if(k === '\u232b') digits = digits.slice(0, -1); else if(digits.length < 6) digits += k; refresh(); };
    grid.append(b);
  });
  $('mMark').onclick = () => {
    if(!cur || cur.floorY == null) return say('Point the phone at the floor for a moment first.');
    at = { pos: [cur.pos[0], cur.floorY, cur.pos[2]], yaw: cur.heading };            // where you stand and face now, not when you finish typing
    digits = ''; refresh(); $('xsTitle').textContent = 'Which room is this sign?'; $('xsList').hidden = true; $('xsKeys').hidden = false; sheet.hidden = false;
  };
  $('mCheckpoint').onclick = async () => {
    if(!cur || cur.floorY == null) return say('Point the phone at the floor before adding a checkpoint.');
    const token = `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    const n = rec.markCheckpoint([cur.pos[0], cur.floorY, cur.pos[2]], cur.heading, token);
    changed = true; lastDraw = 0; stats();
    try{
      if(!window.QRCode) throw new Error('QR generator did not load.');
      const url = await window.QRCode.toDataURL(`sgmap:checkpoint:${token}`, { width:600, margin:2 });
      const a = document.createElement('a'); a.href = url; a.download = `Checkpoint ${n.id}.png`; a.click();
      say(`Checkpoint ${n.id} saved. Print its QR and place it here, facing the corridor.`);
    }catch(error){ say(`Checkpoint ${n.id} was saved, but its QR could not be created: ${error.message}`); }
  };
  $('xsClose').onclick = () => sheet.hidden = true;
  $('mFinish').onclick = () => x.end();
  $('mCancel').onclick = () => { discard = true; x.end(); };
}
