import assert from 'node:assert/strict';
import { parseMap, sampleMap, Recorder, newMap, byId, d2, findRoom, roomsOf, nearestNode } from '../js/graph.js';
import { astar, chaikin, resample, buildRoute, makeAlign, Walker } from '../js/route.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const m = sampleMap(), id = r => findRoom(m, r).id;

t('sample map has 12 rooms, sorted naturally', () => { const r = roomsOf(m).map(x => x.room); assert.equal(r.length, 12); assert.deepEqual(r, [...r].sort((a, b) => a - b)); });
t('A* finds the straight corridor', () => { const p = astar(m, id('401'), id('407')); assert.equal(p[0], id('401')); assert.equal(p.at(-1), id('407')); assert.equal(p.length, 19); });
t('A* goes round the corner into the east wing', () => { const p = astar(m, id('401'), id('412')); assert.ok(p.length > 30); assert.equal(p.at(-1), id('412')); });
t('A* returns null when unconnected', () => { const x = newMap({}); const a = { id: 1, pos: [0, 0, 0], nb: [] }, b = { id: 2, pos: [5, 0, 0], nb: [] }; x.nodes.push(a, b); assert.equal(astar(x, 1, 2), null); });
t('chaikin keeps the ends and rounds corners', () => { const o = chaikin([[0, 0, 0], [0, 0, -4], [4, 0, -4]], 2); assert.deepEqual(o[0], [0, 0, 0]); assert.deepEqual(o.at(-1), [4, 0, -4]); assert.ok(o.every(p => !(p[0] === 0 && p[2] === -4))); });
t('resample spaces points evenly and ends on the last point', () => { const r = resample([[0, 0, 0], [0, 0, -5]], .5); assert.equal(r.pts.length, 11); assert.ok(Math.abs(r.length - 5) < 1e-9); assert.ok(Math.abs(r.pts[1].p[2] + .5) < 1e-9); assert.ok(Math.abs(r.pts[0].yaw) < 1e-9); });
t('heading convention: walking -x is yaw +90deg', () => { const r = resample([[0, 0, 0], [-3, 0, 0]], 1); assert.ok(Math.abs(r.pts[0].yaw - Math.PI / 2) < 1e-9); });
t('alignment maps the entry onto the user and round-trips', () => {
  const E = [3, 0, -7], q = [10, 1.4, 4], a = makeAlign(E, Math.PI / 2, q, 0.3, 0);
  const s = a.toNav(E); assert.ok(Math.abs(s[0] - 10) < 1e-9 && Math.abs(s[2] - 4) < 1e-9 && s[1] === 0);
  const g = [5, 0, -12], b = a.toGraph(a.toNav(g)); g.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9));
});
t('alignment rotates the route with the user: facing 90deg off turns the corridor 90deg', () => {
  const E = [0, 0, 0], a = makeAlign(E, 0, [0, 0, 0], Math.PI / 2, 0), p = a.toNav([0, 0, -4]);   // route runs along -z; user faces -x
  assert.ok(Math.abs(p[0] + 4) < 1e-9 && Math.abs(p[2]) < 1e-9);
});
t('walker: walking the route arrives, remaining shrinks, chevrons stay ahead', () => {
  const w = new Walker(m, id('401'), id('412')), r = w.route; let last = Infinity, arrived = false, time = 0;
  for(const pt of r.pts){
    const u = w.update(pt.p, pt.yaw, time += 700); assert.ok(u.remaining <= last + 1e-9); last = u.remaining;
    assert.ok(u.chevrons.length <= 14); if(u.chevrons[0]) assert.ok(d2(u.chevrons[0].p, pt.p) >= .5 - 1e-6);
    if(u.arrived){ arrived = true; assert.equal(u.chevrons.length, 0); break; }
  }
  assert.ok(arrived);
});
t('walker: facing the wrong way says back; facing along says ahead', () => {
  const w = new Walker(m, id('401'), id('407')), p = w.route.pts[3];
  assert.equal(w.update(p.p, p.yaw + Math.PI, 0).hint, 'back'); assert.equal(w.update(p.p, p.yaw, 0).hint, 'ahead');
  assert.equal(w.update(p.p, p.yaw + 1, 0).hint, 'right'); assert.equal(w.update(p.p, p.yaw - 1, 0).hint, 'left');
});
t('walker: straying off the route re-routes from the nearest node after 1.5 s', () => {
  const w = new Walker(m, id('401'), id('407')), far = byId(m, id('410')).pos;            // standing in the east wing, far from the 401-407 route
  const a = w.update(far, 0, 1000); assert.ok(a.off && !a.rerouted);                      // first sight of being off route: wait
  const r = w.update(far, 0, 3000); assert.ok(r.rerouted);                                // still off after 1.5 s: new route
  assert.equal(w.route.ids[0], id('410')); assert.equal(w.route.ids.at(-1), id('407'));
  assert.ok(!w.update(far, 0, 3200).off);                                                // and now we are on the new route
});
t('recorder: breadcrumbs, snapping back on retrace, entries', () => {
  const x = newMap({ building: 'B', floor: 1 }), R = new Recorder(x);
  for(let i = 0; i <= 10; i++) R.update([0, 0, -i * .5]);                                  // 5 m walk, a node at the first sample past 1.2 m
  assert.deepEqual(x.nodes.map(n => n.pos[2] + 0), [0, -1.5, -3, -4.5]);
  R.mark([0, 0, -4.5], Math.PI / 2, '101'); assert.equal(findRoom(x, '101').yaw, Math.PI / 2);
  const before = x.nodes.length;
  R.update([0.2, 0, -3.1]); R.update([0.1, 0, -1.6]);                                      // walking back over old nodes
  assert.equal(x.nodes.length, before);
  assert.ok(byId(x, 3).nb.length >= 2 && byId(x, 2).nb.length >= 2);                      // still one connected chain
  assert.ok(findRoom(x, '101').nb.length >= 1);
  R.mark([1, 0, -4.5], 0, '101'); assert.equal(x.nodes.filter(n => n.room === '101').length, 1);   // re-marking moves, never duplicates
});
t('recorder: QR checkpoints join the walked path and survive map import', () => {
  const x = newMap({ building: 'B' }), R = new Recorder(x);
  R.update([0, 0, 0]); R.update([0, 0, -1.2]);
  const cp = R.markCheckpoint([0, 0, -2.4], Math.PI / 2, 'cp_123456789');
  assert.ok(cp.nb.includes(x.nodes[1].id)); assert.equal(cp.yaw, Math.PI / 2);
  const loaded = parseMap(JSON.stringify(x));
  assert.equal(loaded.nodes.find(n => n.id === cp.id).checkpoint, 'cp_123456789');
});
t('recorder: nearby QR checkpoint does not overwrite a room sign direction', () => {
  const x = newMap({ building: 'B' }), R = new Recorder(x);
  R.update([0, 0, 0]); const room = R.mark([0, 0, -0.2], 0, '101');
  const cp = R.markCheckpoint([0, 0, -0.3], Math.PI / 2, 'cp_987654321');
  assert.notEqual(cp.id, room.id); assert.equal(room.yaw, 0);
  assert.ok(room.nb.includes(cp.id)); assert.equal(room.checkpoint, undefined);
});
t('parseMap accepts a saved map and repairs one-way links', () => {
  const raw = JSON.parse(JSON.stringify(m)); raw.nodes[0].nb = [raw.nodes[1].id]; raw.nodes[1].nb = [];
  const p = parseMap(JSON.stringify(raw)); assert.ok(p.nodes[1].nb.includes(p.nodes[0].id)); assert.equal(p.nodes.length, m.nodes.length); assert.notEqual(p.id, m.id);
});
t('parseMap preserves bounded CLIP suggestions as non-authoritative metadata', () => {
  const raw = JSON.parse(JSON.stringify(m));
  raw.nodes[0].clipSuggestion = { label: 'Bedroom', confidence: 0.62 };
  raw.nodes[1].clipSuggestion = { label: '<script>', confidence: 1.2 };
  const p = parseMap(JSON.stringify(raw));
  assert.deepEqual(p.nodes[0].clipSuggestion, { label: 'Bedroom', confidence: 0.62 });
  assert.equal(p.nodes[1].clipSuggestion, undefined);
});
t('parseMap rejects junk and trims hostile labels', () => {
  assert.throws(() => parseMap('{"nodes":[]}')); assert.throws(() => parseMap('{"nodes":[{"id":1,"pos":["a",0,0]}]}')); assert.throws(() => parseMap('null'));
  const p = parseMap(JSON.stringify({ nodes: [{ id: 1, pos: [0, 0, 0], nb: [99], room: '<img src=x onerror=alert(1)>'.repeat(3) }] }));
  assert.equal(p.nodes[0].room.length, 12); assert.deepEqual(p.nodes[0].nb, []);
});
console.log(`\n${n} tests passed`);
