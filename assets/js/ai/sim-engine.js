/* sim-engine.js — the synthetic shopper panel.

   Each agent walks the same fixture graph a human walks, allocates a finite
   attention budget across the facings in front of it, and then makes a choice
   with a random-utility model. Attention is not decoration here: the dwell an
   agent gives a facing is the same quantity the webcam measures on a person,
   which is what makes the two panels comparable.

   A Hugging Face model can sit on top, reading the shelf in character and
   returning a per-SKU attention bias plus its reasoning. Without it the engine
   runs on its own and results stay reproducible. */

import {
  BAYS, FEATURES, SHELF_LEVELS, SLOTS_PER_LEVEL, ZONES, STORE,
  PRODUCTS, productById, personaById
} from '../core/config.js';
import * as S from '../core/state.js';
import { mulberry32, hashSeed, clamp, gumbel, normal, softmax, shortId } from '../core/util.js';
import { chatJson } from './hf-client.js';

const HORIZONTAL = [0.86, 1.0, 1.0, 0.86];   // centre facings win slightly

/* ---------- store introspection ---------- */

export function bayContents(exp, variantId) {
  const v = S.variant(exp, variantId);
  const out = [];
  for (const bay of BAYS) {
    const facings = [];
    for (const lvl of SHELF_LEVELS) {
      for (let i = 0; i < SLOTS_PER_LEVEL; i++) {
        const sku = v.planogram[S.slotId(bay.id, lvl.id, i)];
        if (sku) facings.push({ sku, level: lvl.id, visibility: lvl.visibility, index: i, slot: S.slotId(bay.id, lvl.id, i) });
      }
    }
    if (facings.length) out.push({ ...bay, kind: 'shelf', facings, categories: countCats(facings) });
  }
  for (const f of FEATURES) {
    const facings = [];
    for (let i = 0; i < f.slots; i++) {
      const sku = v.planogram[S.slotId(f.id, 'eye', i)];
      if (sku) facings.push({ sku, level: 'feature', visibility: 1.15, index: Math.min(i, 3), slot: S.slotId(f.id, 'eye', i) });
    }
    if (facings.length) out.push({ ...f, facings, categories: countCats(facings) });
  }
  return out;
}

function countCats(facings) {
  const c = {};
  for (const f of facings) {
    const p = productById(f.sku);
    if (p) c[p.category] = (c[p.category] || 0) + 1;
  }
  return c;
}

function dominantCategory(bay) {
  return Object.entries(bay.categories).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

export function describeStore(exp, variantId) {
  const bays = bayContents(exp, variantId);
  const lines = [`Store: ${bays.length} shopping fixtures.`];
  for (const b of bays) {
    const items = b.facings.map(f => {
      const p = productById(f.sku);
      const price = S.priceOf(exp, variantId, f.sku);
      return `${p.name} ($${price.toFixed(2)}, ${f.level}${S.isPromoted(exp, variantId, f.sku) ? ', on promotion' : ''})`;
    });
    lines.push(`- ${b.label}: ${[...new Set(items)].join('; ')}`);
  }
  for (const b of S.activeBanners(exp, variantId)) {
    const p = b.promotedSku ? productById(b.promotedSku) : null;
    lines.push(`- Media "${b.id}": "${b.headline} — ${b.subline}"${p ? ` promoting ${p.name}` : ''}`);
  }
  return lines.join('\n');
}

/* ---------- one agent ---------- */

function favouriteBrands(rand) {
  const byCat = {};
  for (const p of PRODUCTS) (byCat[p.category] ||= []).push(p);
  const fav = {};
  for (const [cat, list] of Object.entries(byCat)) {
    const total = list.reduce((s, p) => s + p.loyalty, 0);
    let r = rand() * total;
    for (const p of list) { r -= p.loyalty; if (r <= 0) { fav[cat] = p.brand; break; } }
    fav[cat] ||= list[0].brand;
  }
  return fav;
}

function planRoute(bays, persona, missionCats, rand) {
  const stops = [];
  const shelves = bays.filter(b => b.kind === 'shelf');
  const features = bays.filter(b => b.kind !== 'shelf');

  // features sit on the way in; a browser stops at most of them, a mission shopper walks past
  for (const f of features) {
    const p = f.kind === 'island' ? 0.35 + persona.exploration * 0.5 : 0.25 + persona.exploration * 0.55;
    if (rand() < p) stops.push(f);
  }

  const needed = shelves.filter(b => missionCats.includes(dominantCategory(b)));
  const rest = shelves.filter(b => !needed.includes(b));
  stops.push(...needed);
  for (const b of rest) if (rand() < persona.exploration * 0.85) stops.push(b);

  // walk them in a rough spatial order rather than the order they were chosen
  stops.sort((a, b) => (b.z - a.z) || (a.x - b.x));
  return stops;
}

function bannerPriming(exp, variantId, persona, rand) {
  const primes = {};
  const exposure = {};
  for (const b of S.activeBanners(exp, variantId)) {
    // how long this agent's eyes rest on the surface, before it decides anything
    const base = ({ 'entrance-arch': 900, 'wall-back': 700, 'screen-island': 1400, 'floor-decal': 500 })[b.id] || 600;
    const ms = base * (0.4 + persona.mediaReceptivity * 1.4) * (0.6 + rand() * 0.8);
    exposure[b.id] = Math.round(ms);
    if (b.promotedSku) {
      primes[b.promotedSku] = (primes[b.promotedSku] || 0) + (ms / 1000) * persona.mediaReceptivity * 0.55;
    }
  }
  return { primes, exposure };
}

export function simulateAgent(exp, variantId, personaId, index, opts = {}) {
  const persona = personaById(personaId);
  const P = persona.params;
  const rand = mulberry32(hashSeed(`${exp.id}|${variantId}|${personaId}|${index}|${opts.salt || ''}`));
  const bays = bayContents(exp, variantId);
  const fav = favouriteBrands(rand);
  const bias = opts.attentionBias || {};

  let missionCats = opts.missionCategories?.length ? [...opts.missionCategories] : [...exp.missionCategories];
  for (const cat of ['Snacks', 'Beverage', 'Cereal', 'Coffee']) {
    if (!missionCats.includes(cat) && rand() < P.exploration * 0.4) missionCats.push(cat);
  }

  const { primes, exposure } = bannerPriming(exp, variantId, P, rand);
  const route = planRoute(bays, P, missionCats, rand);

  const attention = {}, views = {}, firstFixation = {}, zoneDwell = {}, interactions = [];
  const zoneSequence = ['entrance'];
  const path = [{ t: 0, x: STORE.spawn.x, z: STORE.spawn.z, zone: 'entrance' }];
  const considered = {};   // category -> {sku: dwell}
  let t = 1200 * (1.4 - P.paceMps * 0.5);   // decompression zone at the door
  zoneDwell.entrance = t;
  let prev = { x: STORE.spawn.x, z: STORE.spawn.z };

  for (const bay of route) {
    // walk there
    const dist = Math.hypot(bay.x - prev.x, bay.z - prev.z);
    const walkMs = (dist / Math.max(0.5, P.paceMps)) * 1000;
    t += walkMs;
    path.push({ t: Math.round(t), x: +bay.x.toFixed(2), z: +bay.z.toFixed(2), zone: bay.zone });
    if (zoneSequence[zoneSequence.length - 1] !== bay.zone) zoneSequence.push(bay.zone);
    prev = { x: bay.x, z: bay.z };

    const cat = dominantCategory(bay);
    const onMission = missionCats.includes(cat);
    const relevance = onMission ? 1.55 : (0.25 + P.exploration * 0.75);
    const featureBoost = bay.kind === 'shelf' ? 1 : 1.25;

    let bayDwell = 3400 * P.dwellRate * relevance * featureBoost * (0.65 + rand() * 0.7);
    if (!onMission && rand() > 0.35 + P.exploration * 0.6) bayDwell *= 0.35;   // glance and move on
    bayDwell = clamp(bayDwell, 350, 26000);

    // weight every facing on this fixture
    const weights = {};
    for (const f of bay.facings) {
      const p = productById(f.sku);
      if (!p) continue;
      const price = S.priceOf(exp, variantId, f.sku);
      const promoted = S.isPromoted(exp, variantId, f.sku);
      const loyal = fav[p.category] === p.brand ? 1 : 0;

      let w = f.visibility;
      w *= HORIZONTAL[clamp(f.index, 0, 3)];
      w *= 1 + P.packSensitivity * p.salience * 1.15;
      w *= 1 + P.promoSensitivity * (promoted ? 0.85 : 0);
      w *= 1 + P.brandLoyalty * loyal * 1.6;
      w *= 1 + (primes[f.sku] || 0);
      w *= 1 + P.priceSensitivity * (p.privateLabel ? 0.5 : 0);
      w *= Math.exp((bias[f.sku] || 0) * 0.75);
      w *= 1 + normal(rand, 0, 0.12);
      weights[f.sku] = (weights[f.sku] || 0) + Math.max(0.02, w);   // extra facings compound
    }
    if (!Object.keys(weights).length) continue;

    const share = softmax(weights, P.attentionFocus);
    for (const [sku, s] of Object.entries(share)) {
      const ms = bayDwell * s;
      if (ms < 40) continue;
      attention[sku] = (attention[sku] || 0) + ms;
      if (firstFixation[sku] === undefined) firstFixation[sku] = Math.round(t);
      views[sku] = (views[sku] || 0) + Math.max(1, Math.round(s * 4));
      const p = productById(sku);
      (considered[p.category] ||= {})[sku] = (considered[p.category][sku] || 0) + ms;
    }

    // handling: the top-attention facing sometimes gets picked up and read
    const top = Object.entries(share).sort((a, b) => b[1] - a[1])[0];
    if (top && rand() < 0.3 + P.dwellRate * 0.3) {
      interactions.push({ t: Math.round(t + bayDwell * 0.6), sku: top[0], slot: null, type: 'inspect' });
    }

    zoneDwell[bay.zone] = (zoneDwell[bay.zone] || 0) + bayDwell;
    t += bayDwell;
  }

  /* ---- choice ---- */

  const basket = [];
  let spend = 0;
  const catAvg = {};
  for (const p of PRODUCTS) {
    (catAvg[p.category] ||= []).push(p.price);
  }
  for (const k in catAvg) catAvg[k] = catAvg[k].reduce((a, b) => a + b, 0) / catAvg[k].length;

  const catsToBuy = Object.keys(considered).filter(cat =>
    missionCats.includes(cat) || rand() < P.impulse);

  for (const cat of catsToBuy) {
    if (basket.length >= P.basketTarget) break;
    const options = Object.entries(considered[cat]);
    if (!options.length) continue;

    let best = null, bestU = -Infinity;
    for (const [sku, dwell] of options) {
      const p = productById(sku);
      const price = S.priceOf(exp, variantId, sku);
      const promoted = S.isPromoted(exp, variantId, sku);
      const loyal = fav[cat] === p.brand ? 1 : 0;

      const u =
        1.25 * Math.log(1 + dwell / 900) +
        1.30 * p.quality +
        1.85 * P.brandLoyalty * loyal +
        1.15 * P.promoSensitivity * (promoted ? 1 : 0) +
        0.85 * (primes[sku] || 0) +
        0.55 * P.packSensitivity * p.salience -
        2.10 * P.priceSensitivity * (price / catAvg[cat]) +
        0.75 * (bias[sku] || 0) +
        gumbel(rand);

      if (u > bestU) { bestU = u; best = { sku, price }; }
    }

    const noBuyUtility = 1.9 - 1.5 * (missionCats.includes(cat) ? 1 : 0) + gumbel(rand) * 0.8;
    if (!best || bestU < noBuyUtility) continue;
    if (spend + best.price > exp.budget) continue;

    basket.push({ sku: best.sku, price: best.price, slot: null });
    spend += best.price;
    interactions.push({ t: Math.round(t), sku: best.sku, slot: null, type: 'pickup' });
  }

  // to the checkout
  const co = STORE.checkout;
  t += (Math.hypot(co.x - prev.x, co.z - prev.z) / Math.max(0.5, P.paceMps)) * 1000 + 4000;
  path.push({ t: Math.round(t), x: co.x, z: co.z, zone: 'checkout' });
  zoneSequence.push('checkout');
  zoneDwell.checkout = (zoneDwell.checkout || 0) + 4000;

  const bannerAttributed = {};
  for (const b of S.activeBanners(exp, variantId)) {
    if (b.promotedSku) bannerAttributed[b.promotedSku] = (bannerAttributed[b.promotedSku] || 0) + (exposure[b.id] || 0);
  }

  return {
    id: 'syn-' + shortId(),
    kind: 'synthetic',
    variant: variantId,
    persona: personaId,
    startedAt: Date.now(),
    durationMs: Math.round(t),
    distanceM: +estimateDistance(path).toFixed(2),
    gazeMode: 'simulated',
    reasoning: opts.reasoning || null,
    modelBacked: !!opts.modelBacked,
    attention: roundAll(attention),
    views,
    firstFixation,
    zoneDwell: roundAll(zoneDwell),
    zoneSequence,
    bannerExposure: exposure,
    bannerAttributed: roundAll(bannerAttributed),
    path,
    interactions,
    basket,
    basketValue: +spend.toFixed(2),
    onShelfGazeShare: 0.62
  };
}

function estimateDistance(path) {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  return d;
}

function roundAll(o) {
  const out = {};
  for (const k in o) out[k] = Math.round(o[k]);
  return out;
}

/* ---------- optional model layer ---------- */

export async function personaBrief(exp, variantId, personaId) {
  const persona = personaById(personaId);
  const system = `You are simulating a supermarket shopper for a shelf test. Stay in character.
Character: ${persona.name}. ${persona.blurb}
Behavioural profile (0-1): ${JSON.stringify(persona.params)}`;

  const user = `${describeStore(exp, variantId)}

Task given to shoppers: "${exp.shopperTask}"
Budget: $${exp.budget}.

As this shopper, decide where your attention would go before you buy anything.
Return JSON exactly like:
{"mission_categories":["Cereal"],"attention_bias":{"<product name>":0.0},"likely_purchases":["<product name>"],"reasoning":"two sentences in first person"}
attention_bias runs -1 (I would skip past it) to 1 (it would pull my eye). Include at most 8 products.`;

  const raw = await chatJson(exp.hf, [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ], { maxTokens: 620 });

  // map product names back onto SKU ids
  const bias = {};
  for (const [name, value] of Object.entries(raw.attention_bias || {})) {
    const p = PRODUCTS.find(x =>
      x.name.toLowerCase() === String(name).toLowerCase() ||
      x.name.toLowerCase().includes(String(name).toLowerCase()) ||
      String(name).toLowerCase().includes(x.brand.toLowerCase()));
    if (p) bias[p.id] = clamp(Number(value) || 0, -1, 1);
  }
  return {
    attentionBias: bias,
    missionCategories: Array.isArray(raw.mission_categories) ? raw.mission_categories : null,
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : null
  };
}

/* Runs the whole panel for one variant. onProgress(done, total, note). */
export async function runPanel(exp, variantId, { onProgress = () => {}, useModel = false } = {}) {
  const mix = exp.personaMix || {};
  const jobs = [];
  for (const [personaId, count] of Object.entries(mix)) {
    for (let i = 0; i < count; i++) jobs.push({ personaId, i });
  }
  const total = jobs.length;
  const sessions = [];
  const briefs = {};

  for (const personaId of Object.keys(mix)) {
    if (!useModel || !mix[personaId]) continue;
    onProgress(sessions.length, total, `Briefing the ${personaById(personaId).name} on this store…`);
    try {
      briefs[personaId] = await personaBrief(exp, variantId, personaId);
    } catch (err) {
      briefs[personaId] = { error: err.message };
      onProgress(sessions.length, total, `Model call failed for ${personaById(personaId).name}: ${err.message}`);
    }
  }

  for (const job of jobs) {
    const brief = briefs[job.personaId];
    const session = simulateAgent(exp, variantId, job.personaId, job.i, {
      attentionBias: brief?.attentionBias,
      missionCategories: brief?.missionCategories,
      reasoning: brief?.reasoning,
      modelBacked: !!brief?.attentionBias,
      salt: variantId
    });
    sessions.push(session);
    if (sessions.length % 5 === 0 || sessions.length === total) {
      onProgress(sessions.length, total, `Simulated ${sessions.length} of ${total} shoppers`);
      await new Promise(r => setTimeout(r, 0));   // let the progress bar paint
    }
  }
  return { sessions, briefs };
}
