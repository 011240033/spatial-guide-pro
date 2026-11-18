// Mapping: the equivalent of the FESTU admin mode. Walk with AR on; breadcrumbs become corridors, and
// "Mark room" (facing a sign, typing its number on a keypad) turns a spot into a destination.
import { saveMap } from './db.js';
import { newMap, Recorder, roomsOf } from './graph.js';
import { openXR } from './xrkit.js';
import { loadFrameLabelModel, suggestFrameLabels } from './ai.js';
import { startBuilder } from './builder.js';
import { $, el, show, xrMode } from './ui.js';

export function openMapNew(back, panoramaDone = back){
  show('mapnew'); $('mHint').textContent = '';
  $('mPanorama').onclick = () => startBuilder(panoramaDone, {
    building: $('mBuilding').value.trim(),
    floor: $('mFloor').value.trim(),
  });
  $('mStart').onclick = () => run(back);
}

async function run(back){
  const hint = t => $('mHint').textContent = t;
  const building = $('mBuilding').value.trim(), floor = $('mFloor').value.trim();
  if(!building) return hint('Enter the building name.');
  if(!navigator.xr) return hint('AR mapping is unavailable in this browser. It requires Chrome on an ARCore-supported Android phone, Google Play Services for AR, and HTTPS. You can still open maps and preview or simulate routes on this device.');
  const map = newMap({ building, floor }), rec = new Recorder(map), say = t => $('mMsg').textContent = t;
  let cur = null, ready = false, changed = false, lastDraw = 0, discard = false, x = null;
  let diagStart = 0, diagFrames = 0, diagWork = 0;
  const clipSamples = [];
  const stats = () => $('mStats').textContent =
    `${map.nodes.length} points, ${roomsOf(map).length} rooms, ${map.nodes.filter(n => n.checkpoint).length} QR checkpoints, ${map.nodes.filter(n => n.clipSuggestion).length} CLIP guesses`;
  const updateDiag = (fps, workMs) => {
    const cameraStatus = x && x.cameraCaptureAvailable ? 'available' : x ? `unavailable (${x.cameraCaptureMessage})` : 'checking';
    $('mDiagText').textContent = `AR updates: ${fps} fps · map step: ${workMs.toFixed(1)} ms · floor: ${cur && cur.floorY != null ? 'tracked' : 'searching'} · CLIP camera: ${cameraStatus}`;
  };
  xrMode('xrMap'); say('Point the phone at the floor for a moment'); stats();
  x = await openXR({
    overlay: $('xrOverlay'),
    onEnd: async () => {
      xrMode(null);
      if(!discard && map.nodes.length > 1 && roomsOf(map).length){
        show('mapnew');
        const samples = [];
        for(const sample of clipSamples){
          const image = await sample.image;
          if(image) samples.push({ nodeId: sample.nodeId, image });
        }
        let clipError = null, suggestions = 0;
        if(samples.length){
          try{
            await loadFrameLabelModel(text => hint(`Finishing map: ${text}`));
            for(const sample of samples){
              const [guess] = await suggestFrameLabels(sample.image, 1);
              const node = map.nodes.find(n => n.id === sample.nodeId);
              if(guess && node){ node.clipSuggestion = { label: guess.label, confidence: guess.conf }; suggestions++; }
            }
          }catch(error){ clipError = error; }
        }
        await saveMap(map);
        if(clipError){
          hint(`Map saved. CLIP suggestions could not be completed: ${clipError.message}`);
        }else if(samples.length){
          hint(`Map saved with ${suggestions} CLIP suggestions. These are guesses; room numbers remain the destinations.`);
        }else{
          hint(clipSamples.length
            ? 'Map saved. This browser could not capture camera images for CLIP; the route is unaffected.'
            : 'Map saved. Mark rooms or QR checkpoints to collect occasional CLIP samples next time.');
        }
        stats(); return;
      }
      show('mapnew'); hint(discard ? '' : 'Nothing saved. Walk a few metres and mark at least one room.');
    },
    onFrame: f => {
      const workStart = performance.now();
      cur = f;
      if(f.floorY != null){
        if(!ready){ ready = true; say('Stand in front of a room sign, facing it. Tap Mark room.'); }
        if(rec.update([f.pos[0], f.floorY, f.pos[2]])) changed = true;
        if(changed && x && f.t - lastDraw > 800){
          lastDraw = f.t; changed = false;
          x.setMarkers(map.nodes.filter(n => n.room || n.checkpoint).map(n => ({ p: n.pos, room: n.room || 'QR' })));
          stats();
        }
      }
      diagFrames++;
      diagWork += performance.now() - workStart;
      if(!diagStart) diagStart = f.t;
      if(f.t - diagStart >= 1000){
        updateDiag(Math.round(diagFrames * 1000 / (f.t - diagStart)), diagWork / diagFrames);
        diagStart = f.t; diagFrames = 0; diagWork = 0;
      }
    },
  });
  if(!x){ xrMode(null); show('mapnew'); return hint('AR mapping could not start. Check that you are using Chrome on a supported Android phone over HTTPS, that Google Play Services for AR is installed, and that camera access is allowed.'); }
  updateDiag(0, 0);

  // the keypad: no soft keyboard is needed inside the AR view
  let digits = '', at = null;
  const sheet = $('xrSheet'), disp = $('xsDisp'), grid = $('xsGrid'); grid.innerHTML = '';
  const refresh = () => { disp.textContent = digits || 'Room number'; disp.classList.toggle('ph', !digits); };
  const save = () => {
    if(!digits || !at) return;
    const n = rec.mark(at.pos, at.yaw, digits);
    if(at.image) clipSamples.push({ nodeId: n.id, image: at.image });
    changed = true; lastDraw = 0; sheet.hidden = true;
    say(`Marked ${digits}. ${at.image ? 'A CLIP sample is queued for after mapping.' : 'CLIP image capture is unavailable;'} Walk on to the next room.`); stats();
  };
  [...'123456789', '\u232b', '0', 'Save'].forEach(k => {
    const b = el('button', k === 'Save' ? '' : 'ghost key', k); b.type = 'button';
    b.onclick = () => { if(k === 'Save') save(); else if(k === '\u232b') digits = digits.slice(0, -1); else if(digits.length < 6) digits += k; refresh(); };
    grid.append(b);
  });
  $('mMark').onclick = () => {
    if(!cur || cur.floorY == null) return say('Point the phone at the floor for a moment first.');
    const image = x.captureFrame().catch(error => { say(`CLIP camera sample unavailable: ${error.message}`); return null; });
    at = { pos: [cur.pos[0], cur.floorY, cur.pos[2]], yaw: cur.heading, image };     // capture where you stand, not when you finish typing
    digits = ''; refresh(); $('xsTitle').textContent = 'Which room is this sign?'; $('xsList').hidden = true; $('xsKeys').hidden = false; sheet.hidden = false;
  };
  $('mCheckpoint').onclick = async () => {
    if(!cur || cur.floorY == null) return say('Point the phone at the floor before adding a checkpoint.');
    const token = `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    const n = rec.markCheckpoint([cur.pos[0], cur.floorY, cur.pos[2]], cur.heading, token);
    const image = x.captureFrame().catch(error => { say(`CLIP camera sample unavailable: ${error.message}`); return null; });
    clipSamples.push({ nodeId: n.id, image });
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
