/* state.js — one experiment object, persisted to localStorage.
   An experiment holds N variants (A/B/...) and every session ever recorded
   against them, real or synthetic, in one shared schema. */

import {
  BAYS, FEATURES, SHELF_LEVELS, SLOTS_PER_LEVEL, BANNER_MOUNTS,
  PRODUCTS, PERSONAS, DEFAULT_HF, productById
} from './config.js';
import { exportImages, importImages } from './images.js';

const KEY = 'shopperlab.experiment.v1';

export function slotId(bayId, levelId, index) { return `${bayId}.${levelId}.${index}`; }
export function parseSlot(id) {
  const [bay, level, index] = id.split('.');
  return { bay, level, index: Number(index) };
}

/* Every addressable facing in the store, in reading order. */
export function allSlots() {
  const out = [];
  for (const bay of BAYS) {
    for (const lvl of SHELF_LEVELS) {
      for (let i = 0; i < SLOTS_PER_LEVEL; i++) {
        out.push({ id: slotId(bay.id, lvl.id, i), bay: bay.id, level: lvl.id, index: i, kind: 'shelf' });
      }
    }
  }
  for (const f of FEATURES) {
    for (let i = 0; i < f.slots; i++) {
      out.push({ id: slotId(f.id, 'eye', i), bay: f.id, level: 'eye', index: i, kind: f.kind });
    }
  }
  return out;
}

function emptyPlanogram() {
  const p = {};
  for (const s of allSlots()) p[s.id] = null;
  return p;
}

/* A sensible starting planogram: each aisle face merchandised by category,
   the strongest brand at eye level. Variant B then shifts things around so
   there is something to A/B test on first run. */
function seedPlanogram(mode = 'A') {
  const plan = emptyPlanogram();
  const byCat = {};
  for (const p of PRODUCTS) (byCat[p.category] ||= []).push(p);
  for (const k in byCat) byCat[k].sort((a, b) => b.quality - a.quality);

  const levelOrder = mode === 'A'
    ? ['eye', 'mid', 'top', 'low']
    : ['mid', 'eye', 'low', 'top'];   // B demotes the hero brand one shelf

  for (const bay of BAYS) {
    const list = byCat[bay.defaultCategory] || [];
    levelOrder.forEach((levelId, rank) => {
      const product = list[rank % list.length];
      if (!product) return;
      for (let i = 0; i < SLOTS_PER_LEVEL; i++) {
        // two facings of the rank product, two of its neighbour, to create competition
        const alt = list[(rank + (i > 1 ? 1 : 0)) % list.length];
        plan[slotId(bay.id, levelId, i)] = (i > 1 ? alt : product).id;
      }
    });
  }

  const featureFill = mode === 'A'
    ? { EC1: 'nova-crunch', EC2: 'pixel-chips', ISL: 'fizzly-cola' }
    : { EC1: 'aurora-oats', EC2: 'saltcliff',   ISL: 'verve-energy' };

  for (const f of FEATURES) {
    for (let i = 0; i < f.slots; i++) plan[slotId(f.id, 'eye', i)] = featureFill[f.id];
  }
  return plan;
}

/* Creatives live at experiment level: upload or write one, then drag it onto
   as many surfaces as you like, in either variant. A surface with no creative
   on it is simply off. */
export function seedCreatives() {
  return [
    { id: 'cr-nova',   name: 'Nova Crunch price promo', imageId: null,
      headline: 'Nova Crunch', subline: 'Two for $9 this week',
      bg: '#ff4fa3', fg: '#120720', promotedSku: 'nova-crunch' },
    { id: 'cr-aurora', name: 'Aurora Oats brand ad', imageId: null,
      headline: 'Aurora Oats', subline: 'Wholegrain, no added sugar',
      bg: '#9b5cf6', fg: '#120720', promotedSku: 'aurora-oats' },
    { id: 'cr-break',  name: 'Breakfast aisle sign', imageId: null,
      headline: 'Breakfast', subline: 'Cereal & spreads',
      bg: '#2b1b47', fg: '#f2e9ff', promotedSku: null },
    { id: 'cr-snack',  name: 'Snacking aisle sign', imageId: null,
      headline: 'Snacking', subline: 'Chips, bars, bites',
      bg: '#2b1b47', fg: '#f2e9ff', promotedSku: null }
  ];
}

/* Which creative sits on which mount, per variant. null means the surface is off. */
function seedBannerSlots(mode = 'A') {
  const hero = mode === 'A' ? 'cr-nova' : 'cr-aurora';
  const slots = {};
  for (const m of BANNER_MOUNTS) slots[m.id] = null;
  slots['entrance-arch'] = hero;
  slots['wall-back'] = hero;
  slots['screen-island'] = hero;
  slots['aisle-1-head'] = 'cr-break';
  slots['aisle-3-head'] = 'cr-snack';
  return slots;
}

function seedVariant(id, name, mode) {
  return {
    id, name,
    note: mode === 'A' ? 'Control planogram, hero brand at eye level.' : 'Test cell: hero demoted, different media creative.',
    planogram: seedPlanogram(mode),
    banners: seedBannerSlots(mode),
    priceOverrides: {},
    promoSkus: mode === 'A' ? ['nova-crunch', 'fizzly-cola'] : ['aurora-oats', 'verve-energy']
  };
}

export function defaultExperiment() {
  return {
    id: 'exp-' + Math.random().toString(36).slice(2, 8),
    name: 'Cereal & coffee shelf test',
    created: Date.now(),
    activeVariant: 'A',
    creatives: seedCreatives(),
    variants: {
      A: seedVariant('A', 'Variant A — control', 'A'),
      B: seedVariant('B', 'Variant B — test', 'B')
    },
    shopperTask: 'You are doing a mid-week top-up shop. Pick up breakfast and something to drink, then head to checkout.',
    missionCategories: ['Cereal', 'Coffee'],
    budget: 30,
    personaMix: Object.fromEntries(PERSONAS.map(p => [p.id, 8])),
    hf: { ...DEFAULT_HF },
    sessions: []
  };
}

let cache = null;

export function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      cache = migrate(parsed);
      return cache;
    }
  } catch (err) {
    console.warn('Could not read saved experiment, starting fresh.', err);
  }
  cache = defaultExperiment();
  save();
  return cache;
}

function migrate(exp) {
  const base = defaultExperiment();
  const merged = { ...base, ...exp };
  merged.hf = { ...base.hf, ...(exp.hf || {}) };
  merged.variants = merged.variants || base.variants;
  merged.creatives = Array.isArray(merged.creatives) ? merged.creatives : [];

  for (const key of Object.keys(merged.variants)) {
    const v = merged.variants[key];
    const full = emptyPlanogram();
    merged.variants[key] = {
      ...seedVariant(key, v.name || `Variant ${key}`, key),
      ...v,
      planogram: { ...full, ...(v.planogram || {}) },
      banners: upgradeBanners(v.banners, merged.creatives)
    };
  }
  if (!merged.creatives.length) merged.creatives = base.creatives;
  merged.sessions = Array.isArray(merged.sessions) ? merged.sessions : [];
  return merged;
}

/* Experiments saved before the creative library stored the artwork inline on
   each mount. Lift those into creatives so old files keep working. */
function upgradeBanners(banners, creatives) {
  const slots = {};
  for (const m of BANNER_MOUNTS) slots[m.id] = null;
  if (!banners) return slots;

  for (const [mountId, value] of Object.entries(banners)) {
    if (!(mountId in slots)) continue;
    if (value === null || typeof value === 'string') { slots[mountId] = value; continue; }
    if (typeof value !== 'object') continue;
    if (!value.enabled) { slots[mountId] = null; continue; }

    const match = creatives.find(c =>
      c.headline === value.headline && c.subline === value.subline && c.bg === value.bg);
    if (match) { slots[mountId] = match.id; continue; }

    const created = {
      id: 'cr-' + Math.random().toString(36).slice(2, 8),
      name: value.headline || mountId,
      imageId: value.imageId || null,
      headline: value.headline || '',
      subline: value.subline || '',
      bg: value.bg || '#9b5cf6',
      fg: value.fg || '#120720',
      promotedSku: value.promotedSku || null
    };
    creatives.push(created);
    slots[mountId] = created.id;
  }
  return slots;
}

export function save(exp = cache) {
  cache = exp;
  try {
    localStorage.setItem(KEY, JSON.stringify(exp));
  } catch (err) {
    console.warn('Save failed — storage may be full.', err);
  }
  return exp;
}

export function reset() {
  cache = defaultExperiment();
  save();
  return cache;
}

export function variant(exp, id = exp.activeVariant) {
  return exp.variants[id] || exp.variants[Object.keys(exp.variants)[0]];
}

/* Effective price for a SKU inside a variant (override + promo discount). */
export function priceOf(exp, variantId, sku) {
  const v = variant(exp, variantId);
  const p = productById(sku);
  if (!p) return 0;
  const base = v.priceOverrides?.[sku] ?? p.price;
  return v.promoSkus?.includes(sku) ? Math.round(base * 0.8 * 100) / 100 : base;
}

export function isPromoted(exp, variantId, sku) {
  return !!variant(exp, variantId).promoSkus?.includes(sku);
}

/* Which SKUs are actually merchandised in this variant, with facing counts. */
export function facingsOf(exp, variantId) {
  const v = variant(exp, variantId);
  const counts = {};
  for (const [, sku] of Object.entries(v.planogram)) {
    if (sku) counts[sku] = (counts[sku] || 0) + 1;
  }
  for (const b of activeBanners(exp, variantId)) {
    if (b.promotedSku) counts[b.promotedSku] = counts[b.promotedSku] || 0;
  }
  return counts;
}

export function creativeById(exp, id) {
  return (exp.creatives || []).find(c => c.id === id) || null;
}

/* The creative showing on one mount in one variant, or null if the surface is off. */
export function bannerAt(exp, variantId, mountId) {
  const slot = variant(exp, variantId).banners?.[mountId];
  if (!slot) return null;
  const creative = creativeById(exp, slot);
  // mount id must win: everything downstream keys banner metrics on the surface,
  // not on the creative that happens to be sitting there today
  return creative ? { ...creative, id: mountId, mountId, creativeId: creative.id } : null;
}

export function activeBanners(exp, variantId) {
  return BANNER_MOUNTS
    .map(m => bannerAt(exp, variantId, m.id))
    .filter(Boolean);
}

export function setBanner(exp, variantId, mountId, creativeId) {
  variant(exp, variantId).banners[mountId] = creativeId || null;
  save(exp);
}

export function addCreative(exp, creative) {
  exp.creatives = exp.creatives || [];
  exp.creatives.push(creative);
  save(exp);
  return creative;
}

export function removeCreative(exp, creativeId) {
  exp.creatives = (exp.creatives || []).filter(c => c.id !== creativeId);
  for (const v of Object.values(exp.variants)) {
    for (const mountId of Object.keys(v.banners || {})) {
      if (v.banners[mountId] === creativeId) v.banners[mountId] = null;
    }
  }
  save(exp);
}

/* ---------------- sessions ---------------- */

export function addSession(exp, session) {
  exp.sessions.push(session);
  if (exp.sessions.length > 800) exp.sessions = exp.sessions.slice(-800);
  save(exp);
  return session;
}

export function clearSessions(exp, kind = null) {
  exp.sessions = kind ? exp.sessions.filter(s => s.kind !== kind) : [];
  save(exp);
}

export function sessionsOf(exp, kind, variantId = null) {
  return exp.sessions.filter(s => s.kind === kind && (!variantId || s.variant === variantId));
}

export function exportJson(exp) {
  const ids = (exp.creatives || []).map(c => c.imageId).filter(Boolean);
  return JSON.stringify({ ...exp, _images: exportImages(ids) }, null, 2);
}

export function importJson(text) {
  const parsed = JSON.parse(text);
  if (parsed._images) importImages(parsed._images);
  delete parsed._images;
  cache = migrate(parsed);
  save();
  return cache;
}

/* Small helper shared by every page's header. */
export function mountNav(active) {
  const links = [
    ['index.html', 'Set up store'],
    ['store.html', 'Run a shopper'],
    ['simulate.html', 'AI panel'],
    ['results.html', 'Results']
  ];
  const el = document.querySelector('.nav');
  if (!el) return;
  el.innerHTML = links.map(([href, label]) =>
    `<a href="${href}"${href === active ? ' aria-current="page"' : ''}>${label}</a>`).join('');
}
