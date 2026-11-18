// WebXR plumbing shared by navigation and mapping: an immersive-ar session with floor detection, a pool of
// floor chevrons, and map markers. It reports the phone's position and heading every frame via onFrame.
// Positions are in the session's own coordinates (metres, y up, the start pose is the origin).
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

export async function xrSupported(){
  try{ return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); }catch{ return false; }
}
const SHAPE = [[-.6, -.3], [0, .2], [.6, -.3], [.6, -.55], [0, -.05], [-.6, -.55]];
const ACCENT = 0x4da3ff;

function makeCameraCapture(gl, renderer){
  const initialFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING), initialViewport = gl.getParameter(gl.VIEWPORT);
  const vertex = gl.createShader(gl.VERTEX_SHADER), fragment = gl.createShader(gl.FRAGMENT_SHADER);
  if(!vertex || !fragment) throw new Error('Could not create camera capture shaders.');
  gl.shaderSource(vertex, `#version 300 es
    in vec2 position;
    in vec2 uv;
    out vec2 texCoord;
    void main(){ gl_Position = vec4(position, 0.0, 1.0); texCoord = uv; }`);
  gl.shaderSource(fragment, `#version 300 es
    precision mediump float;
    uniform sampler2D cameraFrame;
    in vec2 texCoord;
    out vec4 color;
    void main(){ color = texture(cameraFrame, texCoord); }`);
  gl.compileShader(vertex); gl.compileShader(fragment);
  if(!gl.getShaderParameter(vertex, gl.COMPILE_STATUS) || !gl.getShaderParameter(fragment, gl.COMPILE_STATUS)){
    const error = gl.getShaderInfoLog(vertex) || gl.getShaderInfoLog(fragment) || 'Camera capture shader compilation failed.';
    gl.deleteShader(vertex); gl.deleteShader(fragment); throw new Error(error);
  }
  const program = gl.createProgram();
  if(!program) throw new Error('Could not create camera capture program.');
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if(!gl.getProgramParameter(program, gl.LINK_STATUS)){
    const error = gl.getProgramInfoLog(program) || 'Camera capture program could not link.';
    gl.deleteProgram(program); throw new Error(error);
  }
  const buffer = gl.createBuffer(), framebuffer = gl.createFramebuffer(), output = gl.createTexture();
  if(!buffer || !framebuffer || !output) throw new Error('Could not allocate camera capture buffers.');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1,
  ]), gl.STATIC_DRAW);
  gl.bindTexture(gl.TEXTURE_2D, output);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
  let width = 0, height = 0;
  const position = gl.getAttribLocation(program, 'position'), uv = gl.getAttribLocation(program, 'uv');
  const cameraFrame = gl.getUniformLocation(program, 'cameraFrame');
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  if(!ctx) throw new Error('Could not create camera capture canvas.');
  gl.bindFramebuffer(gl.FRAMEBUFFER, initialFramebuffer);
  gl.viewport(initialViewport[0], initialViewport[1], initialViewport[2], initialViewport[3]);
  renderer.resetState();
  return {
    capture(texture, sourceWidth, sourceHeight, renderer){
      let outWidth = Math.min(320, sourceWidth), outHeight = Math.max(1, Math.round(outWidth * sourceHeight / sourceWidth));
      if(outHeight > 320){ outHeight = 320; outWidth = Math.max(1, Math.round(outHeight * sourceWidth / sourceHeight)); }
      const oldFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING), oldViewport = gl.getParameter(gl.VIEWPORT);
      try{
        if(width !== outWidth || height !== outHeight){
          width = canvas.width = outWidth; height = canvas.height = outHeight;
          gl.bindTexture(gl.TEXTURE_2D, output);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
          if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Camera capture framebuffer is incomplete.');
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.viewport(0, 0, width, height);
        gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(uv); gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(cameraFrame, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        const pixels = new Uint8ClampedArray(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const row = new Uint8ClampedArray(width * 4);
        for(let y = 0; y < height / 2; y++){
          const top = y * width * 4, bottom = (height - y - 1) * width * 4;
          row.set(pixels.subarray(top, top + row.length));
          pixels.copyWithin(top, bottom, bottom + row.length);
          pixels.set(row, bottom);
        }
        ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
        return canvas.toDataURL('image/jpeg', 0.78);
      }finally{
        gl.bindFramebuffer(gl.FRAMEBUFFER, oldFramebuffer);
        gl.viewport(oldViewport[0], oldViewport[1], oldViewport[2], oldViewport[3]);
        renderer.resetState();
      }
    },
    dispose(){ gl.deleteBuffer(buffer); gl.deleteFramebuffer(framebuffer); gl.deleteTexture(output); gl.deleteProgram(program); },
  };
}

export async function openXR({ overlay, onFrame, onEnd }){
  document.querySelectorAll('video').forEach(v => { if(v.srcObject){ v.srcObject.getTracks().forEach(t => t.stop()); v.srcObject = null; } });
  overlay.hidden = false;
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setPixelRatio(devicePixelRatio); renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local');
  renderer.xr.setFramebufferScaleFactor(.8);
  if(typeof renderer.xr.setFoveation === 'function') renderer.xr.setFoveation(1);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  let session, captureBinding = null, cameraCapture = null, capturePending = null;
  let cameraCaptureError = 'Browser did not grant optional WebXR camera-access.';
  try{
    session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'camera-access'], domOverlay: { root: overlay } });
    await renderer.xr.setSession(session);
    const gl = renderer.getContext();
    const hasCameraAccess = Array.from(session.enabledFeatures || []).includes('camera-access');
    if(typeof XRWebGLBinding !== 'undefined' && typeof WebGL2RenderingContext !== 'undefined' &&
       gl instanceof WebGL2RenderingContext && hasCameraAccess){
      try{
        captureBinding = new XRWebGLBinding(session, gl);
        cameraCapture = makeCameraCapture(gl, renderer);
        cameraCaptureError = '';
      }catch(error){ captureBinding = null; cameraCapture = null; cameraCaptureError = `Camera capture setup failed: ${error.message}`; }
    }else if(hasCameraAccess){
      cameraCaptureError = 'Camera capture requires WebGL2.';
    }
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
    if(ended) return; ended = true;
    if(capturePending){ capturePending.reject(new Error('AR ended before the camera image was captured.')); capturePending = null; }
    renderer.setAnimationLoop(null); if(cameraCapture) cameraCapture.dispose(); renderer.dispose(); overlay.hidden = true; onEnd && onEnd();
  };
  session.addEventListener('end', finish);
  renderer.setAnimationLoop((time, frame) => {
    if(frame){
      const ref = renderer.xr.getReferenceSpace(), pose = frame.getViewerPose(ref);
      if(pose){
        const p = pose.transform.position, hits = frame.getHitTestResults(hitSrc);
        if(hits.length){ const y = hits[0].getPose(ref).transform.position.y, dy = p.y - y; if(dy > .6 && dy < 2.4) floorY = floorY == null ? y : floorY * .8 + y * .2; }
        onFrame && onFrame({ pos: [p.x, p.y, p.z], heading: headingOf(pose.transform.orientation), floorY, t: time });
        if(capturePending){
          try{
            const view = pose.views.find(v => v.camera);
            if(view && captureBinding && cameraCapture){
              const texture = captureBinding.getCameraImage(view.camera);
              if(!texture) throw new Error('The browser did not provide a camera image.');
              const image = cameraCapture.capture(texture, view.camera.width, view.camera.height, renderer);
              capturePending.resolve(image); capturePending = null;
            }else if(performance.now() - capturePending.started > 1500){
              cameraCaptureError = 'Browser enabled camera-access but did not expose a camera frame.';
              throw new Error('Raw camera capture is not supported by this browser.');
            }
          }catch(error){ capturePending.reject(error); capturePending = null; }
        }
      }
      list.forEach((c, i) => { const k = pool[i]; k.fill.opacity = k.edge.opacity = c.a * (.45 + .55 * (.5 + .5 * Math.sin(time / 250 - i * .9))); });
    }
    renderer.render(scene, camera);
  });
  return {
    end: () => session.end().catch(() => finish()),
    get floorY(){ return floorY; },
    get cameraCaptureAvailable(){ return !!(captureBinding && cameraCapture); },
    get cameraCaptureMessage(){ return cameraCaptureError; },
    captureFrame(){
      if(!captureBinding || !cameraCapture) return Promise.reject(new Error(cameraCaptureError));
      if(capturePending) return Promise.reject(new Error('A camera image is already being captured.'));
      return new Promise((resolve, reject) => { capturePending = { resolve, reject, started: performance.now() }; });
    },
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
