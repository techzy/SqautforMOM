# Squat Coach

A phone web app that watches a barbell back squat from the side and says, out loud, one thing to fix after every rep, plus a short summary after each set. Built for an older lifter: huge text, one main button per screen, slow and loud speech.

## How it works

- **MediaPipe Pose Landmarker** runs on the phone in the browser (`@mediapipe/tasks-vision@1.2.3` from jsDelivr, model from `storage.googleapis.com`). Nothing is uploaded.
- The front camera is used. The phone sits **side-on** to her, with her whole body in frame.
- It tracks up to 3 people per frame and locks onto the biggest person who stands still at the start. Mirror reflections and other gym-goers are ignored.
- After she stands still for about 1.5 s, it says "Ready". A rep is counted when her shoulders (or hips, if the shoulders are hidden) drop past 15% of her standing height and come back up.
- Six checks, using the side of her body nearest the camera:

| Check | Default target | Weight | Cue |
|---|---|---|---|
| Depth | hip level with knee (parallel) | 25 | Go a little lower |
| Back angle | lean ≤ 45° from upright (high-bar) | 20 | Keep your chest up |
| Heels | rise < 10% of foot length | 15 | Keep your heels down |
| Bar path | shoulder within 25% of foot length of mid-foot | 15 | Keep the bar over your mid-foot |
| Tempo | lowering takes ≥ 1.0 s | 15 | Slower on the way down |
| Lockout | hip and knee ≥ 165° at the top | 10 | Stand all the way up |

- **"Good rep"** means the score is ≥ 85 **and** no single check is clearly off (sub-score below 0.5). Otherwise it says the cue for the check that lost the most points.
- If a landmark isn't clearly visible (for example a plate hides the hip), the checks that need it are skipped for that rep. The rep is still counted.
- **Good rep (reference):** in History, tap "Use as my good rep" on a rep, or "Use this set as my good rep" (the median of the set's best 3 reps). Those values replace the default targets. Settings has a button to reset it.
- A set ends when she taps **Set done**.
- Sessions, settings and the good rep are saved in `localStorage`. Settings → Export data saves a JSON backup.

All default targets are starting guesses. Tune them on real recordings (Settings → Advanced).

## Using it on an iPhone

1. Open the site in **Safari**, then Share → **Add to Home Screen**. Otherwise Safari may delete the history after 7 days without a visit.
2. Turn the volume up and the silent switch off.
3. Allow the camera when asked.

## Project layout

| File | What it is |
|---|---|
| `index.html` | The whole app: HTML, CSS and one `<script type="module">`. No build step. The analysis code between `ANALYSIS-START` and `ANALYSIS-END` is pure (no DOM). |
| `test/analysis.test.mjs` | Node tests. They pull the module script out of `index.html` and feed it synthetic side-on skeletons. |
| `package.json` | Only for `npm test`. No dependencies. |
| `.vercelignore` | Keeps tests, `package.json` and this README out of the deployed site. |

## Tests

```bash
npm test
```

You need Node 18 or newer.

## Deploying

A plain static site on Vercel (HTTPS is required for the camera).
