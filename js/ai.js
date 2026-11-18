// A small team of models. Each does the job it is best at:
//  CLIP = what a place IS (words + pictures)     DINOv2 = is it the SAME place
//  DETR = objects in the room (bed, sink, desk)  OCR = reads signs and door numbers
//  Depth Anything = which way is open space
import { pipeline, AutoProcessor, CLIPVisionModelWithProjection, AutoTokenizer, CLIPTextModelWithProjection, RawImage, env }
  from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
env.allowLocalModels = false;
const CLIP = 'Xenova/clip-vit-base-patch32';
let P, V, T, TK, DINO, DET, DEPTH, OCR;
let clipLoading, dinoLoading, ocrLoading;
const loadScript = u => new Promise((ok, no) => { const s = document.createElement('script'); s.src = u; s.onload = ok; s.onerror = no; document.head.append(s); });

async function loadClipModels(say){
  if(P && V && TK && T) return;
  if(!clipLoading) clipLoading = (async () => {
    say('Loading AI room-label model (first time only)...');
    P = await AutoProcessor.from_pretrained(CLIP); V = await CLIPVisionModelWithProjection.from_pretrained(CLIP);
    TK = await AutoTokenizer.from_pretrained(CLIP); T = await CLIPTextModelWithProjection.from_pretrained(CLIP);
  })();
  try{ await clipLoading; }
  catch(error){ clipLoading = null; throw error; }
}
export async function loadFrameLabelModel(say = () => {}){
  await loadClipModels(say);
}
// needed by visitors (AR, search) and owners
export async function loadModels(say){
  await loadClipModels(say);
  if(DINO) return;
  if(!dinoLoading) dinoLoading = pipeline('image-feature-extraction', 'Xenova/dinov2-small');
  try{ DINO = await dinoLoading; }
  catch(error){ dinoLoading = null; throw error; }
}
async function loadOCR(){
  if(OCR) return;
  if(!ocrLoading) ocrLoading = (async () => {
    await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    OCR = await Tesseract.createWorker('eng');
  })();
  try{ await ocrLoading; }
  catch(error){ ocrLoading = null; throw error; }
}
// extra helpers, only used while building a tour
export async function loadBuildModels(say){
  if(!DET || !DEPTH) say('Loading extra AI helpers (first time only)...');
  if(!DET) DET = await pipeline('object-detection', 'Xenova/detr-resnet-50');
  if(!DEPTH) DEPTH = await pipeline('depth-estimation', 'Xenova/depth-anything-small-hf');
  await loadOCR();
}

const norm = v => { const s = Math.sqrt(v.reduce((a,b) => a+b*b, 0)) || 1; return v.map(x => x/s); };
const dot = (a,b) => { let s = 0; for(let i=0;i<a.length;i++) s += a[i]*b[i]; return s; };
const fuse = (a,b) => 0.65*dot(a.d, b.d) + 0.35*dot(a.e, b.e);     // DINOv2 decides "same place", CLIP backs it up
const stats = arr => { const m = arr.reduce((a,b) => a+b, 0)/arr.length; return [m, Math.sqrt(arr.reduce((a,b) => a+(b-m)**2, 0)/arr.length) || 1]; };

async function embedImage(src){
  const { image_embeds } = await V(await P(await RawImage.read(src)));
  return norm(Array.from(image_embeds.data));
}
async function embedDino(src){ return norm(Array.from((await DINO(src)).data.slice(0, 384))); }   // first token = whole picture
async function embedDinoFull(src){                                          // whole picture + a 4x4 grid of local features
  const d = (await DINO(src)).data, D = 384, grid = [];
  const cls = norm(Array.from(d.slice(0, D)));
  for(let gy = 0; gy < 4; gy++) for(let gx = 0; gx < 4; gx++){
    const v = new Float32Array(D);
    for(let y = gy*4; y < gy*4 + 4; y++) for(let x = gx*4; x < gx*4 + 4; x++){ const o = (1 + y*16 + x) * D; for(let k = 0; k < D; k++) v[k] += d[o + k]; }
    let s = 0; for(let k = 0; k < D; k++) s += v[k]*v[k]; s = Math.sqrt(s) || 1; for(let k = 0; k < D; k++) v[k] /= s;
    grid.push(v);
  }
  return { cls, grid };
}
async function embedGrid(src){
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load panorama view for local matching.'));
    image.src = src;
  });
  const width = Math.floor(img.width / 4), height = Math.floor(img.height / 4), vectors = [];
  for(let y = 0; y < 4; y++) for(let x = 0; x < 4; x++){
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    c.getContext('2d').drawImage(img, x*width, y*height, width, height, 0, 0, width, height);
    vectors.push(await embedImage(c.toDataURL('image/jpeg', 0.85)));
  }
  return vectors;
}
async function embedText(list){
  const { text_embeds } = await T(TK(list, {padding:true, truncation:true}));
  const d = text_embeds.data, k = d.length / list.length;
  return list.map((_, i) => norm(Array.from(d.slice(i*k, (i+1)*k))));
}

// ---- helpers that read the picture ----
async function openness(url){                                       // 1 = wide open space, 0 = wall in your face
  const { data, width, height } = (await DEPTH(url)).depth; let s = 0, n = 0;
  for(let y = Math.floor(height*.35); y < height*.65; y++) for(let x = 0; x < width; x++){ s += data[y*width+x]; n++; }
  return 1 - s/n/255;
}
const SIGNS = ['reception','office','toilet','exit','laboratory','library','canteen','cafeteria','store','clinic','ward','lobby','entrance','lecture','hall','classroom','kitchen','washroom','admin'];
async function readSign(url){
  await loadOCR();
  const ws = ((await OCR.recognize(url)).data.words || []).filter(w => w.confidence > 60);
  const room = ws.map(w => w.text.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
    .find(text => /^[A-Z]{0,2}[0-9O]{2,4}[A-Z]?$/.test(text));
  if(room) return room.replace(/O/g, '0');
  const trusted = ws.filter(w => w.confidence > 85);
  const hit = trusted.find(w => SIGNS.includes(w.text.toLowerCase().replace(/[^a-z]/g, '')));
  if(hit){ const t = hit.text.replace(/[^a-zA-Z]/g, '').toLowerCase(); return t[0].toUpperCase() + t.slice(1); }
  return null;
}
const normalizeSign = value => (value || '').toUpperCase().replace(/^ROOM\s*/, '').replace(/[^A-Z0-9]/g, '');

// ---- Panoramas: strict check, then study each one in 90-degree windows ----
const loadImg = blob => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = URL.createObjectURL(blob); });
async function loadScaled(blob){                       // big phone photos are shrunk once, which makes every later step faster
  const img = await loadImg(blob), s = Math.min(1, 4096 / img.width); if(s === 1) return img;
  const c = document.createElement('canvas'); c.width = Math.round(img.width*s); c.height = Math.round(img.height*s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c;
}
function panoInfo(img){
  const r = img.width / img.height;
  if(r < 1.9) return null;                       // not a panorama
  const full = r <= 2.1;                         // full 360 photo
  return { haov: full ? 360 : Math.min(360, Math.round(r*75)), vaov: full ? 180 : 75 };
}
const yawsOf = h => { if(h <= 90) return [0]; const a = []; if(h === 360){ for(let y=-180;y<180;y+=45) a.push(y); } else for(let y=-h/2+45; y<=h/2-44; y+=45) a.push(y); return a; };
function crop(img, yaw, haov, size = 224){
  const full = haov === 360, W = img.width, H = img.height, w = Math.min(W, 90/haov*W);
  let x = (yaw/haov + 0.5)*W - w/2; if(!full) x = Math.max(0, Math.min(W-w, x));
  const t = document.createElement('canvas'); t.width = w; t.height = H;
  const g = t.getContext('2d'); [-W,0,W].forEach(o => g.drawImage(img, -x+o, 0));
  const c = document.createElement('canvas'); c.width = c.height = size;
  c.getContext('2d').drawImage(t, 0, full ? H*0.2 : 0, w, full ? H*0.6 : H, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.85);
}
export async function analysePano(blob, video, say = () => {}){
  const img = await loadScaled(blob); let info;
  if(video){ const haov = img.width >= img.height ? 70 : 45; info = { haov, vaov: Math.min(180, Math.round(haov*img.height/img.width)) }; }
  else info = panoInfo(img);
  if(!info) return null;
  const yaws = yawsOf(info.haov), wins = [], objs = [], signs = [];
  const detailIndex = yaws.reduce((best, yaw, i) => Math.abs(yaw) < Math.abs(yaws[best]) ? i : best, 0);
  for(const [i, yaw] of yaws.entries()){
    say(`checking view ${i+1} of ${yaws.length}`);
    const url = crop(img, yaw, info.haov), w = { yaw, e: await embedImage(url), d: await embedDino(url) };
    if(!video) w.g = await embedGrid(crop(img, yaw, info.haov, 896));
    if(!video && i === detailIndex){
      const big = crop(img, yaw, info.haov, 512);
      (await DET(big, { threshold: 0.7 })).forEach(o => objs.push(o.label));
      w.open = await openness(big);
      const s = await readSign(big); if(s) signs.push({ label:s, yaw });
    }
    wins.push(w);
  }
  if(!video){
    const known = wins.map((w, i) => w.open != null ? i : -1).filter(i => i >= 0);
    wins.forEach((w, i) => { if(w.open == null) w.open = wins[known.reduce((a, b) => Math.abs(b-i) < Math.abs(a-i) ? b : a)].open; });
  }
  const mean = k => norm(wins[0][k].map((_, i) => wins.reduce((s, w) => s + w[k][i], 0)));
  const count = {}; signs.forEach(s => count[s.label] = (count[s.label]||0) + 1);
  const sign = Object.keys(count).sort((a,b) => count[b]-count[a])[0] || null;
  const signMatch = signs.find(s => s.label === sign);
  return { ...info, wins, e: mean('e'), d: mean('d'), objs, sign, ...(signMatch ? { signYaw:signMatch.yaw } : {}) };
}

const wrap = a => ((a % 360) + 540) % 360 - 180;
function local(a, b){                       // how much of the same scene do two spots share, and where in a is it?
  let best = -1, bi = 0, per = null;
  a.wins.forEach((x, i) => b.wins.forEach(z => {
    const p = x.g.map(u => { let m = -1; for(const v of z.g){ const s = dot(u, v); if(s > m) m = s; } return m; });
    const sc = p.reduce((s, q) => s + q, 0) / 16;
    if(sc > best){ best = sc; bi = i; per = p; }
  }));
  let wsum = 0, off = 0;
  per.forEach((q, p) => { const w = Math.max(0, q - best); wsum += w; off += w * (((p % 4 + 0.5) / 4 - 0.5) * 90); });
  return { s: best, yaw: wrap(a.wins[bi].yaw + (wsum ? off / wsum : 0)) };     // arrow points at the shared content
}
export function link(nodes, ordered){
  nodes.forEach(n => n.links = []);
  const n = nodes.length, edges = [], has = (i, j) => edges.some(e => (e[0]===i && e[1]===j) || (e[0]===j && e[1]===i));
  const L = nodes.map((a, i) => nodes.map((b, j) => i === j ? null : local(a, b)));
  const zs = M => { const [m, sd] = stats(M.flat().filter((_, k) => k % (n+1) !== 0)); return M.map(r => r.map(x => (x - m) / sd)); };
  const Zg = zs(nodes.map((a, i) => nodes.map((b, j) => i === j ? 0 : fuse(a, b))));
  const Zl = zs(L.map(r => r.map(x => x ? x.s : 0)));
  const S = nodes.map((_, i) => nodes.map((__, j) => i === j ? -99 : 0.4*Zg[i][j] + 0.6*Zl[i][j] + (Math.abs(i-j) === 1 ? (ordered ? 9 : 0.3) : 0)));
  if(ordered) for(let i = 0; i < n-1; i++) edges.push([i, i+1]);          // swept in walking order: neighbours are known
  else {                                                                   // scattered: build the best connected tour from the scores
    const inT = [0];
    while(inT.length < n){
      let b = null;
      for(const i of inT) for(let j = 0; j < n; j++) if(!inT.includes(j) && (!b || S[i][j] > b.s)) b = { i, j, s:S[i][j] };
      edges.push([b.i, b.j]); inT.push(b.j);
    }
  }
  nodes.forEach((_, i) => {                                                // extra links only when the match is strong
    let bj = -1, bs = -99; S[i].forEach((s, j) => { if(j !== i && !has(i, j) && s > bs){ bs = s; bj = j; } });
    if(bj >= 0 && bs > (ordered ? 2.5 : 1.5)) edges.push([i, bj]);
  });
  for(const [i, j] of edges){ nodes[i].links.push({ to: nodes[j].id, yaw: L[i][j].yaw }); nodes[j].links.push({ to: nodes[i].id, yaw: L[j][i].yaw }); }
}
export function dropGrids(nodes){ nodes.forEach(n => n.wins.forEach(w => { delete w.g; })); }   // big working data, not saved

// ---- Auto naming: a sign on the wall wins; otherwise CLIP and the objects vote together ----
const LABELS = ['kitchen','bedroom','living room','bathroom','toilet','dining room','office','meeting room','classroom','lecture hall','computer lab','laboratory','library','reception','waiting area','lobby','corridor','staircase','store room','shop','canteen','balcony','garage','outdoor area'];
const TEMPLATES = ['a photo of a LABEL', 'a photo of the inside of a LABEL', 'an indoor photo of a LABEL'];
const CUES = { bed:['bedroom'], toilet:['toilet'], sink:['bathroom','kitchen'], refrigerator:['kitchen'], oven:['kitchen'], microwave:['kitchen'], toaster:['kitchen'],
  couch:['living room','waiting area'], tv:['living room','meeting room','waiting area'], 'dining table':['dining room','canteen'], laptop:['office','computer lab'], keyboard:['office','computer lab'],
  mouse:['office','computer lab'], book:['library'], chair:['classroom','meeting room','office'], bench:['waiting area','corridor'] };
const cap = s => s[0].toUpperCase() + s.slice(1);
let LT = null;
async function labelEmbeds(){
  if(LT) return LT;
  const emb = await embedText(LABELS.flatMap(l => TEMPLATES.map(t => t.replace('LABEL', l))));
  LT = LABELS.map((_, i) => norm(emb[0].map((__, k) => TEMPLATES.reduce((s, ___, j) => s + emb[i*TEMPLATES.length + j][k], 0))));
  return LT;
}
export async function suggestRoomNames(blob, say = () => {}){
  await loadClipModels(say);
  const url = URL.createObjectURL(blob);
  try{
    const [image, labels] = await Promise.all([embedImage(url), labelEmbeds()]);
    return labels.map((embedding, i) => ({ name:cap(LABELS[i]), score:dot(image, embedding) }))
      .sort((a, b) => b.score - a.score).slice(0, 3).map(x => x.name);
  } finally { URL.revokeObjectURL(url); }
}
export async function labelFrame(src){
  return (await rankFrameLabels(await embedImage(src)))[0];
}
async function rankFrameLabels(e){
  const te = await labelEmbeds();
  const raw = te.map(t => 100*dot(e, t)), mx = Math.max(...raw), ex = raw.map(x => Math.exp(x - mx)), z = ex.reduce((a,b) => a+b);
  return ex.map((x, i) => ({ label: cap(LABELS[i]), conf: x / z }))
    .sort((a, b) => b.conf - a.conf);
}
export async function nameRooms(nodes){
  const te = await labelEmbeds();
  const seen = {};
  nodes.forEach((n, idx) => {
    const score = LABELS.map(() => 0);
    n.wins.forEach(w => {
      const raw = te.map(t => 100*dot(w.e, t)), mx = Math.max(...raw), ex = raw.map(x => Math.exp(x - mx)), z = ex.reduce((a,b) => a+b);
      ex.forEach((x, i) => score[i] += x / z / n.wins.length);
    });
    const add = {};
    (n.objs || []).forEach(o => (CUES[o] || []).forEach(l => add[l] = Math.min(0.5, (add[l]||0) + 0.15)));
    LABELS.forEach((l, i) => score[i] += add[l] || 0);
    const order = score.map((_, i) => i).sort((a, b) => score[b] - score[a]);
    n.guesses = order.slice(0, 3).map(i => cap(LABELS[i]));
    const label = LABELS[order[0]], sure = score[order[0]] >= 0.35;
    if(n.sign && !/^Room/.test(n.sign)){ n.name = n.sign; return; }
    const base = sure ? cap(label) : 'Spot ' + (idx + 1);
    seen[base] = (seen[base]||0) + 1;
    n.name = base + (seen[base] > 1 && sure ? ' ' + seen[base] : '') + (n.sign ? ` (${n.sign})` : '');
  });
}
export async function findRoom(nodes, q){
  q = q.toLowerCase();
  const hit = nodes.find(n => n.name.toLowerCase().includes(q) || q.includes(n.name.toLowerCase()));
  if(hit) return hit;
  const [t] = await embedText(['a photo of ' + q]);
  return nodes.map(n => ({n, s: dot(n.e, t)})).sort((a,b) => b.s - a.s)[0].n;
}

// ---- AR: combine scene similarity with room-content cues for close neighboring spots ----
export async function locate(nodes, frame, force, onDebug = () => {}){
  const q = { e: await embedImage(frame), d: await embedDino(frame) }, all = [];
  for(const n of nodes) n.wins.forEach((w, i) => all.push({ s: fuse(q, w), node: n, i, yaw: w.yaw }));
  const best = all.reduce((a, b) => b.s > a.s ? b : a);
  const [m, sd] = stats(all.map(x => x.s));
  const z = (best.s - m) / sd;
  const other = Math.max(-1, ...all.filter(x => x.node !== best.node).map(x => x.s));
  const margin = best.s - other;
  const visualAccepted = best.s >= 0.6 && z > 3 && (nodes.length < 2 || margin >= 0.03);
  const [semantic, nextSemantic] = await rankFrameLabels(q.e);
  const compact = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const semanticNodes = nodes.filter(n => compact(n.name).includes(compact(semantic.label)));
  const semanticViews = semanticNodes.length === 1 ? all.filter(x => x.node === semanticNodes[0]) : [];
  const semanticBest = semanticViews.reduce((a, b) => !a || b.s > a.s ? b : a, null);
  const semanticGap = semantic.conf - (nextSemantic ? nextSemantic.conf : 0);
  const semanticMatch = !!semanticBest && semantic.conf >= 0.35 && semanticGap >= 0.05
    && semanticBest.s >= 0.35 && best.s - semanticBest.s <= 0.12;
  const chosen = semanticMatch ? semanticBest : best;
  const accepted = !!force || visualAccepted || semanticMatch;
  const chosenZ = (chosen.s - m) / sd;
  const chosenOther = Math.max(-1, ...all.filter(x => x.node !== chosen.node).map(x => x.s));
  const chosenMargin = chosen.s - chosenOther;
  onDebug({
    room: chosen.node.name, score: chosen.s, z: chosenZ, margin: chosenMargin, accepted, candidates: all.length,
    semantic: semantic.label, semanticConf: semantic.conf, semanticGap, usedSemantic: semanticMatch,
    visualRoom: best.node.name,
  });
  if(!accepted) return null;
  const W = chosen.node.wins, N = W.length, full = chosen.node.haov === 360;      // finer direction: blend with the two neighbouring views
  let num = 0, den = 1;
  for(const dk of [-1, 1]){
    let k = chosen.i + dk; if(full) k = (k + N) % N;
    if(!W[k]) continue;
    const wt = Math.exp((fuse(q, W[k]) - chosen.s) * 40);
    num += wt * dk * 45; den += wt;
  }
  return { ...chosen, yaw: wrap(chosen.yaw + num / den) };
}
export function route(nodes, from, to){
  const prev = {[from]:null}, q = [from];
  while(q.length){ const c = q.shift(); if(c===to) break; for(const l of nodes.find(n => n.id===c).links) if(!(l.to in prev)){ prev[l.to]=c; q.push(l.to); } }
  if(!(to in prev)) return null;
  const p = []; for(let c=to; c!==null; c=prev[c]) p.unshift(c); return p;
}
