const rad = Math.PI / 180;
let h = 0, ok = false, abs = false;
function fromEuler(alpha, beta, gamma){                       // direction the back camera faces, allowing for tilt
  const cA = Math.cos(alpha*rad), sA = Math.sin(alpha*rad), sB = Math.sin(beta*rad), sG = Math.sin(gamma*rad), cG = Math.cos(gamma*rad);
  return (Math.atan2(-(cA*sG + sA*sB*cG), -(sA*sG - cA*sB*cG)) / rad + 360) % 360;
}
function push(v){ if(!ok){ h = v; ok = true; return; } const d = ((v - h + 540) % 360) - 180; h = (h + 0.12*d + 360) % 360; }
const onAbs = e => { if(e.alpha == null || e.beta == null || e.gamma == null) return; abs = true; push(fromEuler(e.alpha, e.beta, e.gamma)); };
const onRel = e => {
  if(e.webkitCompassHeading != null){ push(e.webkitCompassHeading); return; }   // iPhone
  if(abs || e.alpha == null) return; push(fromEuler(e.alpha, e.beta || 0, e.gamma || 0));
};
export const startHeading = () => { addEventListener('deviceorientationabsolute', onAbs, true); addEventListener('deviceorientation', onRel, true); };
export const stopHeading = () => { removeEventListener('deviceorientationabsolute', onAbs, true); removeEventListener('deviceorientation', onRel, true); ok = false; abs = false; };
export const getHeading = () => h;
export const hasCompass = () => ok;