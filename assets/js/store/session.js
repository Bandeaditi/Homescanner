/* session.js — runs one real-shopper trip and records it.

   Two rays leave the camera each frame:
     · the reticle ray, for what the shopper can reach and interact with
     · the gaze ray, aimed at wherever the webcam model says the eyes are pointed
   Attention is attributed from the gaze ray, interactions from the reticle. */

import * as THREE from 'three';
import { STORE, SESSION_DEFAULTS, zoneAt, productById } from '../core/config.js';
import * as S from '../core/state.js';
import { fmtMoney, shortId } from '../core/util.js';
import { buildStore, tryLoadExternalModel } from './scene.js';
import { Walker } from './controls.js';
import { GazeTracker, CALIBRATION_TARGETS } from './gaze.js';

const $ = id => document.getElementById(id);
const exp = S.load();
const variantId = exp.activeVariant;
const variant = S.variant(exp, variantId);

/* ---------------- renderer ---------------- */

const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.05, 90);
const { scene, productMeshes, bannerMeshes, blockers, colliders } = buildStore(exp, variantId);
const gazeTargets = [...productMeshes, ...bannerMeshes, ...blockers];
tryLoadExternalModel(scene);

const walker = new Walker(camera, canvas, colliders);
const raycaster = new THREE.Raycaster();
raycaster.far = SESSION_DEFAULTS.maxGazeDistance;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ---------------- recording ---------------- */

const rec = {
  startedAt: 0,
  running: false,
  attention: {},          // sku -> ms of gaze
  views: {},              // sku -> count of fixations over threshold
  firstFixation: {},      // sku -> ms from start
  zoneDwell: {},
  bannerExposure: {},
  bannerAttributed: {},   // sku -> ms of banner gaze attributed to it
  path: [],
  zoneSequence: [],
  interactions: [],
  basket: [],
  gazeSamples: 0,
  gazeOnShelf: 0
};

let currentFixation = { sku: null, since: 0, counted: false };
let lastPathSample = 0;
let focusMesh = null;
let cardOpen = false;

const gaze = new GazeTracker();
let gazeActive = false;

/* ---------------- UI ---------------- */

$('taskBody').textContent = exp.shopperTask;
$('startTask').textContent = exp.shopperTask;
$('variantChip').textContent = variant.name;
$('preVariant').textContent = variant.name.replace(/^Variant\s*/, '');
$('preFacings').textContent = Object.values(variant.planogram).filter(Boolean).length;

$('startWithCam').addEventListener('click', async () => {
  $('startError').textContent = 'Asking for the camera…';
  try {
    $('cam').style.display = 'block';
    await gaze.start($('cam'));
    gazeActive = true;
    $('startVeil').hidden = true;
    if (gaze.loadSavedCalibration()) {
      beginSession();
      toast('Reusing your saved calibration. Press Recalibrate if it feels off.');
    } else {
      $('calVeil').hidden = false;
    }
  } catch (err) {
    $('cam').style.display = 'none';
    $('startError').textContent =
      'No camera access: ' + err.message + ' — you can still shop without eye tracking, attention will be taken from where you face.';
  }
});

$('startNoCam').addEventListener('click', () => {
  $('startVeil').hidden = true;
  beginSession();
});

$('calStart').addEventListener('click', runCalibration);
$('calSkip').addEventListener('click', () => { $('calVeil').hidden = true; beginSession(); });
$('recalBtn').addEventListener('click', () => {
  if (!gazeActive) { toast('Eye tracking is off for this trip.'); return; }
  document.exitPointerLock?.();
  $('calVeil').hidden = false;
  $('calIntro').hidden = false;
});
$('endBtn').addEventListener('click', endSession);

$('pcClose').addEventListener('click', () => closeCard(false));
$('pcAdd').addEventListener('click', () => closeCard(true));

for (const btn of document.querySelectorAll('.mobile-pad button')) {
  const mode = btn.dataset.move;
  const set = (f, s) => walker.setIntent(f, s);
  if (mode === 'pick') btn.addEventListener('click', () => tryInteract());
  else {
    const vals = { fwd: [1, 0], left: [0, -1], right: [0, 1] }[mode];
    btn.addEventListener('pointerdown', () => set(vals[0], vals[1]));
    btn.addEventListener('pointerup', () => set(0, 0));
    btn.addEventListener('pointerleave', () => set(0, 0));
  }
}

addEventListener('keydown', e => {
  if (!rec.running) return;
  if (e.code === 'KeyE') tryInteract();
  if (e.code === 'KeyF') tryCheckout();
  if (e.code === 'Escape' && cardOpen) closeCard(false);
});

canvas.addEventListener('mousedown', e => {
  if (!rec.running || !document.pointerLockElement) return;
  if (e.button === 0) tryInteract();
});

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'hud-card';
  t.style.cssText = 'left:50%;top:76px;transform:translateX(-50%);z-index:20;position:fixed';
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 3600);
}

/* ---------------- calibration ---------------- */

async function runCalibration() {
  $('calIntro').hidden = true;
  gaze.clearSamples();
  const dot = $('calTarget'), prog = $('calProgress');
  dot.hidden = false; prog.hidden = false;

  for (let i = 0; i < CALIBRATION_TARGETS.length; i++) {
    const t = CALIBRATION_TARGETS[i];
    dot.style.left = `${(t.x + 1) / 2 * 100}%`;
    dot.style.top = `${(1 - t.y) / 2 * 100}%`;
    prog.innerHTML = `<div class="chip">Dot ${i + 1} of ${CALIBRATION_TARGETS.length} — look right at it</div>`;
    await wait(700);                       // let the eyes land
    const until = performance.now() + 900;
    while (performance.now() < until) {
      gaze.addSample(t);
      await wait(55);
    }
  }
  dot.hidden = true;

  const ok = gaze.fit();
  const err = gaze.calibrationError();
  prog.innerHTML = ok
    ? `<div class="chip synth">Calibrated — mean error ${(err * 50).toFixed(1)}% of screen</div>`
    : `<div class="chip">Not enough clean samples. Running with the rough default.</div>`;
  await wait(1200);
  prog.hidden = true;
  $('calVeil').hidden = true;
  if (!rec.running) beginSession();
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- session lifecycle ---------------- */

function beginSession() {
  rec.startedAt = performance.now();
  rec.running = true;
  canvas.requestPointerLock?.();
}

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  walker.update(dt);

  let gazePoint = null;
  if (gazeActive) {
    gazePoint = gaze.tick(now);
    $('gazeState').textContent = gaze.calibrated ? 'calibrated' : 'rough';
    $('faceState').textContent = gaze.faceVisible ? 'yes' : 'lost';
    $('fpsState').textContent = `${gaze.fps.toFixed(0)} fps`;
    const dot = $('gazeDot');
    if (gazePoint && gaze.faceVisible) {
      dot.style.opacity = '1';
      dot.style.left = `${(gazePoint.x + 1) / 2 * 100}%`;
      dot.style.top = `${(1 - gazePoint.y) / 2 * 100}%`;
    } else dot.style.opacity = '0';
  }

  if (rec.running && !cardOpen) {
    trackAttention(dt, now, gazePoint);
    trackPosition(dt, now);
  }
  updateFocus();

  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

function trackAttention(dt, now, gazePoint) {
  const ndc = gazePoint && gaze.faceVisible ? gazePoint : { x: 0, y: 0 };
  raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
  const hits = raycaster.intersectObjects(gazeTargets, false);
  rec.gazeSamples++;

  const hit = hits[0];
  const ms = dt * 1000;
  let sku = null;

  // a shelf back, a side panel or a wall in front means the shopper cannot see past it
  if (hit && !hit.object.userData.blocker) {
    const ud = hit.object.userData;
    if (ud.sku) {
      sku = ud.sku;
      rec.attention[sku] = (rec.attention[sku] || 0) + ms;
      rec.gazeOnShelf++;
      if (rec.firstFixation[sku] === undefined) rec.firstFixation[sku] = now - rec.startedAt;
    } else if (ud.bannerId) {
      rec.bannerExposure[ud.bannerId] = (rec.bannerExposure[ud.bannerId] || 0) + ms;
      if (ud.promotedSku) rec.bannerAttributed[ud.promotedSku] = (rec.bannerAttributed[ud.promotedSku] || 0) + ms;
    }
  }

  // count a discrete "view" once gaze rests on the same facing past the threshold
  if (sku && sku === currentFixation.sku) {
    if (!currentFixation.counted && now - currentFixation.since > SESSION_DEFAULTS.fixationMinMs) {
      rec.views[sku] = (rec.views[sku] || 0) + 1;
      currentFixation.counted = true;
    }
  } else {
    currentFixation = { sku, since: now, counted: false };
  }

  $('lookState').textContent = sku ? (productById(sku)?.name || sku).slice(0, 22) : (hit ? 'media' : '—');
}

function trackPosition(dt, now) {
  const zone = zoneAt(walker.pos.x, walker.pos.z);
  rec.zoneDwell[zone] = (rec.zoneDwell[zone] || 0) + dt * 1000;
  const lastZone = rec.zoneSequence[rec.zoneSequence.length - 1];
  if (lastZone !== zone) rec.zoneSequence.push(zone);

  if (now - lastPathSample > 250) {
    lastPathSample = now;
    rec.path.push({
      t: Math.round(now - rec.startedAt),
      x: +walker.pos.x.toFixed(2),
      z: +walker.pos.z.toFixed(2),
      zone
    });
  }

  $('distState').textContent = `${walker.distance.toFixed(1)} m`;
  const secs = Math.floor((now - rec.startedAt) / 1000);
  $('timerChip').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  const dist = Math.hypot(walker.pos.x - STORE.checkout.x, walker.pos.z - STORE.checkout.z);
  if (dist < STORE.checkout.radius) $('hintBar').style.borderColor = 'var(--ok)';
  else $('hintBar').style.borderColor = 'var(--line)';
}

function updateFocus() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits = raycaster.intersectObjects(productMeshes, false);
  const near = hits.find(h => h.distance < 3.2);
  focusMesh = near ? near.object : null;
  const label = $('focusLabel');
  if (focusMesh && !cardOpen) {
    const ud = focusMesh.userData;
    label.style.display = 'block';
    label.innerHTML = `${ud.name} · ${fmtMoney(ud.price)} <span class="muted">— press E</span>`;
  } else {
    label.style.display = 'none';
  }
}

function tryInteract() {
  if (!rec.running || cardOpen || !focusMesh) return;
  const ud = focusMesh.userData;
  rec.interactions.push({
    t: Math.round(performance.now() - rec.startedAt),
    sku: ud.sku, slot: ud.slot, type: 'inspect'
  });
  openCard(ud);
}

function openCard(ud) {
  cardOpen = true;
  document.exitPointerLock?.();
  const p = productById(ud.sku);
  $('pcSwatch').style.background = `linear-gradient(140deg, ${p.packColor}, ${p.accent})`;
  $('pcSwatch').textContent = p.brand;
  $('pcSwatch').style.color = p.accent;
  $('pcName').textContent = p.name;
  $('pcMeta').textContent = `${p.category} · shelf position ${ud.slot}`;
  $('pcPrice').textContent = fmtMoney(ud.price);
  $('pcPromo').hidden = !ud.promoted;
  $('pcShelf').textContent = ud.level === 'feature' ? 'Feature display' : `${ud.level} level`;
  $('productCard').hidden = false;
  $('productCard').dataset.sku = ud.sku;
  $('productCard').dataset.slot = ud.slot;
  $('productCard').dataset.price = ud.price;
}

function closeCard(add) {
  const card = $('productCard');
  const sku = card.dataset.sku;
  if (add && sku) {
    rec.basket.push({ sku, price: Number(card.dataset.price), slot: card.dataset.slot });
    rec.interactions.push({
      t: Math.round(performance.now() - rec.startedAt), sku, slot: card.dataset.slot, type: 'pickup'
    });
    renderBasket();
  } else if (sku) {
    rec.interactions.push({
      t: Math.round(performance.now() - rec.startedAt), sku, slot: card.dataset.slot, type: 'putback'
    });
  }
  card.hidden = true;
  cardOpen = false;
  canvas.requestPointerLock?.();
}

function renderBasket() {
  const list = $('basketList');
  if (!rec.basket.length) { list.innerHTML = '<span class="muted">Nothing picked up yet.</span>'; return; }
  list.innerHTML = rec.basket.map(b =>
    `<div class="kv"><span>${productById(b.sku)?.name || b.sku}</span><span>${fmtMoney(b.price)}</span></div>`).join('');
  $('basketTotal').textContent = fmtMoney(rec.basket.reduce((s, b) => s + b.price, 0));
}

function tryCheckout() {
  const dist = Math.hypot(walker.pos.x - STORE.checkout.x, walker.pos.z - STORE.checkout.z);
  if (dist > STORE.checkout.radius) { toast('Walk to the checkout pad on your left first.'); return; }
  endSession();
}

/* ---------------- finish ---------------- */

function endSession() {
  if (!rec.running) return;
  rec.running = false;
  document.exitPointerLock?.();
  gaze.stop();

  const duration = performance.now() - rec.startedAt;
  const session = {
    id: 'real-' + shortId(),
    kind: 'real',
    variant: variantId,
    persona: null,
    startedAt: Date.now(),
    durationMs: Math.round(duration),
    distanceM: +walker.distance.toFixed(2),
    gazeMode: gazeActive ? (gaze.calibrated ? 'calibrated-webcam' : 'uncalibrated-webcam') : 'head-direction',
    attention: roundAll(rec.attention),
    views: { ...rec.views },
    firstFixation: roundAll(rec.firstFixation),
    zoneDwell: roundAll(rec.zoneDwell),
    zoneSequence: rec.zoneSequence,
    bannerExposure: roundAll(rec.bannerExposure),
    bannerAttributed: roundAll(rec.bannerAttributed),
    path: rec.path,
    interactions: rec.interactions,
    basket: rec.basket,
    basketValue: +rec.basket.reduce((s, b) => s + b.price, 0).toFixed(2),
    onShelfGazeShare: rec.gazeSamples ? +(rec.gazeOnShelf / rec.gazeSamples).toFixed(3) : 0
  };
  S.addSession(exp, session);
  showSummary(session);
}

function roundAll(o) {
  const out = {};
  for (const k in o) out[k] = Math.round(o[k]);
  return out;
}

function showSummary(session) {
  const secs = Math.round(session.durationMs / 1000);
  const totalGaze = Object.values(session.attention).reduce((a, b) => a + b, 0);
  $('endStats').innerHTML = `
    <div class="stat"><div class="k" style="font-size:1.5rem">${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</div><div class="l">Trip length</div></div>
    <div class="stat"><div class="k" style="font-size:1.5rem">${session.basket.length}</div><div class="l">Items bought</div></div>
    <div class="stat"><div class="k" style="font-size:1.5rem">${fmtMoney(session.basketValue)}</div><div class="l">Basket value</div></div>`;

  const rows = Object.entries(session.attention).sort((a, b) => b[1] - a[1]).slice(0, 8);
  $('endAttention').innerHTML = rows.length ? rows.map(([sku, ms]) => `
    <div>
      <div class="spread tiny"><span>${productById(sku)?.name || sku}</span><span>${(ms / 1000).toFixed(1)}s</span></div>
      <div class="bar real"><i style="width:${Math.round(ms / Math.max(1, totalGaze) * 100)}%"></i></div>
    </div>`).join('') : '<p class="muted tiny">No shelf gaze registered — try again with the camera on.</p>';

  $('endVeil').hidden = false;
}

renderBasket();
