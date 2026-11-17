import { parseMap } from './graph.js';
const open = () => new Promise((res, rej) => {
  const r = indexedDB.open('spatial-guide', 3);
  r.onupgradeneeded = () => {
    const d = r.result;
    if(!d.objectStoreNames.contains('tours')) d.createObjectStore('tours', {keyPath:'id'});
    if(!d.objectStoreNames.contains('drafts')) d.createObjectStore('drafts');
    if(!d.objectStoreNames.contains('maps')) d.createObjectStore('maps', {keyPath:'id'});
  };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const tx = async (store, mode, fn) => {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode); const rq = fn(t.objectStore(store));
    t.oncomplete = () => res(rq.result); t.onerror = () => rej(t.error);
  });
};
export const saveTour = t => tx('tours', 'readwrite', s => s.put(t));
export const listTours = () => tx('tours', 'readonly', s => s.getAll());
export const deleteTour = id => tx('tours', 'readwrite', s => s.delete(id));
export const saveMap = m => tx('maps', 'readwrite', s => s.put(m));
export const listMaps = () => tx('maps', 'readonly', s => s.getAll());
export const deleteMap = id => tx('maps', 'readwrite', s => s.delete(id));
export const saveDraft = d => tx('drafts', 'readwrite', s => s.put(d, 'current'));      // sweeps are kept even if the app is closed
export const loadDraft = async () => (await tx('drafts', 'readonly', s => s.get('current'))) || { files: [], ordered: true };
export const clearDraft = () => tx('drafts', 'readwrite', s => s.delete('current'));

const toData = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
export async function exportTour(t){
  const copy = {...t, nodes: await Promise.all(t.nodes.map(async n => ({...n, blob: await toData(n.blob)})))};
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(copy)], {type:'application/json'}));
  a.download = t.name + '.sgtour'; a.click();
}
export async function importTour(file){
  const t = JSON.parse(await file.text());
  for(const n of t.nodes) n.blob = await (await fetch(n.blob)).blob();
  t.id = Date.now() + ''; await saveTour(t);
}
export function exportMap(m){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(m)], {type:'application/json'}));
  a.download = m.name + '.sgmap'; a.click();
}
export async function importMap(file){ const m = parseMap(await file.text()); await saveMap(m); return m; }
