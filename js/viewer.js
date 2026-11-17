import { findRoom, loadModels } from './ai.js';
import { exportTour, saveTour } from './db.js';
import { listen } from './voice.js';
import { publish } from './share.js';
import { $, show } from './ui.js';

let viewer;
const ARROW = '<svg viewBox="0 0 100 100" width="58" height="58"><path d="M50 8 L92 80 L50 62 L8 80 Z" fill="#4da3ff" stroke="#fff" stroke-width="5" stroke-linejoin="round"/></svg>';
const wrap = a => ((a % 360) + 540) % 360 - 180;

export function openTour(t, nav){
  show('tour'); $('tName').textContent = t.name;
  const byId = id => t.nodes.find(x => x.id === id), url = {};
  t.nodes.forEach(n => url[n.id] = URL.createObjectURL(n.blob));
  const lim = n => n.haov < 360 ? n.haov/2 - 6 : 180, clamp = (n, y) => Math.max(-lim(n), Math.min(lim(n), y));
  const go = (n, l) => {                                   // Street View style: turn, zoom toward the arrow, fade into the next spot
    const to = byId(l.to), back = to.links.find(x => x.to === n.id);
    viewer.lookAt(-4, clamp(n, l.yaw), 55, 450);
    setTimeout(() => viewer.loadScene(to.id, 0, back ? clamp(to, wrap(back.yaw + 180)) : 'same', Math.min(100, maxH(to))), 380);
  };
  let editing = false;
  const pano = $('pano'), asp = (pano.clientHeight || 400) / (pano.clientWidth || 600);
  const maxH = n => Math.min(110, Math.max(45, 2*Math.atan(Math.tan(n.vaov*Math.PI/360)*0.98/asp)*180/Math.PI));   // never zoom out wider than the picture is tall
  const drag = (el, n, l) => {
    el.style.touchAction = 'none';
    ['mousedown', 'touchstart'].forEach(k => el.addEventListener(k, e => { if(editing) e.stopPropagation(); }, true));   // the picture must not turn while you drag
    el.addEventListener('pointerdown', e => {
      if(!editing) return;
      e.preventDefault(); e.stopPropagation();
      const ghost = el.cloneNode(true); ghost.className = 'ghostArrow'; document.body.append(ghost);
      const put = ev => { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; };
      const move = ev => { put(ev); ev.preventDefault(); };
      const up = ev => {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
        ghost.remove();
        const [pitch, yaw] = viewer.mouseEventToCoords({ clientX: ev.clientX, clientY: ev.clientY });
        if(isFinite(yaw) && isFinite(pitch)){
          l.yaw = clamp(n, yaw); l.pitch = Math.max(-n.vaov/2 + 5, Math.min(n.vaov/2 - 5, pitch));
          viewer.removeHotSpot(n.id + '>' + l.to, n.id); viewer.addHotSpot(hs(n, l), n.id);
          if(!nav.back) saveTour(t);
        }
      };
      put(e);
      document.addEventListener('pointermove', move, { passive:false });
      document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    }, true);
  };
  const hs = (n, l) => ({ id: n.id + '>' + l.to, type:'info', pitch: l.pitch ?? -10, yaw: clamp(n, l.yaw), cssClass:'arrowHS',
    createTooltipFunc: d => { d.innerHTML = ARROW; d.title = 'Go to ' + byId(l.to).name; drag(d, n, l); },
    clickHandlerFunc: () => { if(!editing) go(n, l); } });
  const scenes = {};
  t.nodes.forEach(n => {
    const yb = n.haov < 360 ? n.haov/2 : 175;                                  // locked at both ends: no wrap-around seam
    scenes[n.id] = {
      type:'equirectangular', panorama:url[n.id], haov:n.haov, vaov:n.vaov,
      minYaw:-yb, maxYaw:yb, minPitch:-n.vaov/2, maxPitch:n.vaov/2,
      hfov:Math.min(100, maxH(n)), minHfov:40, maxHfov:maxH(n),
      hotSpots: n.links.map(l => hs(n, l))
    };
  });
  const preload = id => byId(id).links.forEach(l => { const im = new Image(); im.src = url[l.to]; if(im.decode) im.decode().catch(() => {}); });
  if(viewer) viewer.destroy();
  viewer = pannellum.viewer('pano', { default:{ firstScene:t.nodes[0].id, autoLoad:true, showControls:false, sceneFadeDuration:700, hfov:100 }, scenes });
  preload(t.nodes[0].id);
  const sel = $('roomSel'); sel.innerHTML = '';
  t.nodes.forEach(n => sel.add(new Option(n.name, n.id)));
  sel.onchange = () => viewer.loadScene(sel.value);
  let scene = t.nodes[0].id;
  viewer.on('scenechange', id => { scene = id; sel.value = id; preload(id); });       // next spots are ready before you tap

  const fl = $('floors'); fl.innerHTML = '';                                           // floor numbers on the side
  (nav.siblings || []).filter(s => s.floor != null).sort((a, b) => String(a.floor).localeCompare(String(b.floor), undefined, { numeric:true })).forEach(s => {
    const b = document.createElement('button'); b.textContent = s.floor; b.className = s.id === t.id ? '' : 'ghost'; b.type = 'button'; b.setAttribute('aria-current', s.id === t.id ? 'true' : 'false');
    b.onclick = () => nav.open && nav.open(s); fl.append(b);
  });

  const go2 = async q => { await loadModels(() => {}); const n = await findRoom(t.nodes, q); viewer.loadScene(n.id); };
  $('tSearch').onkeydown = e => { if(e.key === 'Enter') go2(e.target.value); };
  $('tMic').onclick = () => listen(q => { $('tSearch').value = q; go2(q); });
  $('tAR').hidden = !nav.ar; $('tExport').hidden = !nav.ar; $('tBack').hidden = !nav.back; $('tShare').hidden = !nav.ar;
  $('tAR').onclick = () => nav.ar && nav.ar(t); $('tExport').onclick = () => exportTour(t); $('tBack').onclick = () => nav.back && nav.back();
  editing = false; $('tHint').hidden = true; $('tEdit').textContent = 'Edit arrows'; $('tEdit').setAttribute('aria-pressed', 'false'); $('tEdit').hidden = !(nav.ar || nav.back);
  $('tEdit').onclick = () => { editing = !editing; $('tEdit').textContent = editing ? 'Done editing' : 'Edit arrows'; $('tEdit').setAttribute('aria-pressed', String(editing)); $('tHint').hidden = !editing; };
  $('tQR').hidden = !t.building;
  $('tQR').onclick = async () => {
    const n = byId(scene), a = document.createElement('a');
    a.href = await QRCode.toDataURL(`sg:${t.building}|${t.floor}|${n.name}`, { width:600, margin:2 });
    a.download = `QR ${t.building} floor ${t.floor} ${n.name}.png`; a.click();
  };
  $('tShare').onclick = async () => {
    const b = $('tShare'); b.disabled = true;
    try{
      const link = await publish(nav.siblings && nav.siblings.length ? nav.siblings : [t], m => b.textContent = m);
      const a = document.createElement('a'); a.href = await QRCode.toDataURL(link, { width:600, margin:2 }); a.download = 'Tour QR.png';
      if(navigator.share) navigator.share({ title: t.name, url: link }).catch(() => {});
      else await navigator.clipboard.writeText(link).catch(() => {});
      a.click(); b.textContent = 'Link ready. QR saved.';
    }catch(e){ b.textContent = 'Share failed. Check the Supabase setup.'; }
    b.disabled = false;
  };
}