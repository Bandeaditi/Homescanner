/* setup.js — the planning surface. Edits one variant at a time. */

import {
  PRODUCTS, CATEGORIES, BAYS, FEATURES, SHELF_LEVELS, SLOTS_PER_LEVEL,
  BANNER_MOUNTS, PERSONAS, STORE, ZONES, productById
} from '../core/config.js';
import * as S from '../core/state.js';
import { el, download, fmtMoney } from '../core/util.js';
import { saveImage, getImage, deleteImage, storageUsedKb } from '../core/images.js';
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

/* ---------------- retail media: drag a banner onto a spot ---------------- */

let draggingCreative = null;   // id being dragged, from the library or off a spot
let editingCreative = null;

function creativeStyle(c) {
  const img = c.imageId ? getImage(c.imageId) : null;
  return img
    ? `background-image:url(${img});color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.85)`
    : `background:linear-gradient(120deg, ${c.bg}, ${shadeHex(c.bg, -30)});color:${c.fg}`;
}

function shadeHex(hex, amt) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (Number.isNaN(n)) return hex;
  const ch = i => Math.max(0, Math.min(255, ((n >> i) & 255) + amt));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function renderCreatives() {
  const host = $('creativeList');
  host.innerHTML = '';
  const used = new Set(Object.values(V().banners || {}).filter(Boolean));

  if (!exp.creatives.length) {
    host.append(el('div', { class: 'empty tiny' }, 'No banners yet. Upload an image or press New banner.'));
  }

  for (const c of exp.creatives) {
    const card = el('div', {
      class: 'creative',
      draggable: 'true',
      'data-active': editingCreative === c.id ? '1' : '0',
      title: 'Drag me onto a spot in the store',
      ondragstart: e => {
        draggingCreative = c.id;
        e.dataTransfer.setData('text/plain', c.id);
        e.dataTransfer.effectAllowed = 'copy';
      },
      ondragend: () => { draggingCreative = null; }
    });

    card.append(el('div', { class: 'thumb', style: creativeStyle(c) },
      el('b', {}, c.headline || c.name || 'Untitled'),
      el('span', {}, c.subline || (c.imageId ? 'image banner' : ''))));

    const foot = el('div', { class: 'foot' });
    foot.append(el('span', {}, used.has(c.id) ? 'in the store' : 'not placed'));
    const btns = el('div', { class: 'row', style: 'gap:4px' });
    btns.append(el('button', {
      class: 'small ghost',
      onclick: () => { editingCreative = editingCreative === c.id ? null : c.id; renderMedia(); }
    }, 'Edit'));
    btns.append(el('button', {
      class: 'small ghost',
      onclick: () => {
        if (!confirm(`Delete "${c.name || c.headline}" and take it off every spot?`)) return;
        if (c.imageId) deleteImage(c.imageId);
        S.removeCreative(exp, c.id);
        if (editingCreative === c.id) editingCreative = null;
        renderMedia(); renderMap();
      }
    }, '×'));
    foot.append(btns);
    card.append(foot);
    host.append(card);
  }
}

/* The spots are positioned the way they sit in the store, entrance at the bottom. */
function renderBoard() {
  const board = $('storeBoard');
  board.innerHTML = '';

  const plan = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  plan.setAttribute('class', 'floorplan');
  plan.setAttribute('viewBox', '0 0 100 100');
  plan.setAttribute('preserveAspectRatio', 'none');
  plan.innerHTML = `
    <rect x="14" y="34" width="10" height="34" rx="2" fill="#241640" stroke="#3a2263" stroke-width=".4"/>
    <rect x="45" y="34" width="10" height="34" rx="2" fill="#241640" stroke="#3a2263" stroke-width=".4"/>
    <rect x="76" y="34" width="10" height="34" rx="2" fill="#241640" stroke="#3a2263" stroke-width=".4"/>
    <text x="50" y="97" fill="#8d7bb0" font-size="3.4" text-anchor="middle">entrance</text>`;
  board.append(plan);

  const pos = {
    'wall-back':     { x: 50, y: 12 },
    'aisle-1-head':  { x: 19, y: 40 },
    'aisle-3-head':  { x: 81, y: 40 },
    'screen-island': { x: 50, y: 56 },
    'floor-decal':   { x: 50, y: 76 },
    'entrance-arch': { x: 50, y: 90 }
  };

  for (const mount of BANNER_MOUNTS) {
    const p = pos[mount.id] || { x: 50, y: 50 };
    const placed = S.bannerAt(exp, exp.activeVariant, mount.id);

    const spot = el('div', {
      class: 'spot' + (placed ? ' filled' : ''),
      style: `left:${p.x}%; top:${p.y}%`,
      draggable: placed ? 'true' : 'false',
      ondragstart: e => {
        if (!placed) return;
        draggingCreative = placed.creativeId;
        e.dataTransfer.setData('text/plain', placed.creativeId);
      },
      ondragover: e => { e.preventDefault(); spot.classList.add('over'); },
      ondragleave: () => spot.classList.remove('over'),
      ondrop: e => {
        e.preventDefault();
        spot.classList.remove('over');
        const id = e.dataTransfer.getData('text/plain') || draggingCreative;
        if (!id) return;
        S.setBanner(exp, exp.activeVariant, mount.id, id);
        renderMedia(); renderMap();
      },
      onclick: () => {
        if (placed) { editingCreative = placed.creativeId; renderMedia(); }
        else if (exp.creatives.length) {
          S.setBanner(exp, exp.activeVariant, mount.id, exp.creatives[0].id);
          renderMedia(); renderMap();
        }
      }
    });

    spot.append(el('div', { class: 'where' }, mount.label));
    if (placed) {
      spot.append(el('div', { class: 'art', style: creativeStyle(placed) },
        placed.headline || placed.name || ''));
      const sku = placed.promotedSku ? productById(placed.promotedSku) : null;
      spot.append(el('div', { class: 'tiny muted' }, sku ? `sells ${sku.name}` : 'no SKU attached'));
      spot.append(el('button', {
        class: 'kill', title: 'Switch this spot off',
        onclick: e => {
          e.stopPropagation();
          S.setBanner(exp, exp.activeVariant, mount.id, null);
          renderMedia(); renderMap();
        }
      }, '×'));
    } else {
      spot.append(el('div', { class: 'tiny muted' }, 'empty — drop a banner here'));
    }
    board.append(spot);
  }

  const live = S.activeBanners(exp, exp.activeVariant).length;
  $('mediaCount').textContent = `${live} of ${BANNER_MOUNTS.length} spots live in ${V().name}`;
}

/* The editor only appears once you pick a banner to change. */
function renderCreativeEditor() {
  const host = $('creativeEditor');
  const c = exp.creatives.find(x => x.id === editingCreative);
  if (!c) { host.hidden = true; host.innerHTML = ''; return; }

  host.hidden = false;
  host.innerHTML = '';
  host.append(el('hr', { class: 'divider' }));
  host.append(el('div', { class: 'spread', style: 'margin-bottom:10px' },
    el('h3', {}, `Editing: ${c.name || c.headline}`),
    el('button', { class: 'small ghost', onclick: () => { editingCreative = null; renderMedia(); } }, 'Done')));

  const grid = el('div', { class: 'grid c2' });

  const preview = el('div', {});
  preview.append(el('div', {
    class: 'banner-preview',
    style: creativeStyle(c) + ';border-radius:10px;padding:16px;min-height:96px;display:flex;flex-direction:column;justify-content:center'
  }, el('b', { style: 'display:block;font-size:1.15rem' }, c.headline || ''), el('span', {}, c.subline || '')));

  const imgRow = el('div', { class: 'row' });
  const upl = el('input', { type: 'file', accept: 'image/*', hidden: 'hidden' });
  upl.addEventListener('change', async () => {
    const file = upl.files?.[0];
    if (!file) return;
    try {
      const saved = await saveImage(file);
      if (c.imageId) deleteImage(c.imageId);
      c.imageId = saved.id;
      S.save(exp);
      renderMedia(); renderMap();
    } catch (err) { alert(err.message); }
  });
  imgRow.append(upl);
  imgRow.append(el('button', { class: 'small', onclick: () => upl.click() },
    c.imageId ? 'Replace image' : 'Use my own image'));
  if (c.imageId) {
    imgRow.append(el('button', {
      class: 'small ghost',
      onclick: () => { deleteImage(c.imageId); c.imageId = null; S.save(exp); renderMedia(); renderMap(); }
    }, 'Remove image'));
  }
  preview.append(imgRow);
  if (c.imageId) {
    preview.append(el('p', { class: 'tiny muted', style: 'margin-top:8px' },
      'Your image is used as the banner artwork in the 3D store. The text below still shows in this editor so you can label it.'));
  }
  grid.append(preview);

  const fields = el('div', {});
  const text = (label, key) => {
    const lab = el('label', { class: 'field' }, el('span', {}, label));
    const input = el('input', { type: 'text' });
    input.value = c[key] ?? '';
    input.addEventListener('input', () => { c[key] = input.value; S.save(exp); renderCreatives(); renderBoard(); });
    input.addEventListener('change', () => renderMedia());
    lab.append(input);
    return lab;
  };
  fields.append(text('Name (just for you)', 'name'), text('Headline', 'headline'), text('Sub-line', 'subline'));

  const sel = el('select');
  sel.append(el('option', { value: '' }, 'Not selling a specific product'));
  for (const p of PRODUCTS) {
    const o = el('option', { value: p.id }, `${p.name} (${p.category})`);
    if (c.promotedSku === p.id) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', () => { c.promotedSku = sel.value || null; S.save(exp); renderMedia(); });
  fields.append(el('label', { class: 'field' },
    el('span', {}, 'Which product does this banner sell?'), sel));
  fields.append(el('p', { class: 'tiny muted' },
    'Gaze time on this banner is credited to that product, which is how the report tells you whether the media did anything.'));

  if (!c.imageId) {
    const colours = el('div', { class: 'row' });
    for (const [label, key] of [['Background', 'bg'], ['Text', 'fg']]) {
      const inp = el('input', { type: 'color', style: 'width:52px;height:34px;padding:2px' });
      inp.value = c[key];
      inp.addEventListener('input', () => { c[key] = inp.value; S.save(exp); renderCreatives(); renderBoard(); });
      inp.addEventListener('change', () => renderMedia());
      colours.append(el('label', { class: 'tiny muted' }, label), inp);
    }
    fields.append(colours);
  }
  grid.append(fields);
  host.append(grid);
}

async function handleFiles(files) {
  for (const file of files) {
    try {
      const saved = await saveImage(file);
      const c = {
        id: 'cr-' + Math.random().toString(36).slice(2, 8),
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 40),
        imageId: saved.id,
        headline: file.name.replace(/\.[^.]+$/, '').slice(0, 24),
        subline: '',
        bg: '#9b5cf6', fg: '#120720',
        promotedSku: null
      };
      S.addCreative(exp, c);
      editingCreative = c.id;
    } catch (err) {
      alert(err.message);
    }
  }
  renderMedia();
}

function wireMedia() {
  $('addCreative').addEventListener('click', () => {
    const c = {
      id: 'cr-' + Math.random().toString(36).slice(2, 8),
      name: 'New banner', imageId: null,
      headline: 'Your headline', subline: 'Your sub-line',
      bg: '#ff4fa3', fg: '#120720', promotedSku: null
    };
    S.addCreative(exp, c);
    editingCreative = c.id;
    renderMedia();
  });

  const zone = $('uploadZone');
  const input = $('bannerFile');
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { handleFiles([...input.files]); input.value = ''; });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('over');
    if (e.dataTransfer.files?.length) handleFiles([...e.dataTransfer.files]);
    else if (draggingCreative) {
      // dragged off a spot and back to the library: take it out of the store
      for (const m of BANNER_MOUNTS) {
        if (V().banners[m.id] === draggingCreative) V().banners[m.id] = null;
      }
      S.save(exp);
      renderMedia(); renderMap();
    }
  });
}

function renderMedia() {
  renderCreatives();
  renderBoard();
  renderCreativeEditor();
  $('storageNote').textContent = `Uploaded artwork is using ${storageUsedKb()} kB of browser storage.`;
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

  for (const b of S.activeBanners(exp, exp.activeVariant)) {
    const m = BANNER_MOUNTS.find(x => x.id === b.id);
    if (!m) continue;
    parts.push(`<rect x="${sx(m.x) - 18}" y="${sz(m.z) - 5}" width="36" height="10" rx="3" fill="${b.imageId ? '#f2e9ff' : b.bg}" opacity=".9"/>`);
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
  renderMedia();
  renderPrices();
  renderTask();
  renderPersonas();
  renderHf();
  renderMap();
}
wireMedia();
renderAll();
