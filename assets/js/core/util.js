/* util.js — deterministic randomness, small stats, formatting. */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function gumbel(rand) {
  const u = Math.max(1e-9, Math.min(1 - 1e-9, rand()));
  return -Math.log(-Math.log(u));
}

export function normal(rand, mean = 0, sd = 1) {
  const u = Math.max(1e-9, rand()), v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function pickWeighted(entries, rand) {
  const total = entries.reduce((s, e) => s + Math.max(0, e[1]), 0);
  if (total <= 0) return entries.length ? entries[0][0] : null;
  let r = rand() * total;
  for (const [key, w] of entries) {
    r -= Math.max(0, w);
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

export function softmax(weights, temperature = 1) {
  const keys = Object.keys(weights);
  const logs = keys.map(k => Math.log(Math.max(1e-6, weights[k])) * temperature);
  const max = Math.max(...logs, -Infinity);
  const exps = logs.map(l => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  const out = {};
  keys.forEach((k, i) => { out[k] = exps[i] / sum; });
  return out;
}

export function normalise(obj) {
  const total = Object.values(obj).reduce((a, b) => a + b, 0);
  const out = {};
  if (total <= 0) { for (const k in obj) out[k] = 0; return out; }
  for (const k in obj) out[k] = obj[k] / total;
  return out;
}

/* ---------- statistics used by the fidelity scoring ---------- */

export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}

export function spearman(a, b) {
  return pearson(rank(a), rank(b));
}

function rank(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const out = new Array(arr.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}

export function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

export function jensenShannon(p, q) {
  const keys = new Set([...Object.keys(p), ...Object.keys(q)]);
  let d = 0;
  for (const k of keys) {
    const pi = p[k] || 0, qi = q[k] || 0, mi = (pi + qi) / 2;
    if (pi > 0) d += 0.5 * pi * Math.log2(pi / mi);
    if (qi > 0) d += 0.5 * qi * Math.log2(qi / mi);
  }
  return Math.max(0, Math.min(1, d));   // base-2 JSD is bounded by 1
}

export function totalVariation(p, q) {
  const keys = new Set([...Object.keys(p), ...Object.keys(q)]);
  let d = 0;
  for (const k of keys) d += Math.abs((p[k] || 0) - (q[k] || 0));
  return d / 2;
}

export function mape(p, q) {
  const keys = [...new Set([...Object.keys(p), ...Object.keys(q)])];
  if (!keys.length) return 0;
  let s = 0, n = 0;
  for (const k of keys) {
    const actual = p[k] || 0;
    if (actual < 0.005) continue;      // ignore near-zero shares, they explode the ratio
    s += Math.abs(actual - (q[k] || 0)) / actual;
    n++;
  }
  return n ? s / n : 0;
}

export function topOverlap(p, q, n = 3) {
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
  const a = new Set(top(p)), b = top(q);
  const hit = b.filter(k => a.has(k)).length;
  return b.length ? hit / b.length : 0;
}

/* Normalised edit distance between two zone-visit sequences. */
export function sequenceSimilarity(a, b) {
  if (!a.length && !b.length) return 1;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return 1 - dp[m][n] / Math.max(m, n, 1);
}

/* ---------- formatting ---------- */

export const fmtMs = ms => ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
export const fmtPct = v => `${(v * 100).toFixed(1)}%`;
export const fmtMoney = v => `$${v.toFixed(2)}`;
export const shortId = () => Math.random().toString(36).slice(2, 9);

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
