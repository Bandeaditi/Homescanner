/* panel.js — drives the synthetic panel run. */

import { PERSONAS, personaById } from '../core/config.js';
import * as S from '../core/state.js';
import { el } from '../core/util.js';
import { runPanel } from './sim-engine.js';

const $ = id => document.getElementById(id);
const exp = S.load();
S.mountNav('simulate.html');

const sel = $('variantSel');
for (const key of Object.keys(exp.variants)) {
  const o = el('option', { value: key }, exp.variants[key].name);
  if (key === exp.activeVariant) o.selected = true;
  sel.append(o);
}
$('useModel').checked = !!exp.hf.enabled;

function refresh() {
  const total = Object.values(exp.personaMix).reduce((a, b) => a + b, 0);
  $('perRun').textContent = total;
  $('storedSynth').textContent = S.sessionsOf(exp, 'synthetic').length;
  $('storedReal').textContent = S.sessionsOf(exp, 'real').length;
  $('panelSummary').textContent =
    `${total} synthetic shoppers per run · ${S.sessionsOf(exp, 'real').length} human sessions on file`;

  $('mix').innerHTML = '';
  for (const p of PERSONAS) {
    const n = exp.personaMix[p.id] || 0;
    $('mix').append(el('div', { class: 'spread tiny' },
      el('span', { class: 'row', style: 'gap:8px' },
        el('span', { style: `width:9px;height:9px;border-radius:50%;background:${p.color};display:inline-block` }),
        p.name),
      el('b', {}, String(n))));
  }
}
refresh();

function log(msg, tone = '') {
  const box = $('log');
  if (box.dataset.fresh !== '1') { box.innerHTML = ''; box.dataset.fresh = '1'; }
  box.prepend(el('div', { class: tone }, msg));
}

let running = false;

async function run(variantId) {
  const useModel = $('useModel').checked;
  if (useModel && !exp.hf.enabled) {
    log('Model is off in setup — running the built-in engine instead.', 'muted');
  }
  const replace = $('replace').checked;
  if (replace) {
    exp.sessions = exp.sessions.filter(s => !(s.kind === 'synthetic' && s.variant === variantId));
    S.save(exp);
  }

  log(`Starting ${exp.variants[variantId].name}…`);
  const { sessions, briefs } = await runPanel(exp, variantId, {
    useModel: useModel && exp.hf.enabled,
    onProgress: (done, total, note) => {
      $('bar').style.width = `${total ? (done / total) * 100 : 0}%`;
      if (note) log(note);
    }
  });

  for (const s of sessions) exp.sessions.push(s);
  S.save(exp);
  renderBriefs(briefs, variantId);
  log(`${sessions.length} synthetic sessions stored for ${exp.variants[variantId].name}.`);
  refresh();
}

function renderBriefs(briefs, variantId) {
  const host = $('briefs');
  const entries = Object.entries(briefs).filter(([, b]) => b && (b.reasoning || b.error));
  if (!entries.length) return;
  host.innerHTML = '';
  for (const [personaId, b] of entries) {
    const p = personaById(personaId);
    const card = el('div', { class: 'brief' });
    card.append(el('h4', {}, el('span', { class: 'dot', style: `background:${p.color}` }), `${p.name} · ${variantId}`));
    if (b.error) {
      card.append(el('p', { class: 'muted' }, `Model call failed: ${b.error}. This persona ran on the built-in engine.`));
    } else {
      card.append(el('p', {}, b.reasoning || '—'));
      const biased = Object.entries(b.attentionBias || {}).sort((x, y) => y[1] - x[1]).slice(0, 3);
      if (biased.length) {
        card.append(el('div', { class: 'row', style: 'margin-top:9px' },
          ...biased.map(([sku, val]) =>
            el('span', { class: 'chip ' + (val >= 0 ? 'synth' : '') }, `${sku} ${val >= 0 ? '+' : ''}${val.toFixed(2)}`))));
      }
    }
    host.append(card);
  }
}

$('runBtn').addEventListener('click', async () => {
  if (running) return;
  running = true;
  $('runBtn').disabled = $('runBoth').disabled = true;
  try { await run(sel.value); }
  catch (err) { log('Run stopped: ' + err.message); }
  finally { running = false; $('runBtn').disabled = $('runBoth').disabled = false; }
});

$('runBoth').addEventListener('click', async () => {
  if (running) return;
  running = true;
  $('runBtn').disabled = $('runBoth').disabled = true;
  try {
    for (const key of Object.keys(exp.variants)) await run(key);
  } catch (err) {
    log('Run stopped: ' + err.message);
  } finally {
    running = false; $('runBtn').disabled = $('runBoth').disabled = false;
  }
});
