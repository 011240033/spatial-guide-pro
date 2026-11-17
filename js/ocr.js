// Reads a room number off a sign. Tesseract.js is loaded on first use (about 2 MB, then cached by the PWA).
let worker = null, loading = null;
const loadScript = src => new Promise((res, rej) => {
  if(window.Tesseract) return res();
  const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the text reader.'));
  document.head.append(s);
});
export function loadOCR(say = () => {}){
  if(worker) return Promise.resolve(worker);
  return loading || (loading = (async () => {
    say('Loading the text reader...');
    await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    const w = await Tesseract.createWorker('eng');
    await w.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '11' });
    return worker = w;
  })().catch(e => { loading = null; throw e; }));
}
// canvas in, { text, conf } out: the tallest 2-4 digit word that Tesseract is sure about (a room number is the biggest figure on a sign)
export async function readNumber(canvas){
  const { data } = await (await loadOCR()).recognize(canvas);
  const ok = (data.words || []).filter(w => /^\d{2,4}$/.test((w.text || '').trim()) && w.confidence >= 60);
  ok.sort((a, b) => (b.bbox.y1 - b.bbox.y0) - (a.bbox.y1 - a.bbox.y0));
  return ok[0] ? { text: ok[0].text.trim(), conf: ok[0].confidence } : null;
}
