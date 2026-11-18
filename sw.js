const C='sg-v24';
const SHELL=['./','index.html','css/style.css','js/app.js','js/ui.js','js/db.js','js/ai.js','js/builder.js','js/viewer.js','js/ar.js','js/xr.js','js/capture.js','js/voice.js','js/share.js','js/config.js','js/graph.js','js/route.js','js/minimap.js','js/ocr.js','js/xrkit.js','js/navigate.js','js/mapper.js','js/heading.js','fonts/inter-latin-wght-normal.woff2','manifest.webmanifest'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL)));});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=e.request.url;
  if(e.request.method!=='GET'||u.includes('huggingface')||u.includes('supabase.co'))return;
  e.respondWith(caches.match(e.request).then(h=>h||fetch(e.request).then(r=>{
    const c=r.clone(); if(r.ok||r.type==='opaque')caches.open(C).then(x=>x.put(e.request,c)); return r;
  }).catch(()=>h)));
});