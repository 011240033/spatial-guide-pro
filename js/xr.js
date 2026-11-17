import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { $ } from './ui.js';

export async function xrSupported(){
  try{ return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); }catch{ return false; }
}

export async function startXR({ turn, label, onEnd }){
  const overlay = $('xrOverlay'), msg = $('xrMsg'); overlay.hidden = false;
  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setPixelRatio(devicePixelRatio); renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local');
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), up = new THREE.Vector3(0,1,0);
  const shape = new THREE.Shape();
  [[-.6,-.3],[0,.2],[.6,-.3],[.6,-.55],[0,-.05],[-.6,-.55]].forEach(([x,y], i) => i ? shape.lineTo(x,y) : shape.moveTo(x,y)); shape.closePath();
  const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI/2);          // flat on the floor, pointing forward
  const mats = [];
  let session;
  const end = () => { renderer.setAnimationLoop(null); renderer.dispose(); overlay.hidden = true; onEnd && onEnd(); };
  try{
    session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures:['hit-test'], optionalFeatures:['dom-overlay'], domOverlay:{ root: overlay } });
    session.addEventListener('end', end);
    await renderer.xr.setSession(session);
  }catch(e){ overlay.hidden = true; onEnd && onEnd(e); return; }
  $('xrDone').onclick = () => session.end();
  const viewer = await session.requestReferenceSpace('viewer');
  const hitSrc = await session.requestHitTestSource({ space: viewer });
  let dir = null, placed = false;
  msg.textContent = 'Point the phone at the floor for a moment';

  const place = (p, floorY) => {
    for(let i = 0; i < 9; i++){
      const d = 1.4 + i*1.3, g = new THREE.Group();
      const fill = new THREE.MeshBasicMaterial({ color:0x4da3ff, transparent:true, side:THREE.DoubleSide });
      const edge = new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, side:THREE.DoubleSide });
      const o = new THREE.Mesh(geo, edge), f = new THREE.Mesh(geo, fill);
      o.scale.set(0.55, 1, 0.55); f.scale.set(0.55, 1, 0.55); o.position.y = -0.004;
      g.add(o, f);
      g.position.set(p.x + dir.x*d, floorY + 0.01, p.z + dir.z*d); g.rotation.y = Math.atan2(-dir.x, -dir.z);
      scene.add(g); mats.push([fill, edge]);
    }
  };
  renderer.setAnimationLoop((time, frame) => {
    if(frame){
      const ref = renderer.xr.getReferenceSpace(), pose = frame.getViewerPose(ref);
      if(pose && !dir){                                  // route direction is fixed from the first view
        const q = pose.transform.orientation, f = new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
        f.y = 0; if(f.length() > 0.2) dir = f.normalize().applyAxisAngle(up, -turn*Math.PI/180);
      }
      if(pose && dir && !placed){
        const hits = frame.getHitTestResults(hitSrc);
        if(hits.length){
          const y = hits[0].getPose(ref).transform.position.y, cy = pose.transform.position.y;
          if(cy - y > 0.6 && cy - y < 2.3){ place(pose.transform.position, y); placed = true; msg.textContent = 'Walk forward to ' + label; }
        }
      }
      mats.forEach(([a, b], i) => { a.opacity = b.opacity = 0.35 + 0.65*(0.5 + 0.5*Math.sin(time/250 - i*0.9)); });
    }
    renderer.render(scene, camera);
  });
}