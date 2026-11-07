import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Candle, anatomy } from "./candleMath";
import { MOMENTUM_DEFAULTS, MomentumParams, detectMomentumSignal, explainMomentum } from "./momentumEngine";

const TF = 300, T0 = 1_762_300_200;
type Row = [number, number, number, number];     // open, high, low, close
const build = (rows: Row[]): Candle[] => rows.map(([o, h, l, c], i) => ({ time: T0 + i * TF, open: o, high: h, low: l, close: c }));
// 22 quiet candles: bodies alternate 0.15 / 0.05, so the median body of any 20 of them is 0.10 (strong body must be >= 0.12, combined >= 0.30)
const quiet = (n = 22): Row[] => Array.from({ length: n }, (_, i) => [100 + (i % 2) * 0.1, 100.3, 99.8, 100 + ((i + 1) % 2) * 0.1 + 0.05] as Row);

// SELL candles. Each has range 1.0 so ratios are easy to read.
const STRONG_RED = (o: number): Row => [o, o + 0.1, o - 0.9, o - 0.8];     // body 0.8, wicks 0.1 + 0.1 -> body 0.80, wick 0.20
const WEAK_RED = (o: number): Row => [o, o + 0.25, o - 0.75, o - 0.5];     // body 0.5, wicks 0.25 + 0.25 -> body 0.50, wick 0.50
const run = (rows: Row[], p: Partial<MomentumParams> = {}) => {
  const cs = build([...quiet(), ...rows]);
  return detectMomentumSignal(cs, cs.length - 1, { ...MOMENTUM_DEFAULTS, ...p });
};
const mirrorRow = ([o, h, l, c]: Row): Row => [-o, -l, -h, -c];

test("anatomy: body, range, wicks and ratios, and zero-range candles are safe", () => {
  const a = anatomy({ time: 0, open: 100, high: 101, low: 99, close: 100.5 });
  assert.equal(a.body, 0.5); assert.equal(a.range, 2); assert.equal(a.upperWick, 0.5); assert.equal(a.lowerWick, 1);
  assert.equal(a.totalWick, 1.5); assert.equal(a.bodyRatio, 0.25); assert.equal(a.wickRatio, 0.75); assert.equal(a.direction, "bull");
  const z = anatomy({ time: 0, open: 5, high: 5, low: 5, close: 5 });
  assert.equal(z.bodyRatio, 0); assert.equal(z.wickRatio, 0); assert.equal(z.direction, "doji"); assert.ok(Number.isFinite(z.range));
});

// ------------------------------------------------------------------------------------------ qualification
test("three strong bearish candles -> SELL, pattern ALL STRONG, with the metrics recorded", () => {
  const s = run([STRONG_RED(100), STRONG_RED(99.2), STRONG_RED(98.4)])!;
  assert.equal(s.side, "SELL"); assert.equal(s.strongCount, 3); assert.equal(s.patternId, "MOMENTUM_3_OF_3_STRONG");
  assert.ok(Math.abs(s.avgBodyRatio - 0.8) < 1e-9 && Math.abs(s.avgWickRatio - 0.2) < 1e-9);
  assert.ok(Math.abs(s.combinedBody - 2.4) < 1e-9); assert.ok(Math.abs(s.netMove - 2.4) < 1e-9);
  assert.ok(Math.abs(s.medianBody - 0.1) < 1e-9);
  assert.equal(s.candles.length, 3); assert.ok(s.candles.every((c) => c.strong && Math.abs(c.body - 0.8) < 1e-9));
  assert.equal(s.startLevel, 100); assert.ok(Math.abs(s.entryReference - 97.6) < 1e-9);
  assert.match(s.reasons.join("\n"), /body\/range 0\.8 >= 0\.65/);
});

test("three strong bullish candles -> BUY", () => {
  const rows = [STRONG_RED(100), STRONG_RED(99.2), STRONG_RED(98.4)].map(mirrorRow);
  const s = run(rows)!;
  assert.equal(s.side, "BUY"); assert.equal(s.strongCount, 3);
});

test("two strong + one weaker same-direction candle qualifies, whichever position the weaker one has", () => {
  const orders = [
    [WEAK_RED(100), STRONG_RED(99.5), STRONG_RED(98.7)],
    [STRONG_RED(100), WEAK_RED(99.2), STRONG_RED(98.7)],
    [STRONG_RED(100), STRONG_RED(99.2), WEAK_RED(98.4)],
  ];
  for (const rows of orders) {
    const s = run(rows)!;
    assert.ok(s, "should qualify"); assert.equal(s.strongCount, 2); assert.equal(s.patternId, "MOMENTUM_2_OF_3_STRONG"); assert.equal(s.side, "SELL");
    assert.equal(s.candles.filter((c) => !c.strong).length, 1);
  }
});

test("only one strong candle is not enough", () => {
  assert.equal(run([STRONG_RED(100), WEAK_RED(99.2), WEAK_RED(98.7)]), null);
  assert.equal(run([WEAK_RED(100), WEAK_RED(99.5), WEAK_RED(99.0)]), null);
});

test("the remaining candle must not be a doji or a tiny-body rejection candle", () => {
  const doji: Row = [99.2, 100.2, 98.2, 99.2];                       // doji
  assert.equal(run([STRONG_RED(100), doji, STRONG_RED(99.2)]), null);
  const tiny: Row = [99.2, 100.0, 98.4, 99.1];                       // red, body/range = 0.1/1.6 = 0.06: tiny-body rejection candle
  assert.equal(run([STRONG_RED(100), tiny, STRONG_RED(99.1)]), null);
  const e = explainMomentum(build([...quiet(), STRONG_RED(100), tiny, STRONG_RED(99.1)]), 24);
  assert.equal(e.failed, "candle 2 not a doji / tiny-body candle");
});

test("an opposing directional candle rejects the sequence", () => {
  const green: Row = [99.2, 100.2, 99.1, 100.1];
  assert.equal(run([STRONG_RED(100), green, STRONG_RED(100.1)]), null);
  assert.equal(run([green, STRONG_RED(100.1), STRONG_RED(99.3)]), null);
});

test("strength tests: wick-heavy candles, small bodies versus the market median", () => {
  const wicky: Row = [100, 100.4, 99.0, 99.4];                       // body 0.6 of range 1.4 = 0.43, wick 0.57
  assert.equal(run([wicky, wicky, wicky]), null);
  // a market whose recent median body is 3: three bodies of 0.8 are small for it, even though each is 80% of its range
  const big: Row[] = Array.from({ length: 22 }, (_, i) => [100 + i * 3, 103.4 + i * 3, 99.8 + i * 3, 103 + i * 3] as Row);
  const cs = build([...big, STRONG_RED(165), STRONG_RED(164.2), STRONG_RED(163.4)]);
  assert.equal(detectMomentumSignal(cs, cs.length - 1), null);
  const e = explainMomentum(cs, cs.length - 1);
  assert.equal(e.failed, "enough strong candles");
  assert.match(e.trace.checks.map((c) => c.detail).join("\n"), /body 0\.8 < 1\.2 x median 3 = 3\.6/);
});

test("combined body strength: the sum of the three bodies must reach the minimum", () => {
  const rows: Row[] = [STRONG_RED(100), STRONG_RED(99.2), WEAK_RED(98.4)];
  assert.ok(run(rows));
  assert.equal(run(rows, { minCombinedBodyMult: 30 }), null);        // 2.1 < 30 x 0.1
  const e = explainMomentum(build([...quiet(), ...rows]), 24, { ...MOMENTUM_DEFAULTS, minCombinedBodyMult: 30 });
  assert.equal(e.failed, "combined body strength");
});

test("body ratio exactly on the threshold passes (float noise does not decide)", () => {
  const edge = (o: number): Row => [o, o, o - 1, o - 0.65];          // body 0.65 of range 1.0, wick 0.35
  const s = run([edge(100), edge(99.35), edge(98.7)]);
  assert.ok(s); assert.equal(s!.strongCount, 3);
});

// ------------------------------------------------------------------------------------------ parameters are configurable
test("parameters are configurable: minStrong, strong body ratio, median multiple, lookback", () => {
  const two: Row[] = [STRONG_RED(100), STRONG_RED(99.2), WEAK_RED(98.4)];
  assert.ok(run(two));
  assert.equal(run(two, { minStrong: 3 }), null);                    // original "all three strong" variant
  assert.equal(run([STRONG_RED(100), STRONG_RED(99.2), STRONG_RED(98.4)], { strongBodyRatio: 0.9, maxWickRatio: 0.1 }), null);
  assert.equal(run([STRONG_RED(100), STRONG_RED(99.2), STRONG_RED(98.4)], { strongBodyMedianMult: 9 }), null);   // 0.8 < 9 x 0.1
  assert.ok(run([STRONG_RED(100), STRONG_RED(99.2), STRONG_RED(98.4)], { medianLookback: 10 }));
});

test("body ratio and wick ratio always add up to 1, so 0.65 / 0.35 is one test; a stricter wick limit alone can decide", () => {
  const s = run([STRONG_RED(100), STRONG_RED(99.2), STRONG_RED(98.4)])!;
  assert.ok(s.candles.every((c) => Math.abs(c.bodyRatio + c.wickRatio - 1) < 1e-12));
  assert.equal(run([STRONG_RED(100), STRONG_RED(99.2), STRONG_RED(98.4)], { maxWickRatio: 0.15 }), null);    // wick 0.20 > 0.15
});

test("baseline modes: before the sequence (default) versus before each candle", () => {
  const rows: Row[] = [STRONG_RED(100), STRONG_RED(99.2), STRONG_RED(98.4)];
  const a = run(rows)!, b = run(rows, { baseline: "beforeEachCandle" })!;
  assert.ok(a.candles.every((c) => Math.abs(c.baselineMedian - 0.1) < 1e-9));
  assert.ok(b.candles[2].baselineMedian > a.candles[2].baselineMedian - 1e-12);   // earlier momentum candles lift the later baselines
});

// ------------------------------------------------------------------------------------------ timing and data safety
test("signal appears only when the third candle has closed; nothing while it is forming", () => {
  const cs = build([...quiet(), STRONG_RED(100), STRONG_RED(99.2), STRONG_RED(98.4)]);
  const n = cs.length;
  assert.equal(detectMomentumSignal(cs, n - 2), null);                              // after candle two
  const forming = cs.map((c, i) => (i === n - 1 ? { ...c, closed: false } : c));
  assert.equal(detectMomentumSignal(forming, n - 1), null);
  const s = detectMomentumSignal(cs, n - 1)!;
  assert.equal(s.signalIndex, n - 1); assert.equal(s.signalTime, cs[n - 1].time);
});

test("reads nothing after index i", () => {
  const cs = build([...quiet(), STRONG_RED(100), STRONG_RED(99.2), STRONG_RED(98.4), ...quiet(6)]);
  assert.deepEqual(detectMomentumSignal(cs, 24), detectMomentumSignal(cs.slice(0, 25), 24));
  assert.ok(detectMomentumSignal(cs, 24));
});

test("zero-range candles, flat history and invalid OHLC never throw and never signal", () => {
  const flat: Row = [100, 100, 100, 100];
  assert.equal(run([flat, flat, flat]), null);
  const cs = build([...Array.from({ length: 22 }, () => flat), STRONG_RED(100), STRONG_RED(99.2), STRONG_RED(98.4)]);
  assert.equal(detectMomentumSignal(cs, cs.length - 1), null);                      // median body of the baseline is 0
  assert.equal(explainMomentum(cs, cs.length - 1).failed, "baseline median body is positive");
  assert.equal(run([STRONG_RED(100), [99.2, 99.0, 98.2, 98.4], STRONG_RED(98.4)]), null);   // high below open
});

test("not enough history, missing candle, out-of-order candle", () => {
  const few = build([...quiet(10), STRONG_RED(100), STRONG_RED(99.2), STRONG_RED(98.4)]);
  assert.equal(detectMomentumSignal(few, few.length - 1), null);
  const cs = build([...quiet(), STRONG_RED(100), STRONG_RED(99.2), STRONG_RED(98.4)]);
  const gap = cs.map((c, i) => (i === cs.length - 1 ? { ...c, time: c.time + TF } : c));
  assert.equal(detectMomentumSignal(gap, cs.length - 1), null);
});

// ------------------------------------------------------------------------------------------ independence
test("Engine 6 needs no liquidity sweep and its source imports nothing sweep-related or indicator-related", () => {
  // the three candles below do not sweep anything: each candle's high is below the previous high
  const cs = build([...quiet(), STRONG_RED(100), STRONG_RED(99.2), STRONG_RED(98.4)]);
  const [a, b, c] = cs.slice(-3);
  assert.ok(b.high < a.high && c.high < b.high);
  assert.ok(detectMomentumSignal(cs, cs.length - 1));
  const src = readFileSync(new URL("./momentumEngine.ts", import.meta.url), "utf8");
  const imports = src.split("\n").filter((l) => /^import /.test(l)).join("\n");
  assert.doesNotMatch(imports, /sweep|continuation/i);
  assert.doesNotMatch(src, /\b(rsi|macd|ema|sma|bollinger|stochastic|atr|indicator)\b/i);
});

test("mirror symmetry on random data: flipping prices swaps BUY and SELL and keeps every metric", () => {
  let s0 = 987; const rnd = () => { s0 = (s0 + 0x6d2b79f5) >>> 0; let t = s0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const cs: Candle[] = []; let p = 100, drift = 0;
  for (let i = 0; i < 8000; i++) {
    if (i % 40 === 0) drift = (rnd() - 0.5) * 1.6;                                  // regimes, so streaks of strong candles occur
    const o = p, c = o + drift + (rnd() - 0.5) * 1.2, h = Math.max(o, c) + rnd() * 0.3, l = Math.min(o, c) - rnd() * 0.3;
    cs.push({ time: T0 + i * TF, open: o, high: h, low: l, close: c }); p = c;
  }
  const mir = cs.map((c) => ({ time: c.time, open: -c.open, high: -c.low, low: -c.high, close: -c.close }));
  let n = 0, two = 0, three = 0;
  for (let i = 25; i < cs.length; i++) {
    const x = detectMomentumSignal(cs, i), y = detectMomentumSignal(mir, i);
    assert.equal(!!x, !!y);
    if (x && y) {
      n++; if (x.strongCount === 2) two++; else three++;
      assert.notEqual(x.side, y.side); assert.equal(x.strongCount, y.strongCount);
      assert.ok(Math.abs(x.avgBodyRatio - y.avgBodyRatio) < 1e-9 && Math.abs(x.combinedBody - y.combinedBody) < 1e-9);
    }
  }
  assert.ok(n > 30 && two > 5 && three > 5, `random regimes should give both kinds of setups (${n}: ${two} two-strong, ${three} three-strong)`);
});
