import { loadModels, loadBuildModels, analysePano, link, dropGrids, nameRooms } from './ai.js';
import { sweep, videoFrames, recordWalk } from './capture.js';
import { openTour } from './viewer.js';
import { saveTour, saveDraft, loadDraft, clearDraft } from './db.js';
import { $, show } from './ui.js';

export async function startBuilder(done, preset = {}){
  show('builder');
  const msg = t => $('bMsg').textContent = t;
  const dr = await loadDraft();                                            // sweeps from earlier are still here
  let files = dr.files, ordered = dr.ordered, mode = 'photo', live = null;
  $('bName').value = preset.building || ''; $('bFloor').value = preset.floor ?? ''; $('bFiles').value = ''; $('bVideo').value = '';
  $('bReview').innerHTML = '';
  const draw = () => {
    const box = $('bThumbs'); box.innerHTML = '';
    if(mode === 'video'){ msg(files.length ? (live && live.length ? 'Walk video ready, with live labels.' : 'Video ready.') : ''); return; }
    files.forEach((f, i) => {
      const d = document.createElement('div'), im = document.createElement('img'), x = document.createElement('button'), nb = document.createElement('span');
      im.src = URL.createObjectURL(f); x.type = 'button'; x.textContent = '\u00d7'; x.setAttribute('aria-label', 'Remove spot ' + (i + 1)); nb.textContent = i + 1;
      x.onclick = () => { files.splice(i, 1); refresh(); }; d.append(im, nb, x); box.append(d);
    });
    msg(files.length ? files.length + ' panoramas ready. Add more, or tap Build my tour.' : '');
  };
  const refresh = () => { saveDraft({ files: mode === 'photo' ? files : [], ordered }); draw(); };
  const add = (list, m, fromSweep) => {
    if(m !== mode || m === 'video'){ files = []; live = null; }
    mode = m; if(!fromSweep) ordered = false; files = files.concat(list); refresh();
  };
  const sweepFlow = deg => sweep(function cb(f, more){ show('builder'); if(f) add([f], 'photo', true); if(more) sweep(cb, deg); }, deg);
  const pick = {
    sweep: () => sweepFlow(360), sweep180: () => sweepFlow(180),
    photos: () => $('bFiles').click(), upload: () => $('bVideo').click(),
    record: () => recordWalk((blob, labels) => { show('builder'); if(blob){ add([blob], 'video', false); live = labels; draw(); } })
  };
  document.querySelectorAll('#bMethods [data-method]').forEach(b => b.onclick = () => { const f = pick[b.dataset.method]; if(f) f(); });
  $('bFiles').onchange = e => { const l = [...e.target.files]; e.target.value = ''; if(l.length) add(l, 'photo', false); };
  $('bVideo').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if(f) add([f], 'video', false); };
  draw();

  $('bBuild').onclick = async () => {
    if(!files.length) return msg('Choose how to create the tour first.');
    await loadModels(msg); await loadBuildModels(msg);
    const vid = mode === 'video'; let src = files;
    if(vid){
      src = await videoFrames(files[0], msg);
      if(src.length < 2) return msg('Not enough clear frames. Walk slower and use more light.');
    } else if(src.length < 2) return msg('Capture at least 2 spots.');
    const nodes = [], bad = [], t0 = Date.now();
    for(const [i, f] of src.entries()){
      const eta = i ? ` (about ${Math.ceil((Date.now() - t0) / i * (src.length - i) / 60000)} min left)` : '';
      const a = await analysePano(f, vid, t => msg(`${vid ? 'Frame' : 'Panorama'} ${i+1} of ${src.length}: ${t}${eta}`));
      a ? nodes.push({ id:'n'+i, blob:f, t:f.t, ...a }) : bad.push(f.name || 'photo');
    }
    if(nodes.length < 2) return msg('Not enough panoramas. Each photo must be a wide sweep or a full 360.');
    msg('Working out which spots are next to each other...');
    if(vid) nodes.forEach((n, i) => {
      n.links = [];
      if(i < nodes.length - 1) n.links.push({ to: nodes[i+1].id, yaw: 0 });
      if(i > 0) n.links.push({ to: nodes[i-1].id, yaw: 180 });
    });
    else link(nodes, ordered);
    dropGrids(nodes);
    msg('Naming rooms...'); await nameRooms(nodes);
    if(vid && live && live.length){                                       // live labels from recording help the names
      nodes.forEach(n => {
        const near = live.reduce((a, b) => Math.abs(b.t - n.t) < Math.abs(a.t - n.t) ? b : a);
        if(near.conf >= 0.4){ n.guesses = [near.label, ...(n.guesses || []).filter(g => g !== near.label)].slice(0, 3); if(!n.sign) n.name = near.label; }
      });
      const seen = {}; nodes.forEach(n => { seen[n.name] = (seen[n.name] || 0) + 1; if(seen[n.name] > 1) n.name += ' ' + seen[n.name]; });
    }
    msg(bad.length ? `Skipped (not panoramic): ${bad.join(', ')}` : 'Done. Preview the tour, check the names, then save.');
    review(nodes, done);
  };
}

const GLYPH = '<svg class="glyph" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 8 L92 80 L50 62 L8 80 Z"/></svg>';
const mkEl = (tag, cls, text) => { const e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; };

function review(nodes, done){
  const box = $('bReview'); box.innerHTML = '';
  const list = mkEl('ol', 'spine');
  const names = nodes.map((n, i) => {
    const li = mkEl('li', 'spot'), body = mkEl('div', 'body'), id = 'rn' + i;
    const img = mkEl('img'); img.alt = ''; img.src = URL.createObjectURL(n.blob);
    const lab = mkEl('label', '', 'Name'); lab.htmlFor = id;
    const inp = mkEl('input'); inp.id = id; inp.value = n.name; inp.autocomplete = 'off';
    const chips = mkEl('div', 'chips');
    (n.guesses || []).forEach(g => { const c = mkEl('button', 'ghost', g); c.type = 'button'; c.onclick = () => inp.value = g; chips.append(c); });
    const links = mkEl('p', 'links');
    if(n.links.length){
      links.append(mkEl('span', '', 'Arrows to'));
      n.links.forEach(l => { const s = mkEl('span'); s.innerHTML = GLYPH; s.append(nodes.find(x => x.id === l.to).name); links.append(s); });
    } else links.append(mkEl('span', 'none', 'No arrows yet'));
    body.append(img, lab, inp, chips, links); li.append(mkEl('span', 'idx', i + 1), body); list.append(li); return inp;
  });
  const floor = $('bFloor').value.trim(), stairs = mkEl('select'); stairs.id = 'bStairs';
  stairs.innerHTML = '<option value="">None</option>';
  nodes.forEach(n => { const o = new Option(n.name, n.id); if(/stair|lift|elevator/i.test(n.name)) o.selected = true; stairs.add(o); });
  const getTour = () => {
    nodes.forEach((n, i) => n.name = names[i].value || n.name);
    const name = $('bName').value || 'My space';
    return { id: Date.now()+'', name, building: floor !== '' ? name : null, floor: floor !== '' ? floor : null, connector: stairs.value || null, nodes };
  };
  const mk = (t, cls, fn) => { const b = mkEl('button', cls, t); b.type = 'button'; b.onclick = fn; return b; };
  const head = mkEl('div', 'review-h'); head.append(mkEl('h2', '', 'Check the spots'), mkEl('p', 'sub', 'Fix any name. Arrows show which spots connect.'));
  const sf = mkEl('div', 'field review-stairs'), sl = mkEl('label', '', 'Which spot is the stairs or lift? (optional)'); sl.htmlFor = 'bStairs'; sf.append(sl, stairs);
  box.append(head, list, sf);
  if(floor !== '') box.append(mk('Save and add another floor', 'ghost addfloor', async () => {
    const t = getTour(); await saveTour(t); await clearDraft();
    startBuilder(done, { building: t.name, floor: isNaN(+floor) ? '' : String(+floor + 1) });
  }));
  const bar = mkEl('div', 'save-bar');
  bar.append(mk('Preview tour', 'ghost', () => openTour(getTour(), { back: () => show('builder') })),
             mk('Save tour', '', async () => { await saveTour(getTour()); await clearDraft(); done(); }));
  box.append(bar); head.scrollIntoView();
}
