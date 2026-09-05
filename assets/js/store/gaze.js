/* gaze.js — where on the screen the shopper is actually looking.

   Pipeline: webcam frame → MediaPipe FaceLandmarker (478 landmarks incl. irises)
   → head rotation + iris offset inside each eye socket → a linear model fitted
   during a 5-point calibration maps those features to normalised screen
   coordinates. The store then casts a ray through that point.

   Everything runs on-device; no video ever leaves the machine. */

const TASKS_VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const L = {
  leftIris: [468, 469, 470, 471, 472],
  rightIris: [473, 474, 475, 476, 477],
  leftOuter: 33, leftInner: 133, leftTop: 159, leftBottom: 145,
  rightInner: 362, rightOuter: 263, rightTop: 386, rightBottom: 374,
  noseTip: 1, chin: 152, forehead: 10
};

const centroid = (lm, ids) => {
  let x = 0, y = 0;
  for (const i of ids) { x += lm[i].x; y += lm[i].y; }
  return { x: x / ids.length, y: y / ids.length };
};

export class GazeTracker {
  constructor() {
    this.ready = false;
    this.running = false;
    this.landmarker = null;
    this.video = null;
    this.features = null;      // [1, yaw, pitch, irisX, irisY]
    this.calibration = null;   // { wx: [...], wy: [...] }
    this.point = { x: 0, y: 0 };
    this.smoothed = { x: 0, y: 0 };
    this.faceVisible = false;
    this.lastError = null;
    this.samples = [];
    this.fps = 0;
    this._lastT = 0;
  }

  get calibrated() { return !!this.calibration; }

  async start(videoEl) {
    this.video = videoEl;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' }, audio: false
    });
    videoEl.srcObject = stream;
    this.stream = stream;
    await videoEl.play();

    const mod = await import(/* @vite-ignore */ TASKS_VISION);
    const vision = mod.FilesetResolver ? mod : mod.default;
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
    this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true
    });

    this.ready = true;
    this.running = true;
    return true;
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach(t => t.stop());
  }

  /* Call once per animation frame. Returns normalised gaze in [-1,1] or null. */
  tick(now) {
    if (!this.ready || !this.running || !this.video || this.video.readyState < 2) return null;
    let result;
    try {
      result = this.landmarker.detectForVideo(this.video, now);
    } catch (err) {
      this.lastError = err.message;
      return null;
    }
    if (this._lastT) this.fps = 0.9 * this.fps + 0.1 * (1000 / Math.max(1, now - this._lastT));
    this._lastT = now;

    const lm = result?.faceLandmarks?.[0];
    this.faceVisible = !!lm;
    if (!lm) return null;

    const f = this.extract(lm, result.facialTransformationMatrixes?.[0]);
    this.features = f;

    const raw = this.calibration ? this.applyModel(f) : this.fallbackMap(f);
    // exponential smoothing keeps the ray from jittering between neighbouring facings
    this.smoothed.x += (raw.x - this.smoothed.x) * 0.35;
    this.smoothed.y += (raw.y - this.smoothed.y) * 0.35;
    this.point = { x: clamp(this.smoothed.x, -1, 1), y: clamp(this.smoothed.y, -1, 1) };
    return this.point;
  }

  extract(lm, matrix) {
    let yaw = 0, pitch = 0;
    if (matrix?.data && matrix.data.length === 16) {
      const d = matrix.data;                 // column-major
      const fx = d[8], fy = d[9], fz = d[10];
      yaw = Math.atan2(fx, fz || 1e-6);
      pitch = Math.asin(clamp(fy, -1, 1));
    } else {
      // geometric fallback: nose offset inside the eye/chin triangle
      const eyeMid = { x: (lm[L.leftOuter].x + lm[L.rightOuter].x) / 2, y: (lm[L.leftOuter].y + lm[L.rightOuter].y) / 2 };
      const span = Math.abs(lm[L.rightOuter].x - lm[L.leftOuter].x) || 1e-3;
      yaw = (lm[L.noseTip].x - eyeMid.x) / span * 2;
      const height = Math.abs(lm[L.chin].y - lm[L.forehead].y) || 1e-3;
      pitch = (lm[L.noseTip].y - eyeMid.y) / height * 2;
    }

    const eye = (irisIds, outer, inner, top, bottom) => {
      const iris = centroid(lm, irisIds);
      const cx = (lm[outer].x + lm[inner].x) / 2;
      const cy = (lm[top].y + lm[bottom].y) / 2;
      const w = Math.abs(lm[outer].x - lm[inner].x) || 1e-3;
      const h = Math.abs(lm[bottom].y - lm[top].y) || 1e-3;
      return { x: (iris.x - cx) / w, y: (iris.y - cy) / h };
    };
    const le = eye(L.leftIris, L.leftOuter, L.leftInner, L.leftTop, L.leftBottom);
    const re = eye(L.rightIris, L.rightInner, L.rightOuter, L.rightTop, L.rightBottom);
    const ix = (le.x + re.x) / 2;
    const iy = (le.y + re.y) / 2;

    return [1, yaw, pitch, ix, iy];
  }

  /* Usable before calibration: rough, signs chosen for a laptop webcam above the screen. */
  fallbackMap(f) {
    const [, yaw, pitch, ix, iy] = f;
    return { x: clamp(-yaw * 1.9 + ix * 2.6, -1, 1), y: clamp(pitch * 2.2 + iy * 1.6, -1, 1) };
  }

  applyModel(f) {
    const dot = w => w.reduce((s, wi, i) => s + wi * f[i], 0);
    return { x: dot(this.calibration.wx), y: dot(this.calibration.wy) };
  }

  /* ---- calibration ---- */

  addSample(target) {
    if (!this.features) return false;
    this.samples.push({ f: [...this.features], t: target });
    return true;
  }

  clearSamples() { this.samples = []; }

  fit() {
    if (this.samples.length < 12) return false;
    const X = this.samples.map(s => s.f);
    const yx = this.samples.map(s => s.t.x);
    const yy = this.samples.map(s => s.t.y);
    const wx = ridge(X, yx, 1e-3);
    const wy = ridge(X, yy, 1e-3);
    if (!wx || !wy) return false;
    this.calibration = { wx, wy };
    try {
      localStorage.setItem('shopperlab.gazecal', JSON.stringify(this.calibration));
    } catch { /* storage is optional */ }
    return true;
  }

  loadSavedCalibration() {
    try {
      const raw = localStorage.getItem('shopperlab.gazecal');
      if (raw) { this.calibration = JSON.parse(raw); return true; }
    } catch { /* ignore */ }
    return false;
  }

  /* Rough residual error on the calibration set, in screen fractions. */
  calibrationError() {
    if (!this.calibration || !this.samples.length) return null;
    let e = 0;
    for (const s of this.samples) {
      const dot = w => w.reduce((acc, wi, i) => acc + wi * s.f[i], 0);
      e += Math.hypot(dot(this.calibration.wx) - s.t.x, dot(this.calibration.wy) - s.t.y);
    }
    return e / this.samples.length;
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* Ridge regression via normal equations, solved with Gauss-Jordan. */
function ridge(X, y, lambda) {
  const n = X[0].length;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (let r = 0; r < X.length; r++) {
    for (let i = 0; i < n; i++) {
      b[i] += X[r][i] * y[r];
      for (let j = 0; j < n; j++) A[i][j] += X[r][i] * X[r][j];
    }
  }
  for (let i = 1; i < n; i++) A[i][i] += lambda;   // never penalise the intercept

  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-10) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (!factor) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map(row => row[n]);
}

export const CALIBRATION_TARGETS = [
  { x: -0.78, y: -0.66 }, { x: 0.78, y: -0.66 },
  { x: 0, y: 0 },
  { x: -0.78, y: 0.66 }, { x: 0.78, y: 0.66 }
];
