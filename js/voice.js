export function listen(done){
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!R) return alert('Voice is not supported on this browser. Use Chrome.');
  const r = new R(); r.lang = 'en-US';
  r.onresult = e => done(e.results[0][0].transcript);
  r.start();
}
export function speak(text){
  try{ speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); }catch{}
}
