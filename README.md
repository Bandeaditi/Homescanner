# ShopperLab

A browser-based virtual store where a real person shops while their gaze is tracked through the
webcam, and a panel of AI shopper personas walks the identical store. The two panels are then scored
against each other to answer the question the brief actually asks: **can a synthetic panel stand in
for people as a measurement instrument?**

No build step, no framework, no account. Python 3 and a browser are enough.

---

## Run it

```bash
cd shopper-lab
python run.py
# open http://localhost:8000
```

`localhost` is a secure context, so the webcam works. Opening `index.html` straight off disk will
not work — ES modules and `getUserMedia` both need the server.

For the optional language-model layer:

```bash
export HF_TOKEN=hf_xxxxxxxx     # fine-grained token with "Make calls to Inference Providers"
python run.py
```

The token stays in the server process. The page calls `/api/hf`, and `run.py` forwards to
`https://router.huggingface.co/v1/chat/completions`. If you would rather paste a token into the page,
turn the proxy off in setup — fine for a demo, not for anything deployed.

Everything except that one layer runs with no API keys at all.

---

## The four screens

**Set up store** (`index.html`) — the planogram editor. Drag a product onto any of the 106 facings,
set prices and promotions, and define the shopper task. Two variants (A and B) hold independent
layouts, so you always have something to test against.

Retail media works as a library plus a board. Drop your own image files into the upload area (or
press *New banner* to write one), then drag a banner from the library onto any of the six spots in
the store diagram — entrance arch, back wall, two aisle headers, the island screen, the floor decal.
A spot with nothing on it is simply off; drag a spot back to the library or press its × to clear it.
Attach a product to each banner and the gaze time it earns is credited to that product, which is how
the report works out whether the media did anything. Uploads are downscaled to about 60 kB and stored
in the browser, and they travel with the experiment when you export it.

**Run a shopper** (`store.html`) — you walk the store in first person. Webcam gaze tracking starts
with a five-dot calibration; after that a pink dot shows where the system thinks you are looking, and
whatever facing that ray lands on accumulates dwell. Walk with `WASD`, pick things up with `E`, pay
at the checkout pad with `F`.

**AI panel** (`simulate.html`) — sends 40 synthetic shoppers per variant through the same fixtures.
With the model switched on, each persona reads the shelf in character first and returns its own
attention bias and reasoning, which you can read on the page.

**Results** (`results.html`) — the comparison. It opens in *Plain English*: a three-sentence verdict at
the top, then a score out of 100 broken into six things anyone can read ("looked at the same
products", "bought the same things"), paired pink/purple charts, banner performance, the A/B
read-out and the findings. Switch to *Everything* for the underlying statistics — correlations,
divergences, path overlays and the cost comparison.

---

## How the measurement works

### Real shoppers

Gaze runs on MediaPipe FaceLandmarker (478 landmarks including irises), loaded from a CDN and
executed in the tab. Two features come out of every frame: head rotation from the facial
transformation matrix, and the iris offset inside each eye socket. A five-point calibration fits a
ridge-regularised linear model from `[1, yaw, pitch, irisX, irisY]` to screen coordinates. That point
becomes a normalised device coordinate, a ray is cast through it into the scene, and whatever it hits
gets the frame's milliseconds.

Shelf backs, side panels, boards, endcap bodies and walls are registered as occluders, so a ray
cannot score attention on a product it could not physically see through a gondola.

Captured per session: dwell per SKU, discrete fixation counts (gaze resting past 120 ms), time to
first fixation, zone dwell, zone visit order, a position sample every 250 ms, gaze time on each media
surface, every inspect / pick-up / put-back, and the final basket.

No video leaves the machine. Only the derived coordinates are kept, in `localStorage`.

### Synthetic shoppers

Five personas — Mission Shopper, Browser, Brand Loyalist, Switcher, Value Seeker — each with a
behavioural parameter vector (exploration, dwell rate, price and promo sensitivity, brand loyalty,
media receptivity, pack sensitivity, impulse, pace, attention focus).

An agent plans a route over the same fixture graph, then at each fixture spends a finite attention
budget across the facings in front of it. The weight of a facing is:

```
visibility(shelf height) × horizontal position × pack salience × promotion
  × brand loyalty match × banner priming × model bias × noise
```

pushed through a softmax whose temperature is the persona's attention focus. Choice is a
random-utility model over the products the agent actually looked at, with a no-buy alternative, so
attention and purchase are linked the way they are in a real trip rather than assigned independently.

Runs are seeded from the experiment id, so the same store gives the same panel twice.

When the Hugging Face layer is on, each persona gets one call before the panel runs: it reads a text
rendering of the shelf and returns `mission_categories`, a per-SKU `attention_bias` in `[-1, 1]`, and
its reasoning. The bias enters as `exp(0.75 × bias)` on the facing weights. The model shapes the
behaviour; it does not replace the engine, so a failed or rate-limited call degrades to the
deterministic path instead of breaking the run.

### Scoring the match

Fidelity is six independent agreements, not one number, because a panel can match attention
beautifully and still get the purchase wrong:

| Component | Weight | What it tests |
|---|---|---|
| Attention share correlation (Pearson) | 28% | Same SKUs win the eye, in the same proportion |
| Top-3 attention overlap | 14% | The winners are the same winners |
| Attention distribution match (1 − Jensen–Shannon) | 16% | The whole shape of attention, not just rank |
| Share-of-choice match (1 − total variation) | 22% | What actually went in the basket |
| Store coverage match (1 − JSD on zone dwell) | 10% | Time split across aisles and features |
| Route similarity (normalised edit distance) | 10% | The order zones were visited in |

The score is banded rather than reported bare: above 82 it is a screening instrument, 68–82 the
ranking is trustworthy but absolute levels are not, 52–68 hypothesis generation only, below that the
panel is not calibrated for this store yet. There is also a lift-agreement read: when the layout
changes, do both panels move the same SKUs in the same direction?

### Insights

Rules over the aggregates, so every claim points at a number: eye-level versus bottom-shelf attention
per facing, media surfaces that buy attention without converting it, packs that over- or under-index
against their share of facings, promotions almost nobody reaches, listed SKUs that are effectively
invisible, the biggest attention mover between variants, and where the synthetic panel is weakest.
With the model on, it rewrites those findings as a short readout — it never invents the numbers.

---

## Against the brief

| Success criterion | Where it lives |
|---|---|
| Functional browser-based virtual store | `store.html`, `assets/js/store/scene.js` — procedural 3D store, 9 fixtures, 106 facings, 6 media surfaces |
| Own banner artwork | Upload in setup, rendered on the 3D surface (`assets/js/core/images.js`) |
| Webcam gaze and engagement | `assets/js/store/gaze.js` — MediaPipe + 5-point calibrated linear model |
| Dwell, interactions, paths, purchases | `assets/js/store/session.js` |
| AI personas navigating autonomously | `assets/js/ai/sim-engine.js` |
| Identical experiments for both panels | Both read the same variant object; `simulate.html` runs the panel on whatever you just walked |
| Benchmark similarity with defined metrics | `assets/js/analytics/metrics.js` |
| Automatic business insight | `assets/js/analytics/insights.js` |
| Time and cost reduction demonstrated | Results page, `studyEconomics()` — assumptions are in the source and meant to be replaced with your own rate card |
| A/B test variants | Two independent variants throughout, with a lift-agreement read |
| Hugging Face models | Persona briefing and the written summary, through the OpenAI-compatible router |
| Sample 3D model | Drop any `.glb` at `assets/models/store.glb` and it loads on top of the procedural store |

---

## Files

```
run.py                        static server + HF proxy
index.html                    setup studio
store.html                    3D store, first person
simulate.html                 AI panel runner
results.html                  comparison dashboard
assets/css/theme.css          design system
assets/js/core/config.js      catalogue, fixtures, zones, media mounts, personas
assets/js/core/state.js       experiment state, variants, session store
assets/js/core/util.js        seeded RNG, statistics, formatting
assets/js/setup/setup.js      planogram editor
assets/js/store/scene.js      3D construction from the planogram
assets/js/store/controls.js   first-person movement and collision
assets/js/store/gaze.js       webcam gaze estimation and calibration
assets/js/store/session.js    recording loop and checkout
assets/js/ai/hf-client.js     Hugging Face chat client
assets/js/ai/sim-engine.js    synthetic shopper engine
assets/js/ai/panel.js         panel runner UI
assets/js/analytics/metrics.js    aggregation and fidelity scoring
assets/js/analytics/insights.js   rule-based findings
assets/js/analytics/dashboard.js  results rendering
```

---

## What this is not, yet

Worth saying plainly, because a measurement tool that oversells itself is worse than none:

- **The synthetic panel is calibrated against nothing until you shop.** Fidelity below about 20 human
  sessions is indicative, not evidence. The honest use of this build is: walk it a dozen times, see
  which component of the score is weakest, and fit the persona parameters against that.
- **Webcam gaze is coarser than an eye tracker.** Expect a few degrees of error, which is fine at
  facing level and not fine at pack-element level. Recalibrate if the shopper moves their head a lot.
- **Behaviour in a virtual store is not behaviour in a real one.** Virtual shopping compresses trip
  length and removes weight, queues, crowding and reach. Treat it as a ranking instrument, not a
  forecast of absolute rates.
- **The persona parameters are priors, not measurements.** They came from plausible shopper
  behaviour, not from your category. Fitting them to observed sessions is the highest-value next step.

## Where it goes next

Fit persona parameters by gradient-free search against recorded human sessions, so the panel improves
every time someone shops. Add a validation holdout so fidelity is reported on sessions the fit never
saw. Move the store description to a served scene graph so the same experiment can run in WebXR and,
later, on a headset with real eye tracking — at which point the gaze module is the only thing that
changes. And export the session schema straight into Brand Lift and CPS pipelines: it is already flat
JSON keyed by SKU, variant and persona.
