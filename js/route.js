import { byId, d2, d3, wrap, nearestNode } from './graph.js';
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const yawOf = (a, b) => Math.atan2(-(b[0] - a[0]), -(b[2] - a[2]));

export function astar(map, from, to){
  const idx = new Map(map.nodes.map(n => [n.id, n]));
  if(!idx.has(from) || !idx.has(to)) return null;
  const goal = idx.get(to).pos, h = id => d3(idx.get(id).pos, goal);
  const g = new Map([[from, 0]]), f = new Map([[from, h(from)]]), prev = new Map(), open = new Set([from]);
  while(open.size){
    let cur = null, cf = Infinity;
    for(const id of open){ const v = f.get(id); if(v < cf){ cf = v; cur = id; } }
    if(cur === to){ const out = [cur]; while(prev.has(out[0])) out.unshift(prev.get(out[0])); return out; }
    open.delete(cur);
    for(const nb of idx.get(cur).nb){
      const nn = idx.get(nb); if(!nn) continue;
      const t = g.get(cur) + d3(idx.get(cur).pos, nn.pos);
      if(t < (g.has(nb) ? g.get(nb) : Infinity)){ prev.set(nb, cur); g.set(nb, t); f.set(nb, t + h(nb)); open.add(nb); }
    }
  }
  return null;
}

export function chaikin(pts, rounds = 2){                                  // rounds the corners, keeps both ends
  for(let r = 0; r < rounds && pts.length > 2; r++){
    const out = [pts[0]];
    for(let i = 0; i < pts.length - 1; i++){ out.push(lerp(pts[i], pts[i + 1], .25), lerp(pts[i], pts[i + 1], .75)); }
    out.push(pts[pts.length - 1]); pts = out;
  }
  return pts;
}

export function resample(pts, step = .5){                                  // evenly spaced points with a heading each
  if(pts.length < 2) return { pts: pts.map(p => ({ p, yaw: 0, s: 0 })), length: 0 };
  const cum = [0]; for(let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + d3(pts[i - 1], pts[i]));
  const L = cum[cum.length - 1], out = []; let j = 0, yaw = 0;
  for(let s = 0; s <= L + 1e-9; s += step){
    while(j < cum.length - 2 && cum[j + 1] < s) j++;
    const a = pts[j], b = pts[j + 1], seg = cum[j + 1] - cum[j];
    if(seg > 1e-6) yaw = yawOf(a, b);
    out.push({ p: lerp(a, b, seg > 1e-6 ? Math.min(1, (s - cum[j]) / seg) : 0), yaw, s });
  }
  if(L - out[out.length - 1].s > 1e-6) out.push({ p: pts[pts.length - 1], yaw, s: L });
  return { pts: out, length: L };
}

export function buildRoute(map, from, to, step = .5){
  const ids = astar(map, from, to); if(!ids) return null;
  const pts = ids.map(id => byId(map, id).pos);
  return { ids, ...resample(chaikin(pts, 2), step) };
}

// Maps graph coordinates onto the AR session's coordinates. The user stands facing the sign of entry
// `pE` (heading phi, position q): that fixes the rotation and the shift. toGraph is the inverse.
export function makeAlign(pE, psiE, q, phi, floorY){
  const d = wrap(phi - psiE), c = Math.cos(d), s = Math.sin(d);
  return {
    delta: d,
    toNav: g => { const x = g[0] - pE[0], z = g[2] - pE[2]; return [x * c + z * s + q[0], floorY + (g[1] - pE[1]), -x * s + z * c + q[2]]; },
    toGraph: n => { const x = n[0] - q[0], z = n[2] - q[2]; return [x * c - z * s + pE[0], pE[1] + (n[1] - floorY), x * s + z * c + pE[2]]; },
  };
}

export const fmtDist = m => m < 10 ? `${m.toFixed(1).replace(/\.0$/, '')} m` : `${Math.round(m)} m`;
export const walkMinutes = m => Math.max(1, Math.round(m / 78));

// Follows a person along a route. update() takes their position in graph coordinates and says which
// chevrons to show, how far is left, whether they arrived and whether they strayed (then it re-routes).
export class Walker {
  constructor(map, startId, destId, { step = .5, ahead = 14, lead = 2 } = {}){
    this.map = map; this.dest = destId; this.step = step; this.ahead = ahead; this.lead = lead;
    this.route = buildRoute(map, startId, destId, step); this.idx = 0; this.offSince = null;
  }
  update(user, heading, t = 0){
    let r = this.route; if(!r) return { error: 'No route' };
    const near = (lo, hi) => { let b = lo, bd = Infinity; for(let i = lo; i <= hi; i++){ const d = d2(r.pts[i].p, user); if(d < bd){ bd = d; b = i; } } return [b, bd]; };
    let [b, bd] = near(Math.max(0, this.idx - 4), Math.min(r.pts.length - 1, this.idx + 30));
    if(bd > 3) [b, bd] = near(0, r.pts.length - 1);
    this.idx = b;
    let rerouted = false;
    if(bd > 3){
      if(this.offSince == null) this.offSince = t;
      else if(t - this.offSince > 1500){
        const n = nearestNode(this.map, user, 6), nr = n && buildRoute(this.map, n.id, this.dest, this.step);
        if(nr){ this.route = r = nr; this.idx = 0; rerouted = true; }
        this.offSince = null;
      }
    } else this.offSince = null;
    const dn = byId(this.map, this.dest), arrived = d2(dn.pos, user) < 1.2;
    const chevrons = [];
    if(!arrived) for(let k = 0; k < this.ahead; k++){
      const p = r.pts[this.idx + this.lead + k]; if(!p) break;
      chevrons.push({ p: p.p, yaw: p.yaw, a: Math.min(1, (k + 1) / 3) * Math.min(1, (this.ahead - k) / 4) });
    }
    let hint = 'ahead';
    if(!arrived && heading != null){
      const q = r.pts[Math.min(this.idx + 4, r.pts.length - 1)].p, want = Math.atan2(-(q[0] - user[0]), -(q[2] - user[2])), diff = wrap(want - heading);
      if(d2(q, user) > .8) hint = Math.abs(diff) > 2 ? 'back' : Math.abs(diff) > .6 ? (diff > 0 ? 'left' : 'right') : 'ahead';
    }
    return { chevrons, remaining: Math.max(0, r.length - r.pts[this.idx].s), arrived, rerouted, off: bd > 3, hint, idx: this.idx };
  }
}
