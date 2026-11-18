// A map is a graph of positions in metres, recorded by walking (see mapper.js).
// node: { id, pos:[x,y,z], nb:[ids], room?:'422', yaw?:radians, checkpoint?:token }. A node with
// `room` or `checkpoint` is a place a visitor can scan to re-anchor their position.
// Heading convention: yaw 0 faces -z; yaw +90deg faces -x (a left turn is a positive change).
export const d2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
export const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const wrap = a => ((a % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;

export function newMap({ name, building = '', floor = '' } = {}){
  const desc = [building, floor !== '' ? 'floor ' + floor : ''].filter(Boolean).join(', ');
  return { id: 'm' + Date.now(), v: 1, name: name || desc || 'Map', building, floor: String(floor), created: Date.now(), nodes: [] };
}
export const byId = (m, id) => m.nodes.find(n => n.id === id);
export function addNode(m, pos, extra = {}){
  const id = m.nodes.reduce((a, n) => Math.max(a, n.id), 0) + 1;
  const n = { id, pos: [...pos], nb: [], ...extra }; m.nodes.push(n); return n;
}
export function link(m, a, b){
  if(a === b) return; const A = byId(m, a), B = byId(m, b);
  if(!A.nb.includes(b)) A.nb.push(b); if(!B.nb.includes(a)) B.nb.push(a);
}
const natural = (a, b) => a.room.localeCompare(b.room, undefined, { numeric: true });
export const roomsOf = m => m.nodes.filter(n => n.room).sort(natural);
export const findRoom = (m, num) => m.nodes.find(n => n.room === num);
export const placeOf = m => [m.building, m.floor !== '' ? `floor ${m.floor}` : ''].filter(Boolean).join(', ');
export function nearestNode(m, pos, max = Infinity){
  let best = null, bd = max;
  for(const n of m.nodes){ const d = d2(n.pos, pos); if(d < bd){ bd = d; best = n; } }
  return best;
}

// Records a map while someone walks: a breadcrumb every `step` metres, snapping back onto nodes
// already there (so retracing a corridor builds junctions and loops instead of duplicates).
export class Recorder {
  constructor(map, { step = 1.2, snap = 0.7 } = {}){ this.map = map; this.step = step; this.snap = snap; this.last = null; }
  update(pos){
    if(this.last == null){ this.last = addNode(this.map, pos).id; return true; }
    const L = byId(this.map, this.last);
    if(d2(L.pos, pos) < this.step) return false;
    const near = this.map.nodes.find(n => n.id !== this.last && d2(n.pos, pos) < this.snap);
    if(near){ link(this.map, this.last, near.id); this.last = near.id; return true; }
    const n = addNode(this.map, pos); link(this.map, this.last, n.id); this.last = n.id; return true;
  }
  mark(pos, yaw, room){
    let n = findRoom(this.map, room);
    if(n){ n.pos = [...pos]; n.yaw = yaw; if(!n.nb.length && this.last != null) link(this.map, this.last, n.id); }
    else { n = addNode(this.map, pos, { room, yaw }); if(this.last != null) link(this.map, this.last, n.id); }
    this.last = n.id; return n;
  }
  markCheckpoint(pos, yaw, token){
    const near = nearestNode(this.map, pos, this.snap);
    let n = near && !near.room ? near : null;
    if(!n){
      n = addNode(this.map, pos);
      const from = near || (this.last != null ? byId(this.map, this.last) : null);
      if(from) link(this.map, from.id, n.id);
    } else if(this.last != null && this.last !== n.id) link(this.map, this.last, n.id);
    n.checkpoint = token; n.yaw = yaw; this.last = n.id;
    return n;
  }
}

// A made-up L-shaped corridor so the flow can be tried without walking a real building.
export function sampleMap(){
  const m = newMap({ name: 'Sample map', building: 'Main building', floor: '4' }); m.sample = true;
  const S = 1.2, west = [], east = [];
  for(let i = 0; i <= 25; i++) west.push(addNode(m, [0, 0, -i * S]));
  for(let j = 1; j <= 15; j++) east.push(addNode(m, [j * S, 0, -25 * S]));
  const chain = [...west, ...east]; chain.slice(1).forEach((n, i) => link(m, chain[i].id, n.id));
  const door = (n, room, yaw) => { n.room = room; n.yaw = yaw; };
  const H = Math.PI / 2;
  [['401', 2], ['403', 8], ['405', 14], ['407', 20]].forEach(([r, i]) => door(west[i], r, H));     // doors on the left, facing -x
  [['402', 3], ['404', 9], ['406', 15], ['408', 21]].forEach(([r, i]) => door(west[i], r, -H));   // doors on the right, facing +x
  [['410', 4], ['412', 10]].forEach(([r, j]) => door(east[j - 1], r, 0));                         // north side of the east wing
  [['409', 5], ['411', 11]].forEach(([r, j]) => door(east[j - 1], r, Math.PI));                   // south side
  return m;
}

// Reads a .sgmap file. Imported files are untrusted, so every field is checked and room labels are kept short.
export function parseMap(text){
  const m = JSON.parse(text), num = v => typeof v === 'number' && Number.isFinite(v);
  if(!m || !Array.isArray(m.nodes) || !m.nodes.length || m.nodes.length > 5000) throw new Error('This is not a Spatial Guide map.');
  const ids = new Set(m.nodes.map(n => n && n.id));
  const nodes = m.nodes.map(n => {
    if(!n || !Number.isInteger(n.id) || !Array.isArray(n.pos) || n.pos.length !== 3 || !n.pos.every(num)) throw new Error('A map node is damaged.');
    const out = { id: n.id, pos: n.pos.slice(), nb: (Array.isArray(n.nb) ? n.nb : []).filter(i => ids.has(i) && i !== n.id) };
    if(n.room != null && String(n.room).trim()) out.room = String(n.room).trim().slice(0, 12);
    if(num(n.yaw)) out.yaw = n.yaw;
    if(typeof n.checkpoint === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(n.checkpoint)) out.checkpoint = n.checkpoint;
    if(n.clipSuggestion && typeof n.clipSuggestion.label === 'string' &&
       /^[A-Za-z ]{1,32}$/.test(n.clipSuggestion.label) && num(n.clipSuggestion.confidence) &&
       n.clipSuggestion.confidence >= 0 && n.clipSuggestion.confidence <= 1){
      out.clipSuggestion = { label: n.clipSuggestion.label, confidence: n.clipSuggestion.confidence };
    }
    return out;
  });
  nodes.forEach(n => n.nb.forEach(i => { const o = nodes.find(x => x.id === i); if(!o.nb.includes(n.id)) o.nb.push(n.id); }));
  return { id: 'm' + Date.now(), v: 1, name: String(m.name || 'Map').slice(0, 60), building: String(m.building || '').slice(0, 60),
           floor: String(m.floor ?? '').slice(0, 8), created: Date.now(), nodes };
}
