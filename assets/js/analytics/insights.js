/* insights.js — reads the aggregates and writes the findings a category
   manager would act on. Rules first, so every claim points at a number;
   the language model, when switched on, only rewrites the summary. */

import { PRODUCTS, SHELF_LEVELS, SLOTS_PER_LEVEL, BAYS, productById } from '../core/config.js';
import * as S from '../core/state.js';
import { normalise, fmtPct } from '../core/util.js';
import { chat } from '../ai/hf-client.js';

/* Attention split by shelf height, apportioned from SKU attention through the planogram. */
export function attentionByLevel(exp, variantId, agg) {
  const v = S.variant(exp, variantId);
  const facingsByLevel = {};
  const skuLevels = {};
  for (const bay of BAYS) {
    for (const lvl of SHELF_LEVELS) {
      for (let i = 0; i < SLOTS_PER_LEVEL; i++) {
        const sku = v.planogram[S.slotId(bay.id, lvl.id, i)];
        if (!sku) continue;
        facingsByLevel[lvl.id] = (facingsByLevel[lvl.id] || 0) + 1;
        (skuLevels[sku] ||= {})[lvl.id] = (skuLevels[sku][lvl.id] || 0) + 1;
      }
    }
  }
  const out = {};
  for (const [sku, levels] of Object.entries(skuLevels)) {
    const total = Object.values(levels).reduce((a, b) => a + b, 0);
    const att = agg.attentionShare[sku] || 0;
    for (const [lvl, count] of Object.entries(levels)) {
      out[lvl] = (out[lvl] || 0) + att * (count / total);
    }
  }
  return { share: normalise(out), facings: facingsByLevel };
}

function fairShare(exp, variantId) {
  const facings = S.facingsOf(exp, variantId);
  return normalise(facings);
}

export function buildInsights(exp, { real, synth, comparison, variantId, other }) {
  const out = [];
  const panel = real.n >= 3 ? real : synth;        // lean on humans once there are enough of them
  const panelName = real.n >= 3 ? 'human shoppers' : 'the synthetic panel';
  const fair = fairShare(exp, variantId);

  /* 1. shelf height */
  const lv = attentionByLevel(exp, variantId, panel);
  if (lv.share.eye && lv.share.low) {
    const ratio = lv.share.eye / Math.max(0.001, lv.share.low);
    const eyeFacings = lv.facings.eye || 0, lowFacings = lv.facings.low || 0;
    if (eyeFacings && lowFacings) {
      const perFacing = (lv.share.eye / eyeFacings) / Math.max(1e-6, lv.share.low / lowFacings);
      out.push({
        severity: perFacing > 1.6 ? 'win' : 'info',
        title: `Eye level earns ${perFacing.toFixed(1)}× the attention of the bottom shelf, facing for facing`,
        body: `Eye level took ${fmtPct(lv.share.eye)} of shelf attention from ${panelName} on ${eyeFacings} facings, the bottom shelf ${fmtPct(lv.share.low)} on ${lowFacings}. Moving a SKU down one band is not a neutral change.`,
        evidence: `eye/bottom raw ratio ${ratio.toFixed(2)}`
      });
    }
  }

  /* 2. retail media — one finding per promoted SKU, however many surfaces carry it */
  const mediaBySku = {};
  for (const banner of S.activeBanners(exp, variantId)) {
    if (!banner.promotedSku) continue;
    (mediaBySku[banner.promotedSku] ||= []).push(banner);
  }
  for (const [sku, surfaces] of Object.entries(mediaBySku)) {
    const banner = {
      id: surfaces.length === 1 ? surfaces[0].id : `${surfaces.length} surfaces`,
      promotedSku: sku
    };
    const p = productById(sku);
    const exposure = surfaces.reduce((s, b) => s + (panel.bannerShare[b.id] || 0), 0);
    const att = panel.attentionShare[sku] || 0;
    const expected = fair[sku] || 0;
    const conv = panel.conversion[sku] || 0;
    const avgConv = averageConversion(panel);

    if (expected > 0 && att > expected * 1.25) {
      const overIndex = att / expected;
      const converts = conv >= avgConv * 0.95;
      out.push({
        severity: converts ? 'win' : 'watch',
        title: converts
          ? `${p.name} converts the attention its media buys`
          : `${p.name} wins attention but loses the decision`,
        body: converts
          ? `On ${banner.id} the SKU pulled ${fmtPct(att)} of shelf attention against a ${fmtPct(expected)} fair share of facings, and closed ${fmtPct(conv)} of the shoppers who looked — at or above the ${fmtPct(avgConv)} store average.`
          : `The creative did its job at the top of the funnel — ${overIndex.toFixed(1)}× fair share of attention — but only ${fmtPct(conv)} of shoppers who looked went on to buy, against a ${fmtPct(avgConv)} store average. The loss is at the shelf, not in the media.`,
        evidence: `banner exposure share ${fmtPct(exposure)}`
      });
    } else if (expected > 0) {
      out.push({
        severity: 'risk',
        title: `The ${banner.id} creative is not moving eyes to ${p.name}`,
        body: `Attention on the SKU (${fmtPct(att)}) sits at or below its ${fmtPct(expected)} share of facings, so the media is not adding anything measurable. Test a different placement or a pack-forward creative before spending more on it.`,
        evidence: `exposure share ${fmtPct(exposure)}`
      });
    }
  }

  /* 3. packaging salience */
  const salienceGap = PRODUCTS
    .map(p => ({ p, over: (panel.attentionShare[p.id] || 0) - (fair[p.id] || 0) }))
    .filter(x => (fair[x.p.id] || 0) > 0)
    .sort((a, b) => b.over - a.over);
  if (salienceGap.length > 2) {
    const best = salienceGap[0], worst = salienceGap[salienceGap.length - 1];
    if (best.over > 0.01) {
      out.push({
        severity: 'info',
        title: `${best.p.name} punches above its space, ${worst.p.name} below it`,
        body: `${best.p.brand} takes ${fmtPct(panel.attentionShare[best.p.id] || 0)} of attention from ${fmtPct(fair[best.p.id] || 0)} of the facings — a pack doing work its space did not buy. ${worst.p.name} does the opposite and is a candidate for a pack refresh or a space cut.`,
        evidence: `salience index ${(best.p.salience).toFixed(2)} vs ${(worst.p.salience).toFixed(2)}`
      });
    }
  }

  /* 4. promotion efficiency */
  const v = S.variant(exp, variantId);
  for (const sku of v.promoSkus || []) {
    const p = productById(sku);
    if (!p) continue;
    const conv = panel.conversion[sku] || 0;
    const reach = panel.reach[sku] || 0;
    if (reach < 0.25) {
      out.push({
        severity: 'risk',
        title: `Only ${fmtPct(reach)} of shoppers ever saw the ${p.name} promotion`,
        body: `A discount nobody reaches is margin given away for nothing. The SKU needs a position change or a feature display before the price is cut again.`,
        evidence: `conversion among those who did see it: ${fmtPct(conv)}`
      });
    }
  }

  /* 5. blind spots */
  const unseen = PRODUCTS.filter(p => (fair[p.id] || 0) > 0 && (panel.reach[p.id] || 0) < 0.12);
  if (unseen.length) {
    out.push({
      severity: 'watch',
      title: `${unseen.length} listed ${unseen.length === 1 ? 'SKU is' : 'SKUs are'} effectively invisible`,
      body: `${unseen.map(p => p.name).join(', ')} held facings but were seen by under 12% of shoppers. That is a range decision hiding as a merchandising problem.`,
      evidence: 'reach threshold 12% of sessions'
    });
  }

  /* 6. A/B read */
  if (other?.real?.n || other?.synth?.n) {
    const movers = PRODUCTS.map(p => ({
      p,
      delta: (panel.attentionShare[p.id] || 0) - ((other.real.n >= 3 ? other.real : other.synth).attentionShare[p.id] || 0)
    })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const top = movers[0];
    if (top && Math.abs(top.delta) > 0.01) {
      out.push({
        severity: top.delta > 0 ? 'win' : 'watch',
        title: `${top.p.name} ${top.delta > 0 ? 'gains' : 'loses'} ${fmtPct(Math.abs(top.delta))} of attention between the two variants`,
        body: `This is the single largest attention shift the layout change produced. Check whether the choice share moved with it before rolling the variant out.`,
        evidence: `variant ${variantId} vs the other cell`
      });
    }
  }

  /* 7. how much to trust the synthetic panel */
  if (comparison) {
    const weakest = [...comparison.components].sort((a, b) => a.value - b.value)[0];
    out.push({
      severity: comparison.fidelity >= 68 ? 'win' : 'watch',
      title: `Synthetic panel fidelity ${comparison.fidelity.toFixed(0)}/100 — ${comparison.grade.label.toLowerCase()}`,
      body: `${comparison.grade.note} The weakest agreement is ${weakest.label.toLowerCase()} at ${(weakest.value * 100).toFixed(0)}%. Fixing that is where extra human sessions pay for themselves.`,
      evidence: `${comparison.n.real} human vs ${comparison.n.synth} synthetic sessions`
    });
    if (comparison.durationRatio && (comparison.durationRatio < 0.6 || comparison.durationRatio > 1.7)) {
      out.push({
        severity: 'watch',
        title: `Synthetic trips run ${comparison.durationRatio > 1 ? 'longer' : 'shorter'} than real ones`,
        body: `Trip length ratio is ${comparison.durationRatio.toFixed(2)}. Attention shares are still comparable because they are normalised, but do not read absolute dwell seconds off the synthetic panel until the pace parameters are re-fitted.`,
        evidence: 'durationRatio outside 0.6–1.7'
      });
    }
  }

  const order = { risk: 0, watch: 1, win: 2, info: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

function averageConversion(agg) {
  const vals = PRODUCTS.map(p => agg.conversion[p.id] || 0).filter(v => v > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

/* Optional: have the model turn the findings into a short client-ready readout. */
export async function narrate(exp, insights, comparison, variantId) {
  const bullets = insights.slice(0, 6).map(i => `- [${i.severity}] ${i.title}. ${i.body}`).join('\n');
  const text = await chat(exp.hf, [
    {
      role: 'system',
      content: 'You write shopper-research readouts for retail clients. Plain language, no hype, no bullet padding. Never invent numbers beyond those given.'
    },
    {
      role: 'user',
      content: `Experiment: ${exp.name}, variant ${variantId}.
Synthetic panel fidelity vs the human panel: ${comparison ? comparison.fidelity.toFixed(0) + '/100' : 'not yet measurable'}.

Findings:
${bullets}

Write a summary of at most 140 words for a category manager: what happened, what to do next, and how far to trust the synthetic panel.`
    }
  ], { maxTokens: 320, temperature: 0.6 });
  return text.trim();
}
