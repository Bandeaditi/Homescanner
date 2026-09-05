/* state.js — one experiment object, persisted to localStorage.
   An experiment holds N variants (A/B/...) and every session ever recorded
   against them, real or synthetic, in one shared schema. */

import {
  BAYS, FEATURES, SHELF_LEVELS, SLOTS_PER_LEVEL, BANNER_MOUNTS,
  PRODUCTS, PERSONAS, DEFAULT_HF, productById
} from './config.js';

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

function seedBanners(mode = 'A') {
  const promoted = mode === 'A' ? 'nova-crunch' : 'aurora-oats';
  const base = {};
  for (const m of BANNER_MOUNTS) {
    base[m.id] = {
      enabled: ['entrance-arch', 'wall-back', 'screen-island'].includes(m.id),
      headline: mode === 'A' ? 'Nova Crunch' : 'Aurora Oats',
      subline: mode === 'A' ? 'Two for $9 this week' : 'Wholegrain, no added sugar',
      promotedSku: promoted,
      bg: mode === 'A' ? '#ff4fa3' : '#9b5cf6',
      fg: '#120720'
    };
  }
  base['aisle-1-head'].headline = 'Breakfast';
  base['aisle-1-head'].subline = 'Cereal & spreads';
  base['aisle-3-head'].headline = 'Snacking';
  base['aisle-3-head'].subline = 'Chips, bars, bites';
  base['floor-decal'].headline = 'On promotion';
  base['floor-decal'].subline = 'Aisle 2';
  return base;
}

function seedVariant(id, name, mode) {
  return {
    id, name,
    note: mode === 'A' ? 'Control planogram, hero brand at eye level.' : 'Test cell: hero demoted, different media creative.',
    planogram: seedPlanogram(mode),
    banners: seedBanners(mode),
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
  for (const key of Object.keys(merged.variants)) {
    const v = merged.variants[key];
    const full = emptyPlanogram();
    merged.variants[key] = {
      ...seedVariant(key, v.name || `Variant ${key}`, key),
      ...v,
      planogram: { ...full, ...(v.planogram || {}) }
    };
  }
  merged.sessions = Array.isArray(merged.sessions) ? merged.sessions : [];
  return merged;
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
  for (const b of Object.values(v.banners || {})) {
    if (b.enabled && b.promotedSku) counts[b.promotedSku] = counts[b.promotedSku] || 0;
  }
  return counts;
}

export function activeBanners(exp, variantId) {
  const v = variant(exp, variantId);
  return Object.entries(v.banners || {})
    .filter(([, b]) => b.enabled)
    .map(([id, b]) => ({ id, ...b }));
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
  return JSON.stringify(exp, null, 2);
}

export function importJson(text) {
  const parsed = JSON.parse(text);
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
