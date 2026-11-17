// WebXR plumbing shared by navigation and mapping: an immersive-ar session with floor detection, a pool of
// floor chevrons, and map markers. It reports the phone's position and heading every frame via onFrame.
// Positions are in the session's own coordinates (metres, y up, the start pose is the origin).
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

export async function xrSupported(){
  try{ return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); }catch{ return false; }
}
const SHAPE = [[-.6, -.3], [0, .2], [.6, -.3], [.6, -.55], [0, -.05], [-.6, -.55]];
const ACCENT = 0x4da3ff;

export async function openXR({ overlay, onFrame, onEnd }){
  overlay.hidden = false;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(devicePixelRatio); renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local');
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  let session;
  try{
    session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: overlay } });
    await renderer.xr.setSession(session);
  }catch(e){ overlay.hidden = true; renderer.dispose(); onEnd && onEnd(e); return null; }

  const shape = new THREE.Shape(); SHAPE.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y)); shape.closePath();
  const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI / 2);                       // lies flat, points along -z
  const pool = [];
  for(let i = 0; i < 16; i++){
    const fill = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, side: THREE.DoubleSide }),
          edge = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide }),
          g = new THREE.Group(), e = new THREE.Mesh(geo, edge), f = new THREE.Mesh(geo, fill);
    e.scale.set(.55, 1, .55); f.scale.set(.55, 1, .55); e.position.y = -.004; g.add(e, f); g.visible = false; scene.add(g); pool.push({ g, fill, edge });
  }
  const markers = new THREE.Group(); scene.add(markers);
  const dot = new THREE.CircleGeometry(.1, 20); dot.rotateX(-Math.PI / 2);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .7 }), roomMat = new THREE.MeshBasicMaterial({ color: ACCENT });
  const pillar = new THREE.CylinderGeometry(.04, .04, 1.5, 8), labels = new Map();
  const label = text => {                                                                       // a number on a dark plate, drawn once per room
    if(labels.has(text)) return labels.get(text).clone();
    const c = document.createElement('canvas'); c.width = 192; c.height = 96; const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,.78)'; g.beginPath(); g.roundRect(4, 4, 184, 88, 24); g.fill();
    g.fillStyle = '#fff'; g.font = '600 52px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 96, 50);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false })); s.scale.set(.5, .25, 1);
    labels.set(text, s); return s.clone();
  };

  let list = [], floorY = null, ended = false;
  const q = new THREE.Quaternion(), f = new THREE.Vector3(), u = new THREE.Vector3();
  const headingOf = o => {                  // forward + the screen's top edge, both flattened: stays right when the phone tilts down at the floor
    q.set(o.x, o.y, o.z, o.w); f.set(0, 0, -1).applyQuaternion(q); u.set(0, 1, 0).applyQuaternion(q);
    return Math.atan2(-(f.x + u.x), -(f.z + u.z));
  };
  const viewer = await session.requestReferenceSpace('viewer');
  const hitSrc = await session.requestHitTestSource({ space: viewer });
  const finish = () => {
    if(ended) return; ended = true; renderer.setAnimationLoop(null); renderer.dispose(); overlay.hidden = true; onEnd && onEnd();
  };
  session.addEventListener('end', finish);
  renderer.setAnimationLoop((time, frame) => {
    if(frame){
      const ref = renderer.xr.getReferenceSpace(), pose = frame.getViewerPose(ref);
      if(pose){
        const p = pose.transform.position, hits = frame.getHitTestResults(hitSrc);
        if(hits.length){ const y = hits[0].getPose(ref).transform.position.y, dy = p.y - y; if(dy > .6 && dy < 2.4) floorY = floorY == null ? y : floorY * .8 + y * .2; }
        onFrame && onFrame({ pos: [p.x, p.y, p.z], heading: headingOf(pose.transform.orientation), floorY, t: time });
      }
      list.forEach((c, i) => { const k = pool[i]; k.fill.opacity = k.edge.opacity = c.a * (.45 + .55 * (.5 + .5 * Math.sin(time / 250 - i * .9))); });
    }
    renderer.render(scene, camera);
  });
  return {
    end: () => session.end().catch(() => finish()),
    get floorY(){ return floorY; },
    setChevrons(next){                                                                          // [{ p:[x,y,z], yaw, a }] in session coordinates
      list = next.slice(0, pool.length);
      pool.forEach((k, i) => { const c = list[i]; k.g.visible = !!c; if(c){ k.g.position.set(c.p[0], c.p[1] + .01, c.p[2]); k.g.rotation.y = c.yaw; } });
    },
    setMarkers(items){                                                                          // [{ p, room? }]: call when the map changes
      markers.clear();
      items.forEach(it => {
        const d = new THREE.Mesh(dot, it.room ? roomMat : dotMat); d.position.set(it.p[0], it.p[1] + .01, it.p[2]); markers.add(d);
        if(it.room){ const s = label(it.room), p = new THREE.Mesh(pillar, roomMat); p.position.set(it.p[0], it.p[1] + .75, it.p[2]); s.position.set(it.p[0], it.p[1] + 1.65, it.p[2]); markers.add(p, s); }
      });
    },
  };
}
