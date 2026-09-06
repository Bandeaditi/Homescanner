# What changed

Ten files. Six are easiest to replace wholesale; three have small edits you can type by hand;
one is brand new. Nothing else in the project was touched.

The `changed-files/` folder mirrors the project structure, so you can copy the whole thing over
your `shopper-lab/` folder and be done. If you'd rather do it by hand, everything is listed below.

---

## New file

**`assets/js/core/images.js`** — did not exist before. Copy it in as-is. It handles reading an
uploaded image, shrinking it to fit inside 1000 × 640 (a 4 MB photo becomes about 60 kB), storing it
in `localStorage` under its own key, and packing images into an export file.

---

## Replace these files wholesale

The edits inside them are too spread out to hand-patch reliably.

| File | Why it changed |
|---|---|
| `assets/js/core/state.js` | Banner data model: creatives live at experiment level, variants only store which creative sits on which spot |
| `assets/js/setup/setup.js` | The whole retail media section was rewritten as drag-and-drop |
| `index.html` | New markup and CSS for the banner library, upload zone and store board |
| `results.html` | Plain English / Everything toggle, verdict panel, reworded headings |
| `assets/js/analytics/dashboard.js` | Verdict generator, plain-language component rows, toggle wiring |

---

## Three small edits you can type by hand

### 1. `assets/js/store/scene.js` — show uploaded artwork in 3D

**Edit A** — after the existing state import near the top (line 10), add one line:

```js
import * as S from '../core/state.js';
import { getImage } from '../core/images.js';        // <- add this
```

**Edit B** — inside `bannerTexture()`, right after `const g = c.getContext('2d');`, insert this
block. It returns early when the banner has an uploaded image, drawing the image so it covers the
surface:

```js
  const uploaded = b.imageId ? getImage(b.imageId) : null;
  if (uploaded) {
    // the artwork is the banner; it is drawn to cover the surface, cropping overflow
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    g.fillStyle = b.bg || '#1a0f2e';
    g.fillRect(0, 0, c.width, c.height);
    const img = new Image();
    img.onload = () => {
      const scale = Math.max(c.width / img.width, c.height / img.height);
      const w = img.width * scale, h = img.height * scale;
      g.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
      tex.needsUpdate = true;
    };
    img.src = uploaded;
    return tex;
  }
```

**Edit C** — in `buildStore()`, in the `/* ---- retail media ---- */` loop, replace the first two
lines of the loop body:

```js
    // before
    const b = variant.banners?.[mount.id];
    if (!b?.enabled) continue;

    // after
    const b = S.bannerAt(exp, variantId, mount.id);
    if (!b) continue;
```

### 2. `assets/js/analytics/metrics.js` — plain-English score labels

In `compare()`, replace the whole `const components = [ ... ];` array with this. Each entry gains a
`plain` line; the statistics move into `detail`, which the report now hides unless you switch to
Everything mode:

```js
  const components = [
    { id: 'attention-corr', label: 'Looked at the same products', value: Math.max(0, attentionCorr), weight: 0.28,
      plain: 'The products that pulled human eyes also pulled AI eyes.',
      detail: `attention share correlation, Pearson r = ${attentionCorr.toFixed(2)} across ${keys.length} SKUs` },
    { id: 'attention-top3', label: 'Agreed on the top three', value: attentionTop3, weight: 0.14,
      plain: 'The three most-looked-at products are the same three.',
      detail: 'top-3 attention overlap' },
    { id: 'attention-jsd', label: 'Split attention the same way', value: 1 - attentionJsd, weight: 0.16,
      plain: 'Not just the winners — the whole spread of attention lines up.',
      detail: `Jensen–Shannon divergence ${attentionJsd.toFixed(3)}` },
    { id: 'purchase-tvd', label: 'Bought the same things', value: 1 - purchaseTvd, weight: 0.22,
      plain: 'What ended up in the basket matches.',
      detail: `share-of-choice, total variation distance ${purchaseTvd.toFixed(3)}` },
    { id: 'zone-jsd', label: 'Spent time in the same places', value: 1 - zoneJsd, weight: 0.10,
      plain: 'Time split across aisles, endcaps and the island matches.',
      detail: `zone dwell, Jensen–Shannon divergence ${zoneJsd.toFixed(3)}` },
    { id: 'sequence', label: 'Walked a similar route', value: seq, weight: 0.10,
      plain: 'They went round the store in roughly the same order.',
      detail: 'normalised edit distance between zone visit orders' }
  ];
```

### 3. `assets/js/analytics/insights.js` — readable banner findings

**Edit A** — line 5, add `BANNER_MOUNTS` to the config import:

```js
import { PRODUCTS, SHELF_LEVELS, SLOTS_PER_LEVEL, BAYS, BANNER_MOUNTS, productById } from '../core/config.js';
```

**Edit B** — in the media loop, replace the `const banner = { ... }` object so findings name the
surface instead of printing a raw id like `cr-a3f9x1`:

```js
    // before
    const banner = {
      id: surfaces.length === 1 ? surfaces[0].id : `${surfaces.length} surfaces`,
      promotedSku: sku
    };

    // after
    const label = surfaces.length === 1
      ? (BANNER_MOUNTS.find(m => m.id === surfaces[0].id)?.label || surfaces[0].id).toLowerCase()
      : `${surfaces.length} media surfaces`;
    const banner = { id: label, promotedSku: sku };
```

**Edit C** — three sentences in that same block read better with the label in front. Find and
replace each:

| Find | Replace with |
|---|---|
| `` title: `The ${banner.id} creative is not moving eyes to ${p.name}`, `` | `` title: `The ${banner.id} is not moving eyes to ${p.name}`, `` |
| `` ? `On ${banner.id} the SKU pulled `` | `` ? `On the ${banner.id} the SKU pulled `` |
| `` : `The creative did its job at the top of the funnel `` | `` : `The creative on the ${banner.id} did its job at the top of the funnel `` |

---

## Not touched

`store.html`, `simulate.html`, `run.py`, `assets/css/theme.css`, `assets/js/core/config.js`,
`assets/js/core/util.js`, `assets/js/store/controls.js`, `assets/js/store/gaze.js`,
`assets/js/store/session.js`, `assets/js/ai/hf-client.js`, `assets/js/ai/sim-engine.js`,
`assets/js/ai/panel.js`.

---

## The data model change, in one paragraph

This is the bit worth understanding before you edit anything, because it explains every other change.

Before, each of the six mounts held its own full banner object: `{ enabled, headline, subline, bg,
fg, promotedSku }`. Editing one banner meant filling in one of six identical forms, which is what was
confusing you, and using the same creative twice meant typing it twice.

Now the artwork lives once in `exp.creatives`, an array of
`{ id, name, imageId, headline, subline, bg, fg, promotedSku }`. Each variant just records which
creative sits on which spot: `variant.banners = { 'entrance-arch': 'cr-nova', 'wall-back': null, ... }`.
`null` means the spot is off. That is what makes drag-and-drop possible — dropping is just writing a
creative id into a slot.

Two helpers in `state.js` do the joining, so nothing downstream had to change much:

- `S.bannerAt(exp, variantId, mountId)` returns the resolved banner for one spot, or `null`
- `S.activeBanners(exp, variantId)` returns all live ones, same shape the old code expected

One trap worth knowing if you retype `bannerAt` yourself: the spread has to come **first**, so the
mount id wins over the creative's own id. Get this backwards and every banner metric in the report
silently keys on the wrong thing:

```js
return creative ? { ...creative, id: mountId, mountId, creativeId: creative.id } : null;
```

Old saved experiments are converted automatically by `upgradeBanners()` in `state.js` — anything you
built in the previous version becomes library items on first load. Nothing is lost.
