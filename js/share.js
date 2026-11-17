import { SB } from './config.js';
import { saveTour } from './db.js';

const H = type => ({ apikey: SB.key, Authorization: 'Bearer ' + SB.key, ...(type ? { 'Content-Type': type } : {}) });
const pub = p => `${SB.url}/storage/v1/object/public/tours/${p}`;
async function up(path, body, type){
  const r = await fetch(`${SB.url}/storage/v1/object/tours/${path}`, { method:'POST', headers:H(type), body });
  if(!r.ok) throw new Error(await r.text());
}

export async function publish(tours, say){                      // tours = every floor of the building, or one tour
  const id = Math.random().toString(36).slice(2, 10);
  for(const t of tours){
    const nodes = [];
    for(const [i, n] of t.nodes.entries()){
      say(`Uploading photo ${i+1} of ${t.nodes.length}...`);
      await up(`${id}/${t.id}/${n.id}.jpg`, n.blob, 'image/jpeg');
      const { blob, ...rest } = n; nodes.push({ ...rest, img: pub(`${id}/${t.id}/${n.id}.jpg`) });
    }
    await up(`${id}/${t.id}/tour.json`, new Blob([JSON.stringify({ ...t, nodes })], { type:'application/json' }), 'application/json');
  }
  await up(`${id}/set.json`, new Blob([JSON.stringify({ tours: tours.map(t => t.id) })], { type:'application/json' }), 'application/json');
  return `${location.origin}${location.pathname}#s=${id}`;
}

export async function loadShared(id, say){
  const set = await (await fetch(pub(`${id}/set.json`))).json(), out = [];
  for(const tid of set.tours){
    say('Downloading the tour...');
    const t = await (await fetch(pub(`${id}/${tid}/tour.json`))).json();
    await Promise.all(t.nodes.map(async n => { n.blob = await (await fetch(n.img)).blob(); delete n.img; }));
    t.id = 's' + id + t.id; await saveTour(t); out.push(t);      // saved on the phone, so it opens offline later
  }
  return out;
}