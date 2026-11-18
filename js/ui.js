import { placeOf } from './graph.js';
export const $ = id => document.getElementById(id);
export const el = (tag, cls, text) => { const e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; };
export function show(v){
  document.querySelectorAll('.view').forEach(s => s.hidden = s.id !== v);
  $('homeBtn').hidden = v === 'home';
  document.body.dataset.view = v;                      // the header and page width key off this
}
// The AR overlay holds several docks; only one shows at a time. null brings back the original (panorama tour) dock.
export function xrMode(name){
  ['xrLegacy', 'xrWalk', 'xrMap'].forEach(id => $(id).hidden = name === null ? id !== 'xrLegacy' : id !== name);
  $('xrSheet').hidden = true;
}
// A list of rooms as tappable rows: "422  Main building, floor 4". items: [{ map, n }]
export function fillRooms(ul, items, query, onPick, emptyText = 'No rooms on this map.'){
  const q = (query || '').trim().toLowerCase(); ul.innerHTML = '';
  const shown = items.filter(({ map, n }) => !q || n.room.toLowerCase().includes(q) || placeOf(map).toLowerCase().includes(q));
  if(!shown.length){ ul.append(el('li', 'none', q ? 'No rooms match.' : emptyText)); return; }
  shown.forEach(({ map, n }) => {
    const li = el('li'), b = el('button', 'roomrow'); b.type = 'button';
    const sub = [n.clipSuggestion ? `CLIP guess: ${n.clipSuggestion.label}` : '', placeOf(map)].filter(Boolean).join(' · ');
    b.append(el('b', '', n.room), el('span', '', sub)); b.onclick = () => onPick(map, n); li.append(b); ul.append(li);
  });
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
