// Tests for the rep detection, metrics and scoring inside index.html.
// Run with: npm test   (or: node --test)
// No dependencies. The app's <script type="module"> is pulled out of index.html,
// imported under Node (where it skips the browser-only main()), and fed synthetic
// side-on skeletons shaped like MediaPipe Pose output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const js = html.split('<script type="module">')[1].split('</script>')[0];
const tmp = join(mkdtempSync(join(tmpdir(), 'squat-')), 'app.mjs');
writeFileSync(tmp, js);
await import(pathToFileURL(tmp).href);
const { Analyzer, scoreRep, buildReference, summarizeSet } = globalThis.__squat;

const DT = 33; // ~30 fps
const P = (x, y, v = 0.99) => ({ x, y, z: 0, visibility: v });

// Side-on skeleton facing +x, her left side nearest the camera.
// b: thigh angle from vertical (90 = parallel) · c: torso lean from vertical
// drift: shoulder ahead of mid-foot · heel: heel lift · hipVis: hip visibility (plate hiding it)
// scale/ox: shrink and shift the whole person (for a second person or a reflection)
const Ls = 0.22, Lt = 0.22, Lb = 0.30;
function pose({ b = 0, c = 0, drift = 0, heel = 0, hipVis = 0.99 } = {}, { scale = 1, ox = 0, noise = 0.002 } = {}) {
  const n = () => (Math.random() - 0.5) * noise, rad = d => d * Math.PI / 180;
  const ank = { x: 0.5, y: 0.85 - heel * 0.75 };
  const heelP = { x: 0.47, y: 0.87 - heel }, toe = { x: 0.59, y: 0.87 }, mid = 0.53;
  const sinA = Math.max(-1, Math.min(1, (drift + (mid - ank.x) + Lt * Math.sin(rad(b)) - Lb * Math.sin(rad(c))) / Ls));
  const a = Math.asin(sinA);
  const knee = { x: ank.x + Ls * Math.sin(a), y: ank.y - Ls * Math.cos(a) };
  const hip = { x: knee.x - Lt * Math.sin(rad(b)), y: knee.y - Lt * Math.cos(rad(b)) };
  const sh = { x: hip.x + Lb * Math.sin(rad(c)), y: hip.y - Lb * Math.cos(rad(c)) };
  const head = { x: sh.x + 0.03, y: sh.y - 0.1 };
  const T = (p, v = 0.99) => P(0.5 + ox + (p.x - 0.5) * scale + n(), 0.85 + (p.y - 0.85) * scale + n(), v);
  const lm = Array.from({ length: 33 }, () => T(head));
  const put = (l, r, p, v = 0.99) => { lm[l] = T(p, v); lm[r] = T({ x: p.x - 0.01, y: p.y }, v * 0.6); };
  put(11, 12, sh); put(13, 14, { x: sh.x + 0.05, y: sh.y + 0.08 }); put(15, 16, { x: sh.x + 0.02, y: sh.y });
  put(23, 24, hip, hipVis); put(25, 26, knee); put(27, 28, ank); put(29, 30, heelP); put(31, 32, toe);
  return lm;
}

const STAND = { b: 0, c: 0, drift: 0, heel: 0 };
const GOOD = { bottom: { b: 95, c: 25 }, downFrames: 45, upFrames: 30 };
const lerp = (A, B, k) => Object.fromEntries(Object.keys({ ...A, ...B }).map(key => [key, (A[key] ?? 0) + ((B[key] ?? 0) - (A[key] ?? 0)) * k]));

// Calibrate standing, then do each rep: lower → brief pause → stand (or partly stand) → rest.
// extra(i, p) can add more people to the frame.
function simulate(reps, { opts = {}, extra = null, gapFrames = 0 } = {}) {
  const A = new Analyzer(opts); const events = []; let t = 0, i = 0;
  const step = (p, hide = false) => {
    const her = hide ? [] : [pose(p)];
    const poses = extra ? [...her, ...extra(i, p)] : her;
    events.push(...A.push(poses, t)); t += DT; i++;
  };
  for (let k = 0; k < 70; k++) step(STAND);
  for (const R of reps) {
    const bottom = { ...STAND, ...R.bottom }, top = { ...STAND, ...(R.top || {}) }, vis = { hipVis: R.hipVis ?? 0.99 };
    for (let k = 1; k <= R.downFrames; k++) step({ ...lerp(STAND, bottom, k / R.downFrames), ...vis });
    for (let k = 0; k < 3; k++) step({ ...bottom, ...vis });
    for (let k = 1; k <= R.upFrames; k++) step({ ...lerp(bottom, top, k / R.upFrames), ...vis });
    for (let k = 0; k < 40; k++) step({ ...top, ...vis });
    for (let k = 0; k < 20; k++) step({ ...STAND, ...vis });
    for (let k = 0; k < gapFrames; k++) step(STAND, true);
  }
  return events;
}
const repsOf = ev => ev.filter(e => e.type === 'rep');
const cueOf = (R, ref = null) => scoreRep(repsOf(simulate([R]))[0].metrics, ref).cue;

test('calibrates after standing still', () => {
  const ev = simulate([]);
  assert.deepEqual(ev.map(e => e.type), ['calibrated']);
  assert.equal(ev[0].side, 'left');
});

test('does not calibrate while bouncing', () => {
  const A = new Analyzer(); let calibrated = false;
  for (let i = 0; i < 200; i++) if (A.push([pose({ b: 30 + 30 * Math.sin(i / 3), c: 10 })], i * DT).length) calibrated = true;
  assert.equal(calibrated, false);
});

test('counts one rep per squat', () => {
  assert.equal(repsOf(simulate([GOOD, GOOD, GOOD])).length, 3);
});

test('measures a good rep roughly correctly', () => {
  const m = repsOf(simulate([GOOD]))[0].metrics;
  assert.ok(m.depth > 0 && m.depth < 0.2, `depth ${m.depth}`);
  assert.ok(Math.abs(m.backAngle - 25) < 3, `backAngle ${m.backAngle}`);
  assert.ok(m.heelRise < 0.05, `heelRise ${m.heelRise}`);
  assert.ok(m.barDrift < 0.1, `barDrift ${m.barDrift}`);
  assert.ok(Math.abs(m.descentMs - 45 * DT) < 250, `descentMs ${m.descentMs}`);
  assert.ok(m.lockout > 165, `lockout ${m.lockout}`);
});

test('a clean rep gets "Good rep"', () => {
  assert.equal(cueOf(GOOD), 'Good rep');
});

test('each fault gets its own cue', () => {
  assert.equal(cueOf({ ...GOOD, bottom: { b: 60, c: 15 } }), 'Go a little lower', 'shallow');
  assert.equal(cueOf({ ...GOOD, bottom: { b: 95, c: 62 } }), 'Keep your chest up', 'leaning');
  assert.equal(cueOf({ ...GOOD, bottom: { b: 95, c: 25, heel: 0.03 } }), 'Keep your heels down', 'heels up');
  assert.equal(cueOf({ ...GOOD, bottom: { b: 95, c: 25, drift: 0.06 } }), 'Keep the bar over your mid-foot', 'bar drift');
  assert.equal(cueOf({ ...GOOD, downFrames: 12 }), 'Slower on the way down', 'fast descent');
  assert.equal(cueOf({ ...GOOD, top: { b: 25, c: 10 } }), 'Stand all the way up', 'no lockout');
});

test('a rep with the hip hidden is counted and gets no depth cue', () => {
  const reps = repsOf(simulate([{ ...GOOD, bottom: { b: 60, c: 15 }, hipVis: 0.1 }]));
  assert.equal(reps.length, 1);
  assert.equal(reps[0].metrics.depth, null);
  assert.equal(reps[0].metrics.backAngle, null);
  const sc = scoreRep(reps[0].metrics, null);
  assert.notEqual(sc.cue, 'Go a little lower');
  assert.equal(sc.parts.depth, undefined);
});

test('a second, smaller person squatting does not change the rep count', () => {
  const other = (i, p) => [pose({ b: 50 + 45 * Math.sin(i / 8), c: 20 }, { scale: 0.6, ox: -0.3 })];
  assert.equal(repsOf(simulate([GOOD, GOOD], { extra: other })).length, 2);
});

test('a mirror reflection behind her does not change the rep count', () => {
  // Reflection: same movement, smaller (further away), and a few frames late.
  const lag = [];
  const mirror = (i, p) => { lag.push(p); return [pose(lag[Math.max(0, lag.length - 8)], { scale: 0.7, ox: 0.25 })]; };
  assert.equal(repsOf(simulate([GOOD, GOOD, GOOD], { extra: mirror })).length, 3);
});

test('losing her says "I can\'t see you" once, and counting resumes when she is back', () => {
  const ev = simulate([GOOD, GOOD], { gapFrames: 90 }); // ~3 s out of view after each rep
  assert.equal(ev.filter(e => e.type === 'lost').length, 2);
  assert.equal(ev.filter(e => e.type === 'found').length, 1);
  assert.equal(repsOf(ev).length, 2);
});

test('a rep held longer than maxRepMs is discarded', () => {
  const ev = simulate([{ ...GOOD, downFrames: 200 }], { opts: { maxRepMs: 4000 } });
  assert.ok(ev.some(e => e.type === 'discard'));
  assert.equal(repsOf(ev).length, 0);
});

test('a reference replaces the default targets', () => {
  const good = repsOf(simulate([GOOD]))[0].metrics;
  const ref = buildReference([good, good]);
  const slightlyHigh = repsOf(simulate([{ ...GOOD, bottom: { b: 85, c: 25 } }]))[0].metrics;
  assert.equal(scoreRep(slightlyHigh, null).cue, 'Good rep', 'default (parallel-ish) is fine with it');
  assert.equal(scoreRep(slightlyHigh, { ...ref, depth: 0.35 }).cue, 'Go a little lower', 'deeper reference flags it');
});

test('"Good rep" needs no clear fault even when the score is high', () => {
  const sc = scoreRep({ depth: 0.1, backAngle: 25, heelRise: 0, barDrift: 0, descentMs: 1500, lockout: 140 }, null);
  assert.ok(sc.score >= 85, `score ${sc.score}`);
  assert.equal(sc.cue, 'Stand all the way up');
});

test('set summary: count, score, most common fix and one thing done well', () => {
  const metrics = repsOf(simulate([GOOD, { ...GOOD, bottom: { b: 95, c: 25, heel: 0.03 } }, { ...GOOD, bottom: { b: 95, c: 25, heel: 0.03 } }]))
    .map(e => e.metrics);
  const reps = metrics.map(m => ({ ...scoreRep(m, null) }));
  const s = summarizeSet(reps);
  assert.equal(s.n, 3);
  assert.equal(s.workOn.cue, 'Keep your heels down');
  assert.ok(s.didWell, 'has something done well');
  assert.match(s.speech, /^Set done\. 3 reps\. Score \d+\. .+\. Work on: keep your heels down\.$/);
  assert.equal(summarizeSet([]).speech, 'Set done. No reps counted.');
});
