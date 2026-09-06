/* scene.js — builds the walkable store from the active variant.
   Every facing in the planogram becomes a mesh carrying its slot id, so a
   gaze ray hitting it can be attributed straight back to a shelf position. */

import * as THREE from 'three';
import {
  STORE, BAYS, FEATURES, SHELF_LEVELS, SLOTS_PER_LEVEL, BAY_WIDTH,
  BANNER_MOUNTS, productById
} from '../core/config.js';
import * as S from '../core/state.js';
import { getImage } from '../core/images.js';

const PACK_SIZE = {
  Cereal:   [0.30, 0.44, 0.13],
  Coffee:   [0.21, 0.31, 0.21],
  Snacks:   [0.31, 0.36, 0.12],
  Beverage: [0.19, 0.44, 0.19]
};

function packTexture(product, price, promoted) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 384;
  const g = c.getContext('2d');

  g.fillStyle = product.packColor;
  g.fillRect(0, 0, c.width, c.height);

  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, 'rgba(255,255,255,.20)');
  grad.addColorStop(.45, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,.28)');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);

  g.fillStyle = product.accent;
  g.fillRect(0, 96, c.width, 8);
  g.beginPath();
  g.arc(c.width / 2, 66, 34, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = product.packColor;
  g.font = 'bold 30px Helvetica, Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText(product.brand.slice(0, 2).toUpperCase(), c.width / 2, 77);

  g.fillStyle = product.accent;
  g.font = 'bold 27px Helvetica, Arial, sans-serif';
  g.fillText(product.brand.toUpperCase().slice(0, 14), c.width / 2, 150);

  g.fillStyle = 'rgba(255,255,255,.92)';
  g.font = '19px Helvetica, Arial, sans-serif';
  const words = product.name.split(' ');
  let line = '', y = 190;
  for (const w of words) {
    if ((line + ' ' + w).length > 15) { g.fillText(line, c.width / 2, y); line = w; y += 24; }
    else line = line ? line + ' ' + w : w;
  }
  g.fillText(line, c.width / 2, y);

  g.fillStyle = 'rgba(0,0,0,.35)';
  g.fillRect(0, 300, c.width, 84);
  g.fillStyle = '#fff';
  g.font = 'bold 34px Helvetica, Arial, sans-serif';
  g.fillText(`$${price.toFixed(2)}`, c.width / 2, 344);

  if (promoted) {
    g.save();
    g.translate(c.width - 54, 44);
    g.rotate(-0.22);
    g.fillStyle = '#ff2d8a';
    g.beginPath(); g.arc(0, 0, 38, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 17px Helvetica, Arial, sans-serif';
    g.fillText('SAVE', 0, -2);
    g.fillText('20%', 0, 17);
    g.restore();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function bannerTexture(b, mount) {
  const c = document.createElement('canvas');
  const ratio = mount.w / mount.h;
  c.width = 1024;
  c.height = Math.max(160, Math.round(1024 / ratio));
  const g = c.getContext('2d');

  const uploaded = b.imageId ? getImage(b.imageId) : null;
  if (uploaded) {
    // the artwork is the banner; it is drawn to cover the surface, cropping overflow
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    g.fillStyle = b.bg || '#1a0f2e';
    g.fillRect(0, 0, c.width, c.height);
    const img = new Image();
    img.onload = () => {
      const scale = Math.max(c.width / img.width, c.height / img.height);
      const w = img.width * scale, h = img.height * scale;
      g.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
      tex.needsUpdate = true;
    };
    img.src = uploaded;
    return tex;
  }

  const grad = g.createLinearGradient(0, 0, c.width, c.height);
  grad.addColorStop(0, b.bg);
  grad.addColorStop(1, shade(b.bg, -28));
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);

  g.fillStyle = 'rgba(255,255,255,.14)';
  g.beginPath();
  g.arc(c.width * 0.86, c.height * 0.5, c.height * 0.62, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = b.fg;
  g.textAlign = 'left';
  const h1 = Math.round(c.height * 0.34);
  g.font = `bold ${h1}px Helvetica, Arial, sans-serif`;
  g.fillText((b.headline || '').slice(0, 26), c.width * 0.06, c.height * 0.5);
  g.font = `${Math.round(h1 * 0.46)}px Helvetica, Arial, sans-serif`;
  g.globalAlpha = 0.86;
  g.fillText((b.subline || '').slice(0, 42), c.width * 0.06, c.height * 0.74);
  g.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function shade(hex, amt) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

export function buildStore(exp, variantId) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a0616');
  scene.fog = new THREE.Fog('#0a0616', 16, 40);

  const productMeshes = [];
  const bannerMeshes = [];
  const blockers = [];    // opaque geometry that stops a gaze ray
  const colliders = [];   // {minX, maxX, minZ, maxZ}

  const addCollider = (x, z, halfX, halfZ) =>
    colliders.push({ minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ });

  /* ---- lighting ---- */
  scene.add(new THREE.HemisphereLight('#c9b6ff', '#2a1240', 0.85));
  const key = new THREE.DirectionalLight('#ffffff', 0.55);
  key.position.set(6, 12, 8);
  scene.add(key);
  for (const [x, z, col] of [[-8, 2, '#9b5cf6'], [8, 2, '#ff4fa3'], [0, -6, '#b98bff']]) {
    const p = new THREE.PointLight(col, 28, 22, 2);
    p.position.set(x, 3.4, z);
    scene.add(p);
  }

  /* ---- shell ---- */
  const floorMat = new THREE.MeshStandardMaterial({ color: '#150c26', roughness: 0.72, metalness: 0.06 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(STORE.width, STORE.depth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const gridMat = new THREE.LineBasicMaterial({ color: '#2c1a4d', transparent: true, opacity: 0.55 });
  const grid = new THREE.GridHelper(STORE.width, 26, '#3a2263', '#241640');
  grid.material = gridMat;
  grid.position.y = 0.002;
  scene.add(grid);

  const wallMat = new THREE.MeshStandardMaterial({ color: '#1b1030', roughness: 0.9, side: THREE.DoubleSide });
  const halfW = STORE.width / 2, halfD = STORE.depth / 2, h = STORE.wallHeight;
  const walls = [
    [0, h / 2, -halfD, 0, STORE.width],
    [0, h / 2, halfD, 0, STORE.width],
    [-halfW, h / 2, 0, Math.PI / 2, STORE.depth],
    [halfW, h / 2, 0, Math.PI / 2, STORE.depth]
  ];
  for (const [x, y, z, ry, w] of walls) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.userData.blocker = true;
    scene.add(m);
    blockers.push(m);
  }

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(STORE.width, STORE.depth),
    new THREE.MeshStandardMaterial({ color: '#120a22', roughness: 1 })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = h;
  scene.add(ceiling);

  for (let i = -2; i <= 2; i++) {
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, STORE.depth - 3),
      new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? '#e6d8ff' : '#ffd6ec' })
    );
    strip.rotation.x = Math.PI / 2;
    strip.position.set(i * 4.4, h - 0.06, -0.5);
    scene.add(strip);
  }

  /* ---- fixtures ---- */
  const woodMat = new THREE.MeshStandardMaterial({ color: '#2b1b47', roughness: 0.68, metalness: 0.12 });
  const boardMat = new THREE.MeshStandardMaterial({ color: '#3a2560', roughness: 0.55, metalness: 0.2 });
  const variant = S.variant(exp, variantId);

  function placeProduct(sku, worldPos, rotY, slotMeta) {
    const p = productById(sku);
    if (!p) return null;
    const price = S.priceOf(exp, variantId, sku);
    const promoted = S.isPromoted(exp, variantId, sku);
    const [w, ht, d] = PACK_SIZE[p.category] || [0.26, 0.36, 0.16];
    const tex = packTexture(p, price, promoted);
    const side = new THREE.MeshStandardMaterial({ color: shade(p.packColor, -34), roughness: 0.6 });
    const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.48 });
    const mats = [side, side, side, side, front, side];  // +X,-X,+Y,-Y,+Z,-Z
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, ht, d), mats);
    mesh.position.set(worldPos.x, worldPos.y + ht / 2, worldPos.z);
    mesh.rotation.y = rotY;
    mesh.userData = { sku, price, promoted, name: p.name, brand: p.brand, category: p.category, ...slotMeta };
    scene.add(mesh);
    productMeshes.push(mesh);

    if (promoted) {
      const flash = new THREE.Mesh(
        new THREE.PlaneGeometry(0.34, 0.1),
        new THREE.MeshBasicMaterial({ color: '#ff2d8a' })
      );
      flash.position.set(worldPos.x, worldPos.y - 0.06, worldPos.z + 0.02 * Math.cos(rotY));
      flash.rotation.y = rotY;
      scene.add(flash);
    }
    return mesh;
  }

  const local = (bay, lx, ly, lz) => {
    const cos = Math.cos(bay.rot), sin = Math.sin(bay.rot);
    return { x: bay.x + lx * cos + lz * sin, y: ly, z: bay.z - lx * sin + lz * cos };
  };

  for (const bay of BAYS) {
    const back = new THREE.Mesh(new THREE.BoxGeometry(BAY_WIDTH, 2.05, 0.06), woodMat);
    const bp = local(bay, 0, 1.03, -0.3);
    back.position.set(bp.x, bp.y, bp.z);
    back.rotation.y = bay.rot;
    back.userData.blocker = true;
    scene.add(back);
    blockers.push(back);

    for (const lvl of SHELF_LEVELS) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(BAY_WIDTH, 0.05, 0.58), boardMat);
      const cp = local(bay, 0, lvl.y - 0.03, 0);
      board.position.set(cp.x, cp.y, cp.z);
      board.rotation.y = bay.rot;
      board.userData.blocker = true;
      scene.add(board);
      blockers.push(board);

      for (let i = 0; i < SLOTS_PER_LEVEL; i++) {
        const id = S.slotId(bay.id, lvl.id, i);
        const sku = variant.planogram[id];
        if (!sku) continue;
        const lx = (i - (SLOTS_PER_LEVEL - 1) / 2) * (BAY_WIDTH / SLOTS_PER_LEVEL);
        const pos = local(bay, lx, lvl.y, 0.08);
        placeProduct(sku, pos, bay.rot, { slot: id, bay: bay.id, level: lvl.id, index: i, zone: bay.zone });
      }
    }
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.05, 0.62), woodMat);
      const sp = local(bay, sx * BAY_WIDTH / 2, 1.03, 0);
      side.position.set(sp.x, sp.y, sp.z);
      side.rotation.y = bay.rot;
      side.userData.blocker = true;
      scene.add(side);
      blockers.push(side);
    }
    addCollider(bay.x, bay.z, BAY_WIDTH / 2 + 0.15, 0.75);
  }

  for (const f of FEATURES) {
    if (f.kind === 'endcap') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.1, 0.7), woodMat);
      body.position.set(f.x, 0.55, f.z);
      body.userData.blocker = true;
      scene.add(body);
      blockers.push(body);
      for (let i = 0; i < f.slots; i++) {
        const sku = variant.planogram[S.slotId(f.id, 'eye', i)];
        if (!sku) continue;
        const lx = (i - (f.slots - 1) / 2) * 0.6;
        placeProduct(sku, { x: f.x + lx, y: 1.1, z: f.z + 0.12 }, 0,
          { slot: S.slotId(f.id, 'eye', i), bay: f.id, level: 'feature', index: i, zone: f.zone });
      }
      addCollider(f.x, f.z, 1.1, 0.5);
    } else {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.85, 24), woodMat);
      body.position.set(f.x, 0.425, f.z);
      body.userData.blocker = true;
      scene.add(body);
      blockers.push(body);
      for (let i = 0; i < f.slots; i++) {
        const sku = variant.planogram[S.slotId(f.id, 'eye', i)];
        if (!sku) continue;
        const a = (i / f.slots) * Math.PI * 2 + 0.4;
        placeProduct(sku,
          { x: f.x + Math.sin(a) * 0.55, y: 0.85, z: f.z + Math.cos(a) * 0.55 }, a,
          { slot: S.slotId(f.id, 'eye', i), bay: f.id, level: 'feature', index: i, zone: f.zone });
      }
      addCollider(f.x, f.z, 1.3, 1.3);
    }
  }

  /* checkout counter */
  const counter = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.0, 1.2),
    new THREE.MeshStandardMaterial({ color: '#3b1f52', roughness: 0.5, metalness: 0.25 }));
  counter.position.set(STORE.checkout.x, 0.5, STORE.checkout.z - 1.4);
  counter.userData.blocker = true;
  scene.add(counter);
  blockers.push(counter);
  addCollider(STORE.checkout.x, STORE.checkout.z - 1.4, 1.7, 0.6);

  const pad = new THREE.Mesh(new THREE.CircleGeometry(STORE.checkout.radius, 32),
    new THREE.MeshBasicMaterial({ color: '#56e0b0', transparent: true, opacity: 0.14 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(STORE.checkout.x, 0.01, STORE.checkout.z);
  scene.add(pad);

  /* ---- retail media ---- */
  for (const mount of BANNER_MOUNTS) {
    const b = S.bannerAt(exp, variantId, mount.id);
    if (!b) continue;
    const tex = bannerTexture(b, mount);
    const mat = mount.kind === 'screen'
      ? new THREE.MeshBasicMaterial({ map: tex })
      : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: '#2a1440', emissiveIntensity: 0.35 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(mount.w, mount.h), mat);
    mesh.position.set(mount.x, mount.y, mount.z);
    if (mount.kind === 'floor') mesh.rotation.x = -Math.PI / 2;
    else mesh.rotation.y = mount.rot;
    mesh.userData = { bannerId: mount.id, promotedSku: b.promotedSku || null, label: mount.label };
    scene.add(mesh);
    bannerMeshes.push(mesh);

    if (mount.kind === 'screen') {
      const glow = new THREE.PointLight(b.bg, 12, 6, 2);
      glow.position.set(mount.x, mount.y, mount.z + 0.6);
      scene.add(glow);
    }
  }

  /* entrance markers so the shopper knows where they came in */
  const arch = new THREE.Mesh(new THREE.BoxGeometry(8, 0.18, 0.4),
    new THREE.MeshStandardMaterial({ color: '#ff4fa3', emissive: '#ff4fa3', emissiveIntensity: 0.6 }));
  arch.position.set(0, 3.6, 9.6);
  scene.add(arch);

  return { scene, productMeshes, bannerMeshes, blockers, colliders };
}

/* Optional: drop a .glb into assets/models/ (e.g. a supermarket kit from the Hub)
   and it is added on top of the procedural store. */
export async function tryLoadExternalModel(scene, url = 'assets/models/store.glb') {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (!head.ok) return false;
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(url);
    gltf.scene.position.set(0, 0, 0);
    scene.add(gltf.scene);
    return true;
  } catch {
    return false;
  }
}
