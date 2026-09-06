/* dashboard.js — renders the comparison between the two panels. */

import { PRODUCTS, ZONES, STORE, BANNER_MOUNTS, productById } from '../core/config.js';
import * as S from '../core/state.js';
import { el, fmtPct, fmtMoney, download } from '../core/util.js';
import { aggregate, compare, skuTable, liftAgreement, studyEconomics } from './metrics.js';
import { buildInsights, narrate } from './insights.js';

const $ = id => document.getElementById(id);
const exp = S.load();
S.mountNav('results.html');

const sel = $('variantSel');
for (const key of Object.keys(exp.variants)) {
  const o = el('option', { value: key }, exp.variants[key].name);
  if (key === exp.activeVariant) o.selected = true;
  sel.append(o);
}
sel.addEventListener('change', () => { exp.activeVariant = sel.value; S.save(exp); /* ---------- detail level ---------- */

for (const btn of document.querySelectorAll('#detailToggle button')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#detailToggle button').forEach(b => b.classList.toggle('on', b === btn));
    document.body.classList.toggle('simple', btn.dataset.mode === 'simple');
  });
}

render(); });

let state = {};

function render() {
  const variantId = sel.value;
  const realS = S.sessionsOf(exp, 'real', variantId);
  const synthS = S.sessionsOf(exp, 'synthetic', variantId);

  $('expTitle').textContent = exp.name;
  $('subtitle').textContent =
    `${realS.length} human ${realS.length === 1 ? 'session' : 'sessions'} · ${synthS.length} synthetic · ${exp.variants[variantId].name}`;

  if (!realS.length && !synthS.length) {
    $('emptyState').hidden = false;
    $('content').hidden = true;
    return;
  }
  $('emptyState').hidden = true;
  $('content').hidden = false;

  const real = aggregate(realS);
  const synth = aggregate(synthS);
  const comparison = (real.n && synth.n) ? compare(real, synth) : null;

  const otherId = Object.keys(exp.variants).find(k => k !== variantId);
  const other = otherId ? {
    id: otherId,
    real: aggregate(S.sessionsOf(exp, 'real', otherId)),
    synth: aggregate(S.sessionsOf(exp, 'synthetic', otherId))
  } : null;

  state = { variantId, real, synth, comparison, other, realS, synthS };

  renderVerdict(real, synth, comparison, variantId);
  renderFidelity(comparison);
  renderHeadline(real, synth, comparison);
  renderPaired('attentionChart', real.attentionShare, synth.attentionShare);
  renderPaired('purchaseChart', real.purchaseShare, synth.purchaseShare);
  renderZones(real, synth);
  renderPaths(realS, synthS);
  renderMedia(variantId, real, synth);
  renderAb(variantId, real, synth, other);
  renderInsights(variantId, real, synth, comparison, other);
  renderEconomics(realS.length, synthS.length);
}

/* ---------- the short version ----------
   Three sentences, no statistics: what was run, how well the AI matched, what to
   do with that. Everything here is read off the same numbers shown below. */

function renderVerdict(real, synth, comparison, variantId) {
  const name = exp.variants[variantId].name;
  const lines = [];

  lines.push(`<div class="verdict-line"><b>${real.n}</b> real ${real.n === 1 ? 'person' : 'people'} and <b>${synth.n}</b> AI shoppers walked ${name}.</div>`);

  if (!comparison) {
    lines.push(`<div class="verdict-line">There is nothing to compare yet — you need at least one real trip and one AI panel run on the same variant. ${real.n ? 'Run the AI panel next.' : 'Walk the store next.'}</div>`);
    $('verdict').innerHTML = lines.join('');
    return;
  }

  const best = [...comparison.components].sort((a, b) => b.value - a.value)[0];
  const worst = [...comparison.components].sort((a, b) => a.value - b.value)[0];
  lines.push(`<div class="verdict-line">The AI panel matched the real shoppers <b>${comparison.fidelity.toFixed(0)} out of 100</b>. It did best at "${best.label.toLowerCase()}" and worst at "${worst.label.toLowerCase()}".</div>`);

  const rows = skuTable(real, synth);
  const over = rows.filter(r => r.gap > 0.04).sort((a, b) => b.gap - a.gap)[0];
  const under = rows.filter(r => r.gap < -0.04).sort((a, b) => a.gap - b.gap)[0];
  const misses = [];
  if (over) misses.push(`overrates ${over.name}`);
  if (under) misses.push(`underrates ${under.name}`);

  const advice = comparison.fidelity >= 82
    ? 'You can use the AI panel on its own to screen layouts before testing anything with people.'
    : comparison.fidelity >= 68
      ? 'Trust it to rank which layout wins, but do not quote its exact percentages.'
      : comparison.fidelity >= 52
        ? 'Use it to spot ideas worth testing, then confirm the winner with real shoppers.'
        : 'It is not calibrated for this store yet — collect more real trips before relying on it.';

  lines.push(`<div class="verdict-line">${misses.length ? `It ${misses.join(' and ')}. ` : ''}${advice}</div>`);

  if (real.n < 8) {
    lines.push(`<div class="verdict-line muted tiny" style="color:var(--muted)">Only ${real.n} real ${real.n === 1 ? 'session' : 'sessions'} so far, so treat the score as a first read rather than proof. Around 20 gives a stable number.</div>`);
  }

  $('verdict').innerHTML = lines.join('');
}

/* ---------- fidelity dial ---------- */

function renderFidelity(c) {
  const host = $('dial');
  if (!c) {
    host.innerHTML = '<div class="val"><b>—</b><span>needs both panels</span></div>';
    $('gradeLabel').textContent = 'Not comparable yet';
    $('gradeNote').textContent = 'Record at least one human trip and one synthetic run on the same variant.';
    $('components').innerHTML = '';
    return;
  }
  const r = 92, circ = 2 * Math.PI * r;
  const filled = circ * (c.fidelity / 100);
  host.innerHTML = `
    <svg width="210" height="210" viewBox="0 0 210 210">
      <circle cx="105" cy="105" r="${r}" fill="none" stroke="#271449" stroke-width="15"/>
      <circle cx="105" cy="105" r="${r}" fill="none" stroke="url(#g)" stroke-width="15" stroke-linecap="round"
              stroke-dasharray="${filled} ${circ}"/>
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ff4fa3"/><stop offset="100%" stop-color="#9b5cf6"/>
      </linearGradient></defs>
    </svg>
    <div class="val"><b>${c.fidelity.toFixed(0)}</b><span>fidelity out of 100</span></div>`;

  $('gradeLabel').textContent = c.grade.label;
  $('gradeNote').textContent = `${c.grade.note} Based on ${c.n.real} human and ${c.n.synth} synthetic sessions.`;

  $('components').innerHTML = c.components.map(comp => `
    <div class="comp">
      <div>
        <div class="lbl">${comp.label}</div>
        <div class="plain">${comp.plain || ''}</div>
        <div class="det">${comp.detail} · counts for ${(comp.weight * 100).toFixed(0)}% of the score</div>
        <div class="track"><i style="width:${Math.round(comp.value * 100)}%"></i></div>
      </div>
      <div class="num">${(comp.value * 100).toFixed(0)}%</div>
    </div>`).join('');
}

/* ---------- headline stats ---------- */

function renderHeadline(real, synth, c) {
  const cards = [
    ['accent-real', real.n ? `${(real.avgDurationMs / 1000).toFixed(0)}s` : '—', 'Average human trip'],
    ['accent-synth', synth.n ? `${(synth.avgDurationMs / 1000).toFixed(0)}s` : '—', 'Average synthetic trip'],
    ['accent-real', real.n ? real.avgItems.toFixed(1) : '—', 'Items per human basket'],
    ['accent-synth', synth.n ? synth.avgItems.toFixed(1) : '—', 'Items per synthetic basket']
  ];
  $('headline').innerHTML = cards.map(([cls, k, l]) =>
    `<div class="stat ${cls}"><div class="k" style="font-size:1.6rem">${k}</div><div class="l">${l}</div></div>`).join('');
}

/* ---------- paired bars ---------- */

function renderPaired(hostId, realShare, synthShare, limit = 12) {
  const rows = PRODUCTS.map(p => ({
    p,
    r: realShare[p.id] || 0,
    s: synthShare[p.id] || 0
  })).filter(x => x.r > 0.001 || x.s > 0.001)
    .sort((a, b) => (b.r + b.s) - (a.r + a.s))
    .slice(0, limit);

  const max = Math.max(0.02, ...rows.map(x => Math.max(x.r, x.s)));
  const host = $(hostId);
  if (!rows.length) { host.innerHTML = '<p class="muted tiny">Nothing recorded yet.</p>'; return; }

  host.innerHTML = rows.map(x => `
    <div class="paired">
      <div class="name"><i style="background:${x.p.packColor}"></i>${x.p.name}</div>
      <div class="bars">
        <div class="bar real"><i style="width:${(x.r / max) * 100}%"></i></div>
        <div class="bar synth"><i style="width:${(x.s / max) * 100}%"></i></div>
      </div>
      <div class="delta">
        <div style="color:var(--pink)">${fmtPct(x.r)}</div>
        <div style="color:var(--violet)">${fmtPct(x.s)}</div>
      </div>
    </div>`).join('');
}

function renderZones(real, synth) {
  const rows = ZONES.map(z => ({ z, r: real.zoneShare[z.id] || 0, s: synth.zoneShare[z.id] || 0 }))
    .filter(x => x.r > 0.002 || x.s > 0.002)
    .sort((a, b) => (b.r + b.s) - (a.r + a.s));
  const max = Math.max(0.05, ...rows.map(x => Math.max(x.r, x.s)));
  $('zoneChart').innerHTML = rows.map(x => `
    <div class="paired">
      <div class="name">${x.z.label}</div>
      <div class="bars">
        <div class="bar real"><i style="width:${(x.r / max) * 100}%"></i></div>
        <div class="bar synth"><i style="width:${(x.s / max) * 100}%"></i></div>
      </div>
      <div class="delta">
        <div style="color:var(--pink)">${fmtPct(x.r)}</div>
        <div style="color:var(--violet)">${fmtPct(x.s)}</div>
      </div>
    </div>`).join('') || '<p class="muted tiny">No movement recorded.</p>';
}

/* ---------- path overlay ---------- */

function renderPaths(realS, synthS) {
  const W = 520, H = 400, pad = 14;
  const sx = x => pad + ((x + STORE.width / 2) / STORE.width) * (W - pad * 2);
  const sz = z => pad + ((z + STORE.depth / 2) / STORE.depth) * (H - pad * 2);
  const parts = [`<rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="14" fill="#0d0620" stroke="#34205a"/>`];

  for (const zn of ZONES) {
    parts.push(`<rect x="${sx(zn.x - zn.rx)}" y="${sz(zn.z - zn.rz)}"
      width="${(zn.rx * 2 / STORE.width) * (W - pad * 2)}" height="${(zn.rz * 2 / STORE.depth) * (H - pad * 2)}"
      fill="rgba(155,92,246,.045)" stroke="rgba(155,92,246,.18)" rx="6"/>`);
  }

  const drawPath = (s, colour, width, opacity) => {
    const pts = (s.path || []).map(p => `${sx(p.x).toFixed(1)},${sz(p.z).toFixed(1)}`);
    if (pts.length < 2) return;
    parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${colour}" stroke-width="${width}"
      stroke-opacity="${opacity}" stroke-linejoin="round" stroke-linecap="round"/>`);
  };
  for (const s of synthS.slice(0, 40)) drawPath(s, '#9b5cf6', 1.2, 0.28);
  for (const s of realS) drawPath(s, '#ff4fa3', 2, 0.9);

  parts.push(`<circle cx="${sx(STORE.spawn.x)}" cy="${sz(STORE.spawn.z)}" r="5" fill="#f2e9ff"/>`);
  $('pathMap').innerHTML = parts.join('');
}

/* ---------- media ---------- */

function renderMedia(variantId, real, synth) {
  const banners = S.activeBanners(exp, variantId);
  if (!banners.length) {
    $('mediaTable').innerHTML = '<p class="muted tiny">No media surfaces are switched on in this variant.</p>';
    return;
  }
  const rows = banners.map(b => {
    const mount = BANNER_MOUNTS.find(m => m.id === b.id);
    const p = b.promotedSku ? productById(b.promotedSku) : null;
    return `<tr>
      <td>${mount?.label || b.id}<div class="tiny muted">${b.headline}</div></td>
      <td>${p ? p.name : '<span class="muted">unattributed</span>'}</td>
      <td class="num" style="color:var(--pink)">${fmtPct(real.bannerShare[b.id] || 0)}</td>
      <td class="num" style="color:var(--violet)">${fmtPct(synth.bannerShare[b.id] || 0)}</td>
      <td class="num">${p ? fmtPct(real.n ? (real.conversion[p.id] || 0) : (synth.conversion[p.id] || 0)) : '—'}</td>
    </tr>`;
  }).join('');
  $('mediaTable').innerHTML = `<table>
    <thead><tr><th>Surface</th><th>Carries</th><th class="num">Real gaze</th><th class="num">Synthetic gaze</th><th class="num">Look→buy</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

/* ---------- A/B ---------- */

function renderAb(variantId, real, synth, other) {
  if (!other || (!other.real.n && !other.synth.n)) {
    $('abBlock').innerHTML = '<p class="muted tiny">Run the other variant to get a comparison.</p>';
    return;
  }
  const panelReal = real.n && other.real.n;
  const rows = PRODUCTS.map(p => {
    const rHere = real.attentionShare[p.id] || 0, rThere = other.real.attentionShare[p.id] || 0;
    const sHere = synth.attentionShare[p.id] || 0, sThere = other.synth.attentionShare[p.id] || 0;
    return { p, rDelta: rHere - rThere, sDelta: sHere - sThere };
  }).sort((a, b) => Math.abs(b.sDelta) - Math.abs(a.sDelta)).slice(0, 8);

  const agreement = panelReal
    ? liftAgreement(other.real, real, other.synth, synth)
    : null;

  const table = `<table>
    <thead><tr><th>SKU</th><th class="num">Real Δ attention</th><th class="num">Synthetic Δ attention</th><th>Agree?</th></tr></thead>
    <tbody>${rows.map(x => {
      const agree = Math.sign(x.rDelta) === Math.sign(x.sDelta) && Math.abs(x.rDelta) > 0.002;
      return `<tr>
        <td>${x.p.name}</td>
        <td class="num" style="color:var(--pink)">${(x.rDelta * 100).toFixed(1)} pts</td>
        <td class="num" style="color:var(--violet)">${(x.sDelta * 100).toFixed(1)} pts</td>
        <td>${panelReal ? (agree ? '<span class="chip">same direction</span>' : '<span class="chip promo">disagrees</span>') : '<span class="muted tiny">no human data</span>'}</td>
      </tr>`;
    }).join('')}</tbody></table>`;

  const head = agreement ? `
    <div class="grid c3 advanced" style="margin-bottom:14px">
      <div class="stat"><div class="k" style="font-size:1.5rem">${fmtPct(agreement.directionalAgreement)}</div><div class="l">Directional agreement on movers</div></div>
      <div class="stat"><div class="k" style="font-size:1.5rem">${agreement.correlation.toFixed(2)}</div><div class="l">Correlation of attention deltas</div></div>
      <div class="stat"><div class="k" style="font-size:1.5rem">${agreement.moved}</div><div class="l">SKUs that actually moved</div></div>
    </div>` : '';

  $('abBlock').innerHTML = head + table;
}

/* ---------- insights ---------- */

function renderInsights(variantId, real, synth, comparison, other) {
  const insights = buildInsights(exp, { real, synth, comparison, variantId, other });
  state.insights = insights;
  $('insights').innerHTML = insights.map(i => `
    <div class="insight ${i.severity}">
      <h3>${i.title}</h3>
      <p>${i.body}</p>
      <span class="chip tiny">${i.evidence}</span>
    </div>`).join('');
}

$('narrateBtn').addEventListener('click', async () => {
  const btn = $('narrateBtn');
  if (!exp.hf.enabled) {
    $('narrative').innerHTML = '<div class="notice">Switch the Hugging Face model on in setup to have it write this summary. The findings below are generated either way.</div>';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Writing…';
  try {
    const text = await narrate(exp, state.insights || [], state.comparison, state.variantId);
    $('narrative').innerHTML = `<div class="notice info">${text.replace(/\n/g, '<br>')}</div>`;
  } catch (err) {
    $('narrative').innerHTML = `<div class="notice">The model call failed: ${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Rewrite the summary';
  }
});

/* ---------- economics ---------- */

function renderEconomics(realN, synthN) {
  const e = studyEconomics(realN, synthN);
  $('economics').innerHTML = `
    <div class="stat"><div class="k" style="font-size:1.5rem">${fmtMoney(e.digitalCost)}</div><div class="l">This study, run digitally</div></div>
    <div class="stat"><div class="k" style="font-size:1.5rem">${e.digitalDays} days</div><div class="l">Elapsed time</div></div>
    <div class="stat accent-real"><div class="k" style="font-size:1.5rem">${fmtPct(e.costSaving)}</div><div class="l">Cost avoided vs $100k physical test</div></div>
    <div class="stat accent-synth"><div class="k" style="font-size:1.5rem">${fmtPct(e.timeSaving)}</div><div class="l">Time avoided vs 10-week study</div></div>`;
}

/* ---------- export ---------- */

$('exportJson').addEventListener('click', () => {
  const rows = exp.sessions.filter(s => s.variant === state.variantId);
  download(`shopperlab-sessions-${state.variantId}.json`, JSON.stringify(rows, null, 2));
});

$('exportCsv').addEventListener('click', () => {
  const rows = skuTable(state.real, state.synth);
  const header = ['sku', 'name', 'brand', 'category',
    'real_attention_share', 'synth_attention_share', 'attention_gap',
    'real_purchase_share', 'synth_purchase_share',
    'real_reach', 'synth_reach', 'real_look_to_buy', 'synth_look_to_buy'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([r.sku, `"${r.name}"`, r.brand, r.category,
      r.realAttention.toFixed(4), r.synthAttention.toFixed(4), r.gap.toFixed(4),
      r.realPurchase.toFixed(4), r.synthPurchase.toFixed(4),
      r.realReach.toFixed(3), r.synthReach.toFixed(3),
      r.realConversion.toFixed(3), r.synthConversion.toFixed(3)].join(','));
  }
  download(`shopperlab-${state.variantId}.csv`, lines.join('\n'), 'text/csv');
});

/* ---------- detail level ---------- */

for (const btn of document.querySelectorAll('#detailToggle button')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#detailToggle button').forEach(b => b.classList.toggle('on', b === btn));
    document.body.classList.toggle('simple', btn.dataset.mode === 'simple');
  });
}

render();
