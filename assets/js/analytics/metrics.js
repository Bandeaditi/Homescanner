/* metrics.js — turns raw sessions into shares, then scores how close the
   synthetic panel came to the human one.

   Fidelity is deliberately made of several independent agreements rather than
   one number: a panel can match attention beautifully and still get the
   purchase decision wrong, and a buyer of this research needs to see which. */

import { PRODUCTS, ZONES, productById } from '../core/config.js';
import {
  normalise, pearson, spearman, jensenShannon, totalVariation,
  topOverlap, sequenceSimilarity, mean
} from '../core/util.js';

export function aggregate(sessions) {
  const n = sessions.length;
  const attention = {}, views = {}, purchases = {}, zone = {}, banner = {}, firstFix = {};
  let duration = 0, basketValue = 0, items = 0, distance = 0;

  for (const s of sessions) {
    for (const [k, v] of Object.entries(s.attention || {})) attention[k] = (attention[k] || 0) + v;
    for (const [k, v] of Object.entries(s.views || {})) views[k] = (views[k] || 0) + v;
    for (const [k, v] of Object.entries(s.zoneDwell || {})) zone[k] = (zone[k] || 0) + v;
    for (const [k, v] of Object.entries(s.bannerExposure || {})) banner[k] = (banner[k] || 0) + v;
    for (const [k, v] of Object.entries(s.firstFixation || {})) (firstFix[k] ||= []).push(v);
    for (const b of s.basket || []) purchases[b.sku] = (purchases[b.sku] || 0) + 1;
    duration += s.durationMs || 0;
    basketValue += s.basketValue || 0;
    items += (s.basket || []).length;
    distance += s.distanceM || 0;
  }

  const medianFix = {};
  for (const [k, arr] of Object.entries(firstFix)) {
    arr.sort((a, b) => a - b);
    medianFix[k] = arr[Math.floor(arr.length / 2)];
  }

  const reach = {};   // share of shoppers who looked at the SKU at all
  for (const p of PRODUCTS) {
    reach[p.id] = n ? sessions.filter(s => (s.attention?.[p.id] || 0) > 150).length / n : 0;
  }

  const conversion = {};
  for (const p of PRODUCTS) {
    const lookers = sessions.filter(s => (s.attention?.[p.id] || 0) > 150).length;
    const buyers = sessions.filter(s => (s.basket || []).some(b => b.sku === p.id)).length;
    conversion[p.id] = lookers ? buyers / lookers : 0;
  }

  return {
    n,
    attention, views, purchases, zone, banner,
    attentionShare: normalise(attention),
    viewShare: normalise(views),
    purchaseShare: normalise(purchases),
    zoneShare: normalise(zone),
    bannerShare: normalise(banner),
    medianFirstFixation: medianFix,
    reach,
    conversion,
    avgDurationMs: n ? duration / n : 0,
    avgBasketValue: n ? basketValue / n : 0,
    avgItems: n ? items / n : 0,
    avgDistanceM: n ? distance / n : 0,
    sequences: sessions.map(s => s.zoneSequence || [])
  };
}

const skuKeys = () => PRODUCTS.map(p => p.id);
const vec = (share, keys) => keys.map(k => share[k] || 0);

export function compare(real, synth) {
  const keys = skuKeys();
  const ra = vec(real.attentionShare, keys), sa = vec(synth.attentionShare, keys);
  const rp = vec(real.purchaseShare, keys), sp = vec(synth.purchaseShare, keys);
  const zoneKeys = ZONES.map(z => z.id);

  const attentionCorr = pearson(ra, sa);
  const attentionRank = spearman(ra, sa);
  const attentionJsd = jensenShannon(real.attentionShare, synth.attentionShare);
  const attentionTop3 = topOverlap(real.attentionShare, synth.attentionShare, 3);
  const attentionTop5 = topOverlap(real.attentionShare, synth.attentionShare, 5);

  const purchaseTvd = totalVariation(real.purchaseShare, synth.purchaseShare);
  const purchaseCorr = pearson(rp, sp);

  const zoneJsd = jensenShannon(
    Object.fromEntries(zoneKeys.map(k => [k, real.zoneShare[k] || 0])),
    Object.fromEntries(zoneKeys.map(k => [k, synth.zoneShare[k] || 0]))
  );

  const seq = crossSequenceSimilarity(real.sequences, synth.sequences);

  const durationRatio = real.avgDurationMs ? synth.avgDurationMs / real.avgDurationMs : 0;
  const basketRatio = real.avgItems ? synth.avgItems / real.avgItems : 0;

  const components = [
    { id: 'attention-corr', label: 'Attention share correlation', value: Math.max(0, attentionCorr), weight: 0.28,
      detail: `Pearson r = ${attentionCorr.toFixed(2)} across ${keys.length} SKUs` },
    { id: 'attention-top3', label: 'Top-3 attention overlap', value: attentionTop3, weight: 0.14,
      detail: 'Do the same three facings win the eye?' },
    { id: 'attention-jsd', label: 'Attention distribution match', value: 1 - attentionJsd, weight: 0.16,
      detail: `Jensen–Shannon divergence ${attentionJsd.toFixed(3)}` },
    { id: 'purchase-tvd', label: 'Share-of-choice match', value: 1 - purchaseTvd, weight: 0.22,
      detail: `Total variation distance ${purchaseTvd.toFixed(3)}` },
    { id: 'zone-jsd', label: 'Store coverage match', value: 1 - zoneJsd, weight: 0.10,
      detail: 'Time split across aisles, endcaps and features' },
    { id: 'sequence', label: 'Route similarity', value: seq, weight: 0.10,
      detail: 'Edit distance between zone visit orders' }
  ];

  const fidelity = components.reduce((s, c) => s + c.value * c.weight, 0) * 100;

  return {
    n: { real: real.n, synth: synth.n },
    attentionCorr, attentionRank, attentionJsd, attentionTop3, attentionTop5,
    purchaseTvd, purchaseCorr, zoneJsd, sequenceSimilarity: seq,
    durationRatio, basketRatio,
    components,
    fidelity: Math.max(0, Math.min(100, fidelity)),
    grade: grade(fidelity)
  };
}

function grade(score) {
  if (score >= 82) return { label: 'Directionally reliable', note: 'Usable as a screening instrument for this store type.' };
  if (score >= 68) return { label: 'Useful with guardrails', note: 'Ranking is trustworthy; absolute levels are not.' };
  if (score >= 52) return { label: 'Early signal only', note: 'Use for hypothesis generation, validate winners with people.' };
  return { label: 'Not yet calibrated', note: 'Collect more human sessions before trusting the panel.' };
}

function crossSequenceSimilarity(realSeqs, synthSeqs) {
  if (!realSeqs.length || !synthSeqs.length) return 0;
  const sampleR = realSeqs.slice(0, 12);
  const sampleS = synthSeqs.slice(0, 24);
  const scores = [];
  for (const r of sampleR) {
    for (const s of sampleS) scores.push(sequenceSimilarity(dedupe(r), dedupe(s)));
  }
  return mean(scores);
}

const dedupe = seq => seq.filter((z, i) => i === 0 || z !== seq[i - 1]);

/* Per-SKU table joining the two panels. */
export function skuTable(real, synth) {
  return PRODUCTS.map(p => ({
    sku: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    color: p.packColor,
    realAttention: real.attentionShare[p.id] || 0,
    synthAttention: synth.attentionShare[p.id] || 0,
    realPurchase: real.purchaseShare[p.id] || 0,
    synthPurchase: synth.purchaseShare[p.id] || 0,
    realReach: real.reach[p.id] || 0,
    synthReach: synth.reach[p.id] || 0,
    realConversion: real.conversion[p.id] || 0,
    synthConversion: synth.conversion[p.id] || 0,
    gap: (synth.attentionShare[p.id] || 0) - (real.attentionShare[p.id] || 0)
  })).sort((a, b) => (b.realAttention + b.synthAttention) - (a.realAttention + a.synthAttention));
}

/* A/B read-out for one panel: does the variant move attention or choice? */
export function variantLift(aggA, aggB, sku) {
  const attA = aggA.attentionShare[sku] || 0, attB = aggB.attentionShare[sku] || 0;
  const buyA = aggA.purchaseShare[sku] || 0, buyB = aggB.purchaseShare[sku] || 0;
  return {
    sku,
    name: productById(sku)?.name || sku,
    attentionA: attA, attentionB: attB,
    attentionLift: attA ? (attB - attA) / attA : 0,
    purchaseA: buyA, purchaseB: buyB,
    purchaseLift: buyA ? (buyB - buyA) / buyA : 0
  };
}

/* Does the synthetic panel rank the variants the way the humans did? */
export function liftAgreement(realA, realB, synthA, synthB) {
  const keys = skuKeys();
  const realDelta = keys.map(k => (realB.attentionShare[k] || 0) - (realA.attentionShare[k] || 0));
  const synthDelta = keys.map(k => (synthB.attentionShare[k] || 0) - (synthA.attentionShare[k] || 0));
  const sameSign = keys.filter((_, i) =>
    Math.sign(realDelta[i]) === Math.sign(synthDelta[i]) && Math.abs(realDelta[i]) > 0.002).length;
  const moved = realDelta.filter(d => Math.abs(d) > 0.002).length;
  return {
    correlation: pearson(realDelta, synthDelta),
    directionalAgreement: moved ? sameSign / moved : 0,
    moved
  };
}

/* Time and cost framing against a physical test, using published-order-of-magnitude
   assumptions the user can change. */
export function studyEconomics(realSessions, synthSessions, opts = {}) {
  const physicalCost = opts.physicalCost ?? 100000;
  const physicalWeeks = opts.physicalWeeks ?? 10;
  const costPerRealSession = opts.costPerRealSession ?? 12;
  const costPerSynthSession = opts.costPerSynthSession ?? 0.04;
  const setupHours = opts.setupHours ?? 6;
  const hourlyRate = opts.hourlyRate ?? 90;

  const digitalCost = setupHours * hourlyRate
    + realSessions * costPerRealSession
    + synthSessions * costPerSynthSession;
  const days = Math.max(1, Math.ceil(setupHours / 6) + Math.ceil(realSessions / 40));

  return {
    physicalCost, physicalWeeks,
    digitalCost: Math.round(digitalCost),
    digitalDays: days,
    costSaving: 1 - digitalCost / physicalCost,
    timeSaving: 1 - days / (physicalWeeks * 7)
  };
}
