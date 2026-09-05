/* config.js — the store universe.
   Everything downstream (3D scene, setup editor, AI simulation, analytics)
   reads its geometry and product truth from here, so real and synthetic
   shoppers are guaranteed to be walking the same store. */

export const STORE = {
  width: 26,     // x: -13 .. 13
  depth: 20,     // z: -10 .. 10
  wallHeight: 4.2,
  spawn: { x: 0, z: 8.4, heading: 0 },   // camera looks down -Z, i.e. into the store
  checkout: { x: -9.5, z: 7.4, radius: 2.2 }
};

/* ---------------- product catalogue ---------------- */
/* salience  = how much the pack shouts on shelf (0-1)
   quality   = perceived quality, drives utility
   loyalty   = baseline share of category loyalists this brand holds */

export const PRODUCTS = [
  { id: 'aurora-oats',   name: 'Aurora Oats',        brand: 'Aurora',    category: 'Cereal',   price: 6.50, packColor: '#7b3ff2', accent: '#ffd166', salience: 0.78, quality: 0.80, loyalty: 0.26 },
  { id: 'nova-crunch',   name: 'Nova Crunch',        brand: 'Nova',      category: 'Cereal',   price: 5.90, packColor: '#ff4fa3', accent: '#fff3b0', salience: 0.86, quality: 0.72, loyalty: 0.22 },
  { id: 'grainfield',    name: 'GrainField Classic', brand: 'GrainField',category: 'Cereal',   price: 4.20, packColor: '#2f8f6a', accent: '#e8f7ef', salience: 0.44, quality: 0.66, loyalty: 0.19 },
  { id: 'halo-cereal',   name: 'Halo Everyday Flakes',brand: 'Halo',     category: 'Cereal',   price: 3.10, packColor: '#3b3f6b', accent: '#c9cdf5', salience: 0.30, quality: 0.55, loyalty: 0.11, privateLabel: true },

  { id: 'kestrel-roast', name: 'Kestrel Dark Roast', brand: 'Kestrel',   category: 'Coffee',   price: 12.80, packColor: '#241634', accent: '#e0a3ff', salience: 0.62, quality: 0.88, loyalty: 0.31 },
  { id: 'nocturne',      name: 'Nocturne Espresso',  brand: 'Nocturne',  category: 'Coffee',   price: 14.50, packColor: '#120b1d', accent: '#ff86c0', salience: 0.71, quality: 0.90, loyalty: 0.24 },
  { id: 'dailygrind',    name: 'DailyGrind Value',   brand: 'DailyGrind',category: 'Coffee',   price: 7.20,  packColor: '#b2582c', accent: '#ffe0c2', salience: 0.48, quality: 0.58, loyalty: 0.17 },
  { id: 'halo-coffee',   name: 'Halo Everyday Beans',brand: 'Halo',      category: 'Coffee',   price: 5.80,  packColor: '#3b3f6b', accent: '#c9cdf5', salience: 0.28, quality: 0.52, loyalty: 0.10, privateLabel: true },

  { id: 'pixel-chips',   name: 'Pixel Chips Sea Salt',brand: 'Pixel',    category: 'Snacks',   price: 3.90,  packColor: '#00b3a4', accent: '#082421', salience: 0.83, quality: 0.68, loyalty: 0.23 },
  { id: 'saltcliff',     name: 'Saltcliff Crisps',   brand: 'Saltcliff', category: 'Snacks',   price: 4.60,  packColor: '#f2a03d', accent: '#3a2109', salience: 0.69, quality: 0.74, loyalty: 0.21 },
  { id: 'cocoa-drift',   name: 'Cocoa Drift Bites',  brand: 'Cocoa Drift',category:'Snacks',   price: 5.40,  packColor: '#6b2f1f', accent: '#ffcf99', salience: 0.57, quality: 0.79, loyalty: 0.18 },
  { id: 'nutribar',      name: 'NutriBar Go 6-pack', brand: 'NutriBar',  category: 'Snacks',   price: 6.90,  packColor: '#4ea832', accent: '#eaffdf', salience: 0.52, quality: 0.71, loyalty: 0.16 },

  { id: 'fizzly-cola',   name: 'Fizzly Cola 1.25L',  brand: 'Fizzly',    category: 'Beverage', price: 3.40,  packColor: '#d61f3a', accent: '#fff', salience: 0.88, quality: 0.70, loyalty: 0.34 },
  { id: 'verve-energy',  name: 'Verve Energy 4-pack',brand: 'Verve',     category: 'Beverage', price: 9.60,  packColor: '#9b5cf6', accent: '#c8ff4d', salience: 0.81, quality: 0.65, loyalty: 0.20 },
  { id: 'pure-spring',   name: 'Pure Spring Water',  brand: 'Pure',      category: 'Beverage', price: 2.20,  packColor: '#3fa9e8', accent: '#eaf8ff', salience: 0.39, quality: 0.60, loyalty: 0.15 },
  { id: 'juno-juice',    name: 'Juno Orange Juice',  brand: 'Juno',      category: 'Beverage', price: 5.10,  packColor: '#ff8a2b', accent: '#4a2100', salience: 0.66, quality: 0.76, loyalty: 0.19 }
];

export const CATEGORIES = ['Cereal', 'Coffee', 'Snacks', 'Beverage'];

export const productById = id => PRODUCTS.find(p => p.id === id) || null;

/* ---------------- fixtures ----------------
   A bay is one shelf face. rot = rotation about Y; the face normal points
   along +Z of the bay's local frame, i.e. where a shopper stands to read it. */

export const SHELF_LEVELS = [
  { id: 'top',  label: 'Top shelf',    y: 1.62, visibility: 0.74 },
  { id: 'eye',  label: 'Eye level',    y: 1.22, visibility: 1.00 },
  { id: 'mid',  label: 'Waist level',  y: 0.82, visibility: 0.86 },
  { id: 'low',  label: 'Bottom shelf', y: 0.42, visibility: 0.55 }
];

export const SLOTS_PER_LEVEL = 4;
export const BAY_WIDTH = 2.6;

export const BAYS = [
  { id: 'A1F', label: 'Aisle 1 · front face', zone: 'aisle-1', x: -6.5, z: -1.4, rot: 0,          defaultCategory: 'Cereal'   },
  { id: 'A1B', label: 'Aisle 1 · back face',  zone: 'aisle-1', x: -6.5, z: -2.0, rot: Math.PI,    defaultCategory: 'Snacks'   },
  { id: 'A2F', label: 'Aisle 2 · front face', zone: 'aisle-2', x:  0.0, z: -1.4, rot: 0,          defaultCategory: 'Coffee'   },
  { id: 'A2B', label: 'Aisle 2 · back face',  zone: 'aisle-2', x:  0.0, z: -2.0, rot: Math.PI,    defaultCategory: 'Beverage' },
  { id: 'A3F', label: 'Aisle 3 · front face', zone: 'aisle-3', x:  6.5, z: -1.4, rot: 0,          defaultCategory: 'Snacks'   },
  { id: 'A3B', label: 'Aisle 3 · back face',  zone: 'aisle-3', x:  6.5, z: -2.0, rot: Math.PI,    defaultCategory: 'Beverage' }
];

/* Endcaps + promo island use a single merchandising level and fewer slots. */
export const FEATURES = [
  { id: 'EC1', label: 'Endcap · aisle 1',  zone: 'endcap-1',  x: -6.5, z: 2.6, rot: 0, slots: 3, kind: 'endcap' },
  { id: 'EC2', label: 'Endcap · aisle 3',  zone: 'endcap-3',  x:  6.5, z: 2.6, rot: 0, slots: 3, kind: 'endcap' },
  { id: 'ISL', label: 'Promo island',      zone: 'island',    x:  0.0, z: 4.6, rot: 0, slots: 4, kind: 'island' }
];

export const ZONES = [
  { id: 'entrance', label: 'Entrance / decompression', x: 0,    z: 8.0,  rx: 6.5, rz: 2.2 },
  { id: 'island',   label: 'Promo island',             x: 0,    z: 4.6,  rx: 3.0, rz: 1.8 },
  { id: 'endcap-1', label: 'Endcap 1',                 x: -6.5, z: 2.6,  rx: 2.2, rz: 1.6 },
  { id: 'endcap-3', label: 'Endcap 3',                 x: 6.5,  z: 2.6,  rx: 2.2, rz: 1.6 },
  { id: 'aisle-1',  label: 'Aisle 1',                  x: -6.5, z: -1.7, rx: 2.4, rz: 4.2 },
  { id: 'aisle-2',  label: 'Aisle 2',                  x: 0,    z: -1.7, rx: 2.4, rz: 4.2 },
  { id: 'aisle-3',  label: 'Aisle 3',                  x: 6.5,  z: -1.7, rx: 2.4, rz: 4.2 },
  { id: 'backwall', label: 'Back wall / chillers',     x: 0,    z: -8.0, rx: 12,  rz: 2.0 },
  { id: 'checkout', label: 'Checkout',                 x: -9.5, z: 7.4,  rx: 2.6, rz: 2.2 }
];

export function zoneAt(x, z) {
  for (const zn of ZONES) {
    if (Math.abs(x - zn.x) <= zn.rx && Math.abs(z - zn.z) <= zn.rz) return zn.id;
  }
  return 'floor';
}

/* ---------------- retail media surfaces ----------------
   Every mount is a measurable exposure surface: the tracker logs how long
   it was inside the shopper's gaze cone, so media effect can be attributed. */

export const BANNER_MOUNTS = [
  { id: 'entrance-arch', label: 'Entrance arch',        x: 0,    y: 3.0, z: 6.4,  rot: 0,       w: 7.0, h: 1.5, kind: 'static' },
  { id: 'wall-back',     label: 'Back wall mural',      x: 0,    y: 2.5, z: -9.7, rot: 0,       w: 11.0, h: 2.6, kind: 'static' },
  { id: 'aisle-1-head',  label: 'Aisle 1 header',       x: -6.5, y: 2.6, z: 2.9,  rot: 0,       w: 2.9, h: 0.9,  kind: 'static' },
  { id: 'aisle-3-head',  label: 'Aisle 3 header',       x: 6.5,  y: 2.6, z: 2.9,  rot: 0,       w: 2.9, h: 0.9,  kind: 'static' },
  { id: 'screen-island', label: 'Digital screen · island', x: 0, y: 2.2, z: 4.6,  rot: 0,       w: 2.2, h: 1.3,  kind: 'screen' },
  { id: 'floor-decal',   label: 'Floor decal · aisle 2',  x: 0, y: 0.02, z: 1.6,  rot: 0,       w: 2.4, h: 2.4,  kind: 'floor' }
];

/* ---------------- AI shopper personas ----------------
   Behavioural parameters, all 0..1 unless noted. These drive the simulation
   engine directly and are also serialised into the LLM prompt so a Hugging
   Face model can reason in character. */

export const PERSONAS = [
  {
    id: 'mission',
    name: 'Mission Shopper',
    blurb: 'Knows the list, wants out. Walks the shortest viable route and resists anything off-list.',
    color: '#ff4fa3',
    params: {
      exploration: 0.18, dwellRate: 0.55, priceSensitivity: 0.45, promoSensitivity: 0.35,
      brandLoyalty: 0.62, mediaReceptivity: 0.22, packSensitivity: 0.40, impulse: 0.12,
      basketTarget: 3, paceMps: 1.35, attentionFocus: 2.4
    }
  },
  {
    id: 'browser',
    name: 'Browser',
    blurb: 'No fixed list. Wanders the perimeter, reads packs, buys what catches the eye.',
    color: '#9b5cf6',
    params: {
      exploration: 0.92, dwellRate: 1.35, priceSensitivity: 0.30, promoSensitivity: 0.55,
      brandLoyalty: 0.28, mediaReceptivity: 0.72, packSensitivity: 0.88, impulse: 0.62,
      basketTarget: 4, paceMps: 0.75, attentionFocus: 1.2
    }
  },
  {
    id: 'loyalist',
    name: 'Brand Loyalist',
    blurb: 'Buys the same brand every trip. Finds it fast, barely evaluates alternatives.',
    color: '#e0a3ff',
    params: {
      exploration: 0.30, dwellRate: 0.70, priceSensitivity: 0.20, promoSensitivity: 0.25,
      brandLoyalty: 0.94, mediaReceptivity: 0.30, packSensitivity: 0.35, impulse: 0.18,
      basketTarget: 3, paceMps: 1.15, attentionFocus: 3.2
    }
  },
  {
    id: 'switcher',
    name: 'Switcher',
    blurb: 'Compares two or three options every time. Promotions and price gaps decide it.',
    color: '#ff86c0',
    params: {
      exploration: 0.55, dwellRate: 1.15, priceSensitivity: 0.82, promoSensitivity: 0.90,
      brandLoyalty: 0.16, mediaReceptivity: 0.58, packSensitivity: 0.62, impulse: 0.34,
      basketTarget: 4, paceMps: 0.95, attentionFocus: 1.6
    }
  },
  {
    id: 'value',
    name: 'Value Seeker',
    blurb: 'Scans bottom shelves and private label first, checks unit price before anything else.',
    color: '#c8a2ff',
    params: {
      exploration: 0.45, dwellRate: 0.95, priceSensitivity: 0.96, promoSensitivity: 0.78,
      brandLoyalty: 0.22, mediaReceptivity: 0.36, packSensitivity: 0.30, impulse: 0.20,
      basketTarget: 4, paceMps: 1.05, attentionFocus: 1.9
    }
  }
];

export const personaById = id => PERSONAS.find(p => p.id === id) || PERSONAS[0];

/* ---------------- defaults ---------------- */

export const DEFAULT_HF = {
  enabled: false,
  endpoint: 'https://router.huggingface.co/v1/chat/completions',
  model: 'meta-llama/Llama-3.1-8B-Instruct',
  proxy: true,          // route through the bundled local server so the token stays off the client
  token: '',
  temperature: 0.8
};

export const SESSION_DEFAULTS = {
  maxDurationSec: 240,
  gazeConeDeg: 12,      // half-angle used to decide "looking at"
  fixationMinMs: 120,   // minimum continuous gaze before a view is counted
  maxGazeDistance: 7.5
};
