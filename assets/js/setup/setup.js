/* setup.js — the planning surface. Edits one variant at a time. */

import {
  PRODUCTS, CATEGORIES, BAYS, FEATURES, SHELF_LEVELS, SLOTS_PER_LEVEL,
  BANNER_MOUNTS, PERSONAS, STORE, ZONES, productById
} from '../core/config.js';
import * as S from '../core/state.js';
import { el, download, fmtMoney } from '../core/util.js';
import { testConnection } from '../ai/hf-client.js';

const exp = S.load();
let activeBay = BAYS[0].id;
let selectedSlot = null;
let selectedProduct = PRODUCTS[0].id;

S.mountNav('index.html');

const $ = id => document.getElementById(id);
const V = () => S.variant(exp, exp.activeVariant);

/* ---------------- header ---------------- */

function renderHeader() {
  $('expName').value = exp.name;
  $('statReal').textContent = S.sessionsOf(exp, 'real').length;
  $('statSynth').textContent = S.sessionsOf(exp, 'synthetic').length;

  $('variantSwitch').innerHTML = '';
  for (const key of Object.keys(exp.variants)) {
    const v = exp.variants[key];
    const b = el('button', {
      'data-on': exp.activeVariant === key ? '1' : '0',
      onclick: () => { exp.activeVariant = key; S.save(exp); renderAll(); }
    });
    b.append(el('b', {}, v.name), el('span', {}, v.note || 'No note'));
    $('variantSwitch').append(b);
  }
}

$('expName').addEventListener('input', e => { exp.name = e.target.value; S.save(exp); });

/* ---------------- shelf editor ---------------- */

function fixtureById(id) {
  return BAYS.find(b => b.id === id) || FEATURES.find(f => f.id === id);
}

function renderBayTabs() {
  const tabs = $('bayTabs');
  tabs.innerHTML = '';
  for (const f of [...BAYS, ...FEATURES]) {
    tabs.append(el('button', {
      'data-on': activeBay === f.id ? '1' : '0',
      onclick: () => { activeBay = f.id; selectedSlot = null; renderShelf(); renderBayTabs(); }
    }, f.label));
  }
}

function slotCell(id) {
  const sku = V().planogram[id];
  const p = sku ? productById(sku) : null;
  const cell = el('div', {
    class: 'slot' + (p ? '' : ' empty'),
    'data-slot': id,
    'data-sel': selectedSlot === id ? '1' : '0',
    onclick: () => {
      if (selectedSlot === id) { assign(id, selectedProduct); }
      else { selectedSlot = id; }
      renderShelf();
      $('slotHint').textContent = selectedSlot
        ? `Selected ${selectedSlot} — click again to drop ${productById(selectedProduct)?.name}.`
        : 'No facing selected.';
    },
    ondragover: e => { e.preventDefault(); cell.classList.add('drag-over'); },
    ondragleave: () => cell.classList.remove('drag-over'),
    ondrop: e => {
      e.preventDefault();
      cell.classList.remove('drag-over');
      assign(id, e.dataTransfer.getData('text/plain'));
      renderShelf();
    }
  });

  if (p) {
    cell.append(
      el('div', { class: 'pack', style: `background:${p.packColor};color:${p.accent}` }, p.brand),
      el('div', { class: 'nm' }, p.name),
      el('button', {
        class: 'small ghost', style: 'align-self:flex-start;padding:2px 8px;font-size:.7rem',
        onclick: e => { e.stopPropagation(); assign(id, null); renderShelf(); }
      }, 'Empty it')
    );
  } else {
    cell.append('Empty facing');
  }
  return cell;
}

function assign(id, sku) {
  V().planogram[id] = sku || null;
  S.save(exp);
  renderPrices();
  renderMap();
}

function renderShelf() {
  const host = $('shelfFace');
  host.innerHTML = '';
  const fix = fixtureById(activeBay);
  const isFeature = !!FEATURES.find(f => f.id === activeBay);

  if (isFeature) {
    host.style.setProperty('--slots', fix.slots);
    const row = el('div', { class: 'shelf-row' });
    row.append(el('div', { class: 'lvl' }, el('b', {}, fix.kind === 'endcap' ? 'Endcap' : 'Island'), 'high traffic'));
    for (let i = 0; i < fix.slots; i++) row.append(slotCell(S.slotId(fix.id, 'eye', i)));
    host.append(row);
  } else {
    host.style.setProperty('--slots', SLOTS_PER_LEVEL);
    for (const lvl of SHELF_LEVELS) {
      const row = el('div', { class: 'shelf-row' });
      row.append(el('div', { class: 'lvl' },
        el('b', {}, lvl.label),
        `${lvl.y.toFixed(2)} m · vis ${lvl.visibility.toFixed(2)}`));
      for (let i = 0; i < SLOTS_PER_LEVEL; i++) row.append(slotCell(S.slotId(fix.id, lvl.id, i)));
      host.append(row);
    }
  }
}

$('clearFace').addEventListener('click', () => {
  const fix = fixtureById(activeBay);
  const isFeature = !!FEATURES.find(f => f.id === activeBay);
  const levels = isFeature ? ['eye'] : SHELF_LEVELS.map(l => l.id);
  const n = isFeature ? fix.slots : SLOTS_PER_LEVEL;
  for (const lv of levels) for (let i = 0; i < n; i++) V().planogram[S.slotId(fix.id, lv, i)] = null;
  S.save(exp); renderShelf(); renderPrices(); renderMap();
});

$('fillFace').addEventListener('click', () => {
  const fix = fixtureById(activeBay);
  const isFeature = !!FEATURES.find(f => f.id === activeBay);
  const levels = isFeature ? ['eye'] : SHELF_LEVELS.map(l => l.id);
  const n = isFeature ? fix.slots : SLOTS_PER_LEVEL;
  for (const lv of levels) for (let i = 0; i < n; i++) V().planogram[S.slotId(fix.id, lv, i)] = selectedProduct;
  S.save(exp); renderShelf(); renderPrices(); renderMap();
});

/* ---------------- palette ---------------- */

function renderPalette() {
  const host = $('palette');
  host.innerHTML = '';
  for (const p of PRODUCTS) {
    const item = el('div', {
      class: 'pal-item',
      draggable: 'true',
      title: `${p.name} — drag onto a facing`,
      ondragstart: e => e.dataTransfer.setData('text/plain', p.id),
      onclick: () => {
        selectedProduct = p.id;
        if (selectedSlot) assign(selectedSlot, p.id);
        renderShelf(); renderPalette();
      }
    });
    item.append(
      el('div', { class: 'sw', style: `background:${p.packColor};border:2px solid ${p.accent}` }),
      el('div', {},
        el('div', { class: 'nm' }, p.name),
        el('div', { class: 'meta' }, `${p.category} · ${fmtMoney(p.price)}${p.privateLabel ? ' · private label' : ''}`)),
      el('div', {}, selectedProduct === p.id ? el('span', { class: 'chip synth' }, 'held') : '')
    );
    host.append(item);
  }
}

/* ---------------- banners ---------------- */

function renderBanners() {
  const host = $('bannerGrid');
  host.innerHTML = '';
  const v = V();
  for (const mount of BANNER_MOUNTS) {
    const b = v.banners[mount.id];
    const card = el('div', { class: 'banner-card' });
    const head = el('header');
    head.append(el('h4', {}, mount.label));
    const sw = el('label', { class: 'switch' });
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!b.enabled;
    cb.addEventListener('change', () => { b.enabled = cb.checked; S.save(exp); renderBanners(); renderMap(); });
    sw.append(cb, el('span', { class: 'tiny' }, b.enabled ? 'live' : 'off'));
    head.append(sw);
    card.append(head);

    card.append(el('div', {
      class: 'banner-preview',
      style: `background:${b.bg};color:${b.fg}`
    }, el('b', {}, b.headline || 'Untitled'), el('span', {}, b.subline || '')));

    const mk = (label, key, type = 'text') => {
      const lab = el('label', { class: 'field' }, el('span', {}, label));
      const input = el('input', { type });
      input.value = b[key] ?? '';
      input.addEventListener('input', () => { b[key] = input.value; S.save(exp); renderBanners(); });
      lab.append(input);
      return lab;
    };
    card.append(mk('Headline', 'headline'), mk('Sub-line', 'subline'));

    const sel = el('select');
    sel.append(el('option', { value: '' }, 'Promotes no specific SKU'));
    for (const p of PRODUCTS) {
      const o = el('option', { value: p.id }, `${p.name} (${p.category})`);
      if (b.promotedSku === p.id) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener('change', () => { b.promotedSku = sel.value || null; S.save(exp); });
    card.append(el('label', { class: 'field' }, el('span', {}, 'Attributed SKU'), sel));

    const colours = el('div', { class: 'row' });
    for (const [label, key] of [['Background', 'bg'], ['Text', 'fg']]) {
      const inp = el('input', { type: 'color', style: 'width:52px;height:34px;padding:2px' });
      inp.value = b[key];
      inp.addEventListener('input', () => { b[key] = inp.value; S.save(exp); renderBanners(); });
      colours.append(el('label', { class: 'tiny muted' }, label), inp);
    }
    card.append(colours);
    host.append(card);
  }
}

/* ---------------- pricing ---------------- */

function renderPrices() {
  const body = $('priceBody');
  body.innerHTML = '';
  const v = V();
  const facings = S.facingsOf(exp, exp.activeVariant);
  for (const p of PRODUCTS) {
    const tr = el('tr');
    tr.append(
      el('td', {}, el('span', { class: 'row', style: 'gap:8px' },
        el('span', { style: `width:14px;height:14px;border-radius:3px;background:${p.packColor};display:inline-block` }),
        p.name)),
      el('td', { class: 'muted' }, p.category),
      el('td', { class: 'num muted' }, fmtMoney(p.price))
    );

    const ov = el('input', { type: 'number', step: '0.1', min: '0', placeholder: p.price.toFixed(2) });
    if (v.priceOverrides[p.id] != null) ov.value = v.priceOverrides[p.id];
    ov.addEventListener('change', () => {
      const val = parseFloat(ov.value);
      if (Number.isFinite(val) && val > 0) v.priceOverrides[p.id] = val;
      else delete v.priceOverrides[p.id];
      S.save(exp); renderPrices();
    });
    tr.append(el('td', { class: 'num' }, ov));

    const promo = el('input', { type: 'checkbox' });
    promo.checked = v.promoSkus.includes(p.id);
    promo.addEventListener('change', () => {
      v.promoSkus = promo.checked
        ? [...new Set([...v.promoSkus, p.id])]
        : v.promoSkus.filter(x => x !== p.id);
      S.save(exp); renderPrices();
    });
    const promoWrap = el('label', { class: 'switch' }, promo,
      el('span', { class: 'tiny' }, promo.checked ? fmtMoney(S.priceOf(exp, exp.activeVariant, p.id)) : ''));
    tr.append(el('td', {}, promoWrap));
    tr.append(el('td', { class: 'num' }, facings[p.id] || 0));
    body.append(tr);
  }
}

/* ---------------- task, mission, budget ---------------- */

function renderTask() {
  $('taskText').value = exp.shopperTask;
  $('budget').value = exp.budget;
  const host = $('missionCats');
  host.innerHTML = '';
  for (const c of CATEGORIES) {
    const on = exp.missionCategories.includes(c);
    host.append(el('button', {
      class: 'small', style: on ? 'border-color:var(--pink);background:rgba(255,79,163,.14)' : '',
      onclick: () => {
        exp.missionCategories = on
          ? exp.missionCategories.filter(x => x !== c)
          : [...exp.missionCategories, c];
        S.save(exp); renderTask();
      }
    }, c));
  }
}
$('taskText').addEventListener('input', e => { exp.shopperTask = e.target.value; S.save(exp); });
$('budget').addEventListener('change', e => { exp.budget = Number(e.target.value) || 0; S.save(exp); });

/* ---------------- personas + model ---------------- */

function renderPersonas() {
  const host = $('personaList');
  host.innerHTML = '';
  for (const p of PERSONAS) {
    const row = el('div', { class: 'persona-row' });
    const n = el('input', { type: 'number', min: '0', max: '60', step: '1' });
    n.value = exp.personaMix[p.id] ?? 0;
    n.addEventListener('change', () => {
      exp.personaMix[p.id] = Math.max(0, Math.min(60, Number(n.value) || 0));
      S.save(exp);
    });
    row.append(
      el('span', { class: 'dot', style: `background:${p.color}` }),
      el('div', {}, el('div', {}, p.name), el('div', { class: 'blurb' }, p.blurb)),
      n
    );
    host.append(row);
  }
}

function renderHf() {
  const hf = exp.hf;
  $('hfEnabled').checked = hf.enabled;
  $('hfModel').value = hf.model;
  $('hfProxy').checked = hf.proxy;
  $('hfToken').value = hf.token || '';
  $('tokenField').style.display = hf.proxy ? 'none' : 'block';
}
for (const [id, key, type] of [['hfEnabled', 'enabled', 'bool'], ['hfModel', 'model', 'text'],
                               ['hfProxy', 'proxy', 'bool'], ['hfToken', 'token', 'text']]) {
  $(id).addEventListener('change', e => {
    exp.hf[key] = type === 'bool' ? e.target.checked : e.target.value;
    S.save(exp); renderHf();
  });
}
$('hfTest').addEventListener('click', async () => {
  const status = $('hfStatus');
  status.textContent = ' checking…';
  status.className = 'tiny muted';
  const res = await testConnection(exp.hf);
  status.textContent = ' ' + res.message;
  status.className = 'tiny ' + (res.ok ? '' : 'muted');
  status.style.color = res.ok ? 'var(--ok)' : 'var(--warn)';
});

/* ---------------- store map ---------------- */

function renderMap() {
  const svg = $('storeMap');
  const W = 520, H = 400, pad = 14;
  const sx = x => pad + ((x + STORE.width / 2) / STORE.width) * (W - pad * 2);
  const sz = z => pad + ((z + STORE.depth / 2) / STORE.depth) * (H - pad * 2);
  const v = V();
  const parts = [`<rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="14" fill="#0d0620" stroke="#34205a"/>`];

  for (const zn of ZONES) {
    parts.push(`<rect x="${sx(zn.x - zn.rx)}" y="${sz(zn.z - zn.rz)}"
      width="${(zn.rx * 2 / STORE.width) * (W - pad * 2)}" height="${(zn.rz * 2 / STORE.depth) * (H - pad * 2)}"
      fill="rgba(155,92,246,.05)" stroke="rgba(155,92,246,.22)" stroke-dasharray="3 4" rx="6"/>`);
  }

  const bayGroups = {};
  for (const b of BAYS) (bayGroups[b.zone] ||= []).push(b);
  for (const [zone, list] of Object.entries(bayGroups)) {
    const b = list[0];
    parts.push(`<rect x="${sx(b.x - 1.3)}" y="${sz(b.z - 3.4)}" width="${(2.6 / STORE.width) * (W - pad * 2)}"
      height="${(6.8 / STORE.depth) * (H - pad * 2)}" rx="4" fill="#2a1848" stroke="#4a2c7a"/>`);
    parts.push(`<text x="${sx(b.x)}" y="${sz(b.z)}" fill="#a292c0" font-size="10" text-anchor="middle">${zone}</text>`);
  }

  for (const f of FEATURES) {
    const sku = v.planogram[S.slotId(f.id, 'eye', 0)];
    const col = sku ? (productById(sku)?.packColor || '#9b5cf6') : '#3a2560';
    parts.push(`<circle cx="${sx(f.x)}" cy="${sz(f.z)}" r="13" fill="${col}" opacity=".85" stroke="#f2e9ff" stroke-width="1"/>`);
    parts.push(`<text x="${sx(f.x)}" y="${sz(f.z) + 26}" fill="#8d7bb0" font-size="9" text-anchor="middle">${f.id}</text>`);
  }

  for (const m of BANNER_MOUNTS) {
    const b = v.banners[m.id];
    if (!b?.enabled) continue;
    parts.push(`<rect x="${sx(m.x) - 18}" y="${sz(m.z) - 5}" width="36" height="10" rx="3" fill="${b.bg}" opacity=".9"/>`);
  }

  parts.push(`<circle cx="${sx(STORE.spawn.x)}" cy="${sz(STORE.spawn.z)}" r="6" fill="#ff4fa3"/>`);
  parts.push(`<text x="${sx(STORE.spawn.x)}" y="${sz(STORE.spawn.z) - 11}" fill="#ffc0dd" font-size="10" text-anchor="middle">you start here</text>`);
  parts.push(`<rect x="${sx(STORE.checkout.x) - 22}" y="${sz(STORE.checkout.z) - 12}" width="44" height="24" rx="5" fill="rgba(86,224,176,.16)" stroke="#56e0b0"/>`);
  parts.push(`<text x="${sx(STORE.checkout.x)}" y="${sz(STORE.checkout.z) + 4}" fill="#56e0b0" font-size="9" text-anchor="middle">checkout</text>`);

  svg.innerHTML = parts.join('');
}

/* ---------------- experiment actions ---------------- */

$('dupVariant').addEventListener('click', () => {
  const from = exp.variants.A, to = exp.variants.B;
  to.planogram = JSON.parse(JSON.stringify(from.planogram));
  to.banners = JSON.parse(JSON.stringify(from.banners));
  to.priceOverrides = { ...from.priceOverrides };
  to.promoSkus = [...from.promoSkus];
  S.save(exp);
  renderAll();
});

$('exportBtn').addEventListener('click', () => {
  download(`shopperlab-${exp.id}.json`, S.exportJson(exp));
});
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    S.importJson(await file.text());
    location.reload();
  } catch (err) {
    alert('That file could not be read as an experiment: ' + err.message);
  }
});
$('resetBtn').addEventListener('click', () => {
  if (confirm('This clears the layout and every recorded session. Continue?')) {
    S.reset();
    location.reload();
  }
});

/* ---------------- boot ---------------- */

function renderAll() {
  renderHeader();
  renderBayTabs();
  renderShelf();
  renderPalette();
  renderBanners();
  renderPrices();
  renderTask();
  renderPersonas();
  renderHf();
  renderMap();
}
renderAll();
