// Draws a map as SVG: corridors as lines, rooms as dots labelled on the side their door faces,
// the route in the accent colour, and the person as the arrow mark.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GLYPH = 'M50 8 L92 80 L50 62 L8 80 Z';

export function drawMap(svg, map, { route = null, you = null, heading = 0, labels = true, start = null, end = null } = {}){
  const ns = map.nodes; if(!ns.length){ svg.innerHTML = ''; return; }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for(const n of ns){ x0 = Math.min(x0, n.pos[0]); x1 = Math.max(x1, n.pos[0]); z0 = Math.min(z0, n.pos[2]); z1 = Math.max(z1, n.pos[2]); }
  const pad = labels ? 3 : 1.5, w = Math.max(x1 - x0, 6) + pad * 2, h = Math.max(z1 - z0, 6) + pad * 2;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, fs = Math.max(w, h) / (labels ? 24 : 18);
  svg.setAttribute('viewBox', `${cx - w / 2} ${cz - h / 2} ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const byId = new Map(ns.map(n => [n.id, n])), out = [];
  for(const n of ns) for(const b of n.nb) if(b > n.id && byId.has(b)){
    const o = byId.get(b); out.push(`<line class="mm-edge" x1="${n.pos[0]}" y1="${n.pos[2]}" x2="${o.pos[0]}" y2="${o.pos[2]}" vector-effect="non-scaling-stroke"/>`);
  }
  if(route && route.pts.length > 1) out.push(`<polyline class="mm-route" fill="none" vector-effect="non-scaling-stroke" points="${route.pts.map(q => q.p[0].toFixed(2) + ',' + q.p[2].toFixed(2)).join(' ')}"/>`);
  for(const n of ns) if(n.room){
    const on = n.id === end ? ' mm-end' : n.id === start ? ' mm-start' : '';
    out.push(`<circle class="mm-room${on}" cx="${n.pos[0]}" cy="${n.pos[2]}" r="${fs * (on ? .42 : .28)}"/>`);
    if(labels || on){
      const yaw = n.yaw || 0, lx = n.pos[0] - Math.sin(yaw) * fs * 1.5, lz = n.pos[2] - Math.cos(yaw) * fs * 1.5;
      out.push(`<text class="mm-label${on}" x="${lx}" y="${lz}" font-size="${fs}" text-anchor="middle" dominant-baseline="central">${esc(n.room)}</text>`);
    }
  }
  if(you){
    const s = fs * .018, a = -heading * 180 / Math.PI;
    out.push(`<g class="mm-you" transform="translate(${you[0]} ${you[2]}) rotate(${a}) scale(${s}) translate(-50 -50)"><path d="${GLYPH}"/></g>`);
  }
  svg.innerHTML = out.join('');
}
