/* controls.js — first person walking. Pointer lock when available,
   drag-to-look plus an on-screen pad when it is not. */

import * as THREE from 'three';
import { STORE } from '../core/config.js';

const EYE = 1.62;
const RADIUS = 0.42;

export class Walker {
  constructor(camera, dom, colliders) {
    this.camera = camera;
    this.dom = dom;
    this.colliders = colliders;
    this.yaw = STORE.spawn.heading;
    this.pitch = 0;
    this.pos = new THREE.Vector3(STORE.spawn.x, EYE, STORE.spawn.z);
    this.keys = new Set();
    this.intent = { forward: 0, strafe: 0 };
    this.locked = false;
    this.sensitivity = 0.0022;
    this.distance = 0;
    this.onLockChange = null;

    this._bind();
    this.apply();
  }

  _bind() {
    const d = this.dom;

    d.addEventListener('click', () => {
      if (!this.locked && d.requestPointerLock) d.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === d;
      this.onLockChange?.(this.locked);
    });

    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      this.clampPitch();
    });

    // drag to look, for trackpads and touch
    let dragging = false, lastX = 0, lastY = 0;
    const start = e => {
      if (this.locked) return;
      dragging = true;
      const t = e.touches ? e.touches[0] : e;
      lastX = t.clientX; lastY = t.clientY;
    };
    const move = e => {
      if (!dragging) return;
      const t = e.touches ? e.touches[0] : e;
      this.yaw -= (t.clientX - lastX) * 0.004;
      this.pitch -= (t.clientY - lastY) * 0.004;
      lastX = t.clientX; lastY = t.clientY;
      this.clampPitch();
      if (e.touches) e.preventDefault();
    };
    const end = () => { dragging = false; };
    d.addEventListener('pointerdown', start);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    d.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);

    window.addEventListener('keydown', e => {
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  clampPitch() {
    const lim = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  setIntent(forward, strafe) {
    this.intent.forward = forward;
    this.intent.strafe = strafe;
  }

  blocked(x, z) {
    const hw = STORE.width / 2 - RADIUS, hd = STORE.depth / 2 - RADIUS;
    if (x < -hw || x > hw || z < -hd || z > hd) return true;
    for (const c of this.colliders) {
      if (x > c.minX - RADIUS && x < c.maxX + RADIUS && z > c.minZ - RADIUS && z < c.maxZ + RADIUS) return true;
    }
    return false;
  }

  update(dt) {
    const k = this.keys;
    let f = this.intent.forward, s = this.intent.strafe;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) s += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) s -= 1;

    const len = Math.hypot(f, s);
    if (len > 1) { f /= len; s /= len; }

    const speed = (k.has('ShiftLeft') || k.has('ShiftRight')) ? 3.1 : 1.65;
    const step = speed * dt;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);

    // camera looks down -Z in its own frame
    const dx = (-sin * f + cos * s) * step;
    const dz = (-cos * f - sin * s) * step;

    if (!this.blocked(this.pos.x + dx, this.pos.z)) this.pos.x += dx;
    if (!this.blocked(this.pos.x, this.pos.z + dz)) this.pos.z += dz;
    this.distance += Math.hypot(dx, dz);

    // subtle head bob keeps the walk readable without being nauseating
    const bob = Math.sin(this.distance * 4.2) * 0.018 * Math.min(1, len);
    this.pos.y = EYE + bob;

    this.apply();
  }

  apply() {
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
