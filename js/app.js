import { listTours, deleteTour, importTour, listMaps, saveMap, deleteMap, importMap, exportMap } from './db.js';
import { sampleMap } from './graph.js';
import { drawMap } from './minimap.js';
import { startBuilder } from './builder.js';
import { openTour } from './viewer.js';
import { openAR } from './ar.js';
import { loadShared } from './share.js';
import { openNavigate } from './navigate.js';
import { openMapNew } from './mapper.js';
import { $, el, show } from './ui.js';
import { roomsOf, placeOf } from './graph.js';

let all = [];
const open = (t, siblings = [t]) => openTour(t, { ar: x => openAR(x, () => open(x, siblings)), siblings });
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const note = m => { const box = $('list'); box.innerHTML = ''; box.append(el('p', 'note', m)); };
const key = (e, fn) => { if((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget){ e.preventDefault(); fn(); } };

// Delete asks first, and says what it will delete.
function confirmDelete(d, what, detail, onYes, onNo){
  d.className = 'card confirm'; d.onclick = d.onkeydown = null; d.removeAttribute('role'); d.removeAttribute('tabindex'); d.innerHTML = '';
  const p = el('p'); p.append('Delete ', el('b', '', what), `? ${detail} This can't be undone.`);
  const row = el('div', 'row');
  const no = el('button', 'ghost', 'Cancel'); no.type = 'button'; no.onclick = onNo;
  const yes = el('button', 'danger', 'Delete'); yes.type = 'button'; yes.onclick = onYes;
  row.append(no, yes); d.append(p, row); no.focus();
}

// ---- tabs ----
function tab(name){
  $('home').dataset.tab = name;
  [['nav', 'tabNav', 'navPanel'], ['tours', 'tabTours', 'toursPanel']].forEach(([n, t, p]) => { $(t).setAttribute('aria-selected', String(n === name)); $(p).hidden = n !== name; });
}
$('tabNav').onclick = () => tab('nav'); $('tabTours').onclick = () => tab('tours');

// ---- maps ----
function emptyMaps(){
  const d = el('div', 'empty');
  d.append(el('h2', '', 'No maps on this device yet'), el('p', '', 'A map is a corridor you walk once with AR on. Mark each room as you pass it, then navigate by scanning any room sign.'));
  const row = el('div', 'row'); row.style.marginTop = '16px';
  const b = el('button', 'ghost', 'Add a sample map'); b.type = 'button';
  b.onclick = async () => { await saveMap(sampleMap()); home(); };
  row.append(b); d.append(row, el('p', 'hint', 'The sample is a made-up L-shaped corridor, so you can try the flow without walking a building.')); return d;
}
function mapCard(m){
  const d = el('div', 'card'); d.tabIndex = 0; d.setAttribute('role', 'button');
  d.setAttribute('aria-label', `${m.name}: choose where you are`);
  const thumb = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); thumb.setAttribute('class', 'cover'); thumb.setAttribute('aria-hidden', 'true');
  drawMap(thumb, m, { labels: false });
  const meta = el('div', 'meta'), name = el('b', 'name', m.name);
  meta.append(name, el('span', 'sub', [m.sample ? 'Sample' : '', placeOf(m), count(roomsOf(m).length, 'room', 'rooms')].filter(Boolean).join(', ')));
  const acts = el('div', 'acts'), ex = el('button', '', 'Export'), x = el('button', '', 'Delete');
  ex.type = x.type = 'button'; ex.setAttribute('aria-label', 'Export ' + m.name); x.setAttribute('aria-label', 'Delete ' + m.name);
  ex.onclick = e => { e.stopPropagation(); exportMap(m); };
  x.onclick = e => { e.stopPropagation(); confirmDelete(d, m.name, 'Its corridors and rooms are removed from this device.', async () => { await deleteMap(m.id); home(); }, home); };
  acts.append(ex, x); d.append(thumb, meta, acts);
  d.onclick = () => openNavigate(home, { map: m }); d.onkeydown = e => key(e, d.onclick);
  return d;
}

// ---- panorama tours ----
function emptyTours(){
  const d = el('div', 'empty');
  d.append(el('h2', '', 'No tours on this device yet'), el('p', '', 'Capture a space and Spatial Guide names the rooms and links them for you.'));
  const ol = el('ol', 'steps');
  [['Capture', 'Turn on the spot, load panoramas or walk a video.'], ['Check', 'Fix room names and see which spots connect.'], ['Walk it', 'Browse the tour, or follow AR arrows to any room.']].forEach(([a, b]) => {
    const li = el('li'); li.append(el('b', '', a), document.createTextNode(b)); ol.append(li);
  });
  d.append(ol); return d;
}
function tourCard(t){
  const d = el('div', 'card'); d.tabIndex = 0; d.setAttribute('role', 'button');
  const cover = el('img', 'cover'); cover.alt = '';
  if(t.nodes[0] && t.nodes[0].blob){ cover.src = URL.createObjectURL(t.nodes[0].blob); cover.onload = () => URL.revokeObjectURL(cover.src); }
  const meta = el('div', 'meta');
  meta.append(el('b', 'name', t.name), el('span', 'sub', [t.floor != null ? `Floor ${t.floor}` : '', count(t.nodes.length, 'spot', 'spots')].filter(Boolean).join(', ')));
  const x = el('button', 'del', 'Delete'); x.type = 'button'; x.setAttribute('aria-label', 'Delete ' + t.name);
  x.onclick = e => { e.stopPropagation(); confirmDelete(d, t.name, `Its ${count(t.nodes.length, 'spot', 'spots')} will be removed from this device.`, async () => { await deleteTour(t.id); home(); }, home); };
  d.append(cover, meta, x);
  d.onclick = () => open(t); d.onkeydown = e => key(e, d.onclick);
  return d;
}

async function home(){
  all = [];
  show('home');
  const [maps, tours] = await Promise.all([listMaps(), listTours()]);
  const ml = $('mapList'), tl = $('list'); ml.innerHTML = tl.innerHTML = '';
  $('navSub').textContent = maps.length ? `${count(maps.length, 'map', 'maps')} on this device` : 'Maps are saved on this device';
  $('scanBtn').disabled = !maps.length;
  if(maps.length) maps.forEach(m => ml.append(mapCard(m))); else ml.append(emptyMaps());
  $('homeSub').textContent = tours.length ? `${count(tours.length, 'tour', 'tours')} on this device` : 'Saved on this device';
  if(tours.length) tours.forEach(t => tl.append(tourCard(t))); else tl.append(emptyTours());
}
const showTours = async () => { await home(); tab('tours'); };
$('homeBtn').onclick = home;
$('scanBtn').onclick = () => openNavigate(home);
$('mapNewBtn').onclick = () => openMapNew(home, showTours);
$('newBtn').onclick = () => startBuilder(home);
$('importFile').onchange = async e => { if(e.target.files[0]){ await importTour(e.target.files[0]); home(); } };
$('mapImport').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if(!f) return;
  try{ await importMap(f); home(); }catch(err){ $('navSub').textContent = err.message; }
};
for(const id of ['importLabel', 'mapImportLabel']) $(id).onkeydown = e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); e.currentTarget.querySelector('input').click(); } };
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js', { updateViaCache:'none' })
    .then(reg => reg.update())
    .catch(error => console.error('Service worker update failed:', error));
}
const sh = location.hash.match(/^#s=(\w+)/);
if(sh){
  show('home'); tab('tours'); note('Opening the shared tour...');
  loadShared(sh[1], note).then(ts => { all = ts; open(ts[0], all); })
    .catch(() => note('Could not open this tour.'));
} else home();
