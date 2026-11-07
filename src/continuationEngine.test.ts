import test from "node:test";
import assert from "node:assert/strict";
import { Candle } from "./candleMath";
import { CONTINUATION_DEFAULTS, detectContinuationSignal, explainContinuation, sequenceState } from "./continuationEngine";
import { isSweep } from "./sweepPatterns";

const TF = 300;                                   // five-minute candles
const T0 = 1_762_300_200;                         // multiple of 300
type Row = [number, number, number, number];     // open, high, low, close
const build = (rows: Row[], t0 = T0): Candle[] => rows.map(([o, h, l, c], i) => ({ time: t0 + i * TF, open: o, high: h, low: l, close: c }));
const quiet = (n: number): Row[] => Array.from({ length: n }, (_, i) => [100 + (i % 2) * 0.1, 100.3, 99.8, 100 + ((i + 1) % 2) * 0.1 + 0.05] as Row);

// SELL: P bullish, A bearish sweeper (high 102.6 > 102.2, close 100.9 inside P's body 100.0..102.0), B and C bearish.
const P_BULL: Row = [100.0, 102.2, 99.8, 102.0];
const A_SELL: Row = [101.8, 102.6, 100.8, 100.9];
const B_RED: Row = [100.9, 101.0, 100.1, 100.2];
const C_RED: Row = [100.2, 100.3, 99.4, 99.5];
// BUY: P bearish, A bullish sweeper (low 99.4 < 99.8, close 101.1 inside P's body 100.0..102.0), B and C bullish.
const P_BEAR: Row = [102.0, 102.2, 99.8, 100.0];
const A_BUY: Row = [100.2, 101.2, 99.4, 101.1];
const B_GRN: Row = [101.1, 101.9, 101.0, 101.8];
const C_GRN: Row = [101.8, 102.6, 101.7, 102.5];

const sellSeq = (): Row[] => [P_BULL, A_SELL, B_RED, C_RED];
const buySeq = (): Row[] => [P_BEAR, A_BUY, B_GRN, C_GRN];
const detectLast = (rows: Row[], p = CONTINUATION_DEFAULTS) => { const cs = build([...quiet(6), ...rows]); return detectContinuationSignal(cs, cs.length - 1, p); };

// ------------------------------------------------------------------------------------------ valid setups
test("SELL: bearish sweeper, then two bearish closes -> signal on candle C with the arithmetic of every check", () => {
  const cs = build([...quiet(6), ...sellSeq()]);
  const s = detectContinuationSignal(cs, cs.length - 1)!;
  assert.equal(s.engine, "continuation"); assert.equal(s.side, "SELL");
  assert.equal(s.signalIndex, cs.length - 1); assert.equal(s.signalTime, cs[cs.length - 1].time);
  assert.equal(s.sweptLevel, 102.2); assert.equal(s.entryReference, 99.5);
  assert.deepEqual([s.prior, s.a, s.b, s.c], cs.slice(-4));
  const text = s.reasons.join("\n");
  assert.match(text, /cur\.high 102\.6 > prev\.high 102\.2/);
  assert.match(text, /100 <= cur\.close 100\.9 <= 102/);
  assert.match(text, /B\.close 100\.2 < B\.open 100\.9/);
  assert.match(text, /C\.close 99\.5 < C\.open 100\.2/);
});

test("BUY: bullish sweeper, then two bullish closes -> signal on candle C", () => {
  const cs = build([...quiet(6), ...buySeq()]);
  const s = detectContinuationSignal(cs, cs.length - 1)!;
  assert.equal(s.side, "BUY"); assert.equal(s.sweptLevel, 99.8); assert.equal(s.entryReference, 102.5);
  assert.match(s.reasons.join("\n"), /cur\.low 99\.4 < prev\.low 99\.8/);
});

// ------------------------------------------------------------------------------------------ Candle A must be the original sweep
test("a wick that only TOUCHES the swept extreme is not a sweep", () => {
  const sell = sellSeq(); sell[1] = [101.8, 102.2, 100.8, 100.9];      // high equals prev high
  assert.equal(detectLast(sell), null);
  const buy = buySeq(); buy[1] = [100.2, 101.2, 99.8, 101.1];          // low equals prev low
  assert.equal(detectLast(buy), null);
  const e = sequenceState(build(sell), 1, "SELL", CONTINUATION_DEFAULTS, true);
  assert.equal(e.state, "NO_SWEEP");
  assert.match(e.trace.checks.map((c) => c.detail).join("\n"), /equal = touch only/);
});

test("Candle A must close INSIDE the previous real body (a close through the body is a breakout, not a rejection)", () => {
  const sell = sellSeq(); sell[1] = [101.8, 102.6, 99.5, 99.9];        // closes below P's open 100.0
  assert.equal(detectLast(sell), null);
  const buy = buySeq(); buy[1] = [100.2, 102.4, 99.4, 102.1];         // closes above P's open 102.0
  assert.equal(detectLast(buy), null);
});

test("Candle A may not open beyond the swept level (wick-only sweep); the literal Pattern 1/2 text can be switched on", () => {
  const sell = sellSeq(); sell[1] = [102.5, 102.8, 100.8, 100.9];     // opens above 102.2, closes inside the body
  assert.equal(detectLast(sell), null);
  assert.equal(detectLast(sell, { ...CONTINUATION_DEFAULTS, requireWickOnlySweep: false })?.side, "SELL");
});

test("colours must be right: P bullish + A bearish for SELL, P bearish + A bullish for BUY", () => {
  const a = sellSeq(); a[0] = [102.0, 102.2, 99.8, 100.0];             // P bearish
  assert.equal(detectLast(a), null);
  const b = sellSeq(); b[1] = [100.9, 102.6, 100.8, 101.8];            // A bullish
  assert.equal(detectLast(b), null);
  const doji = sellSeq(); doji[0] = [101.0, 102.2, 99.8, 101.0];       // P doji
  assert.equal(detectLast(doji), null);
  assert.ok(isSweep("SELL", build([P_BULL, A_SELL])[0], build([P_BULL, A_SELL])[1]));
});

// ------------------------------------------------------------------------------------------ confirmation candles
test("B or C closing the other way (or as a doji) INVALIDATES the sequence", () => {
  const bOpp = sellSeq(); bOpp[2] = [100.9, 101.5, 100.7, 101.4];
  assert.equal(detectLast(bOpp), null);
  assert.equal(sequenceState(build(bOpp), 1, "SELL").state, "INVALIDATED");

  const cOpp = sellSeq(); cOpp[3] = [100.2, 101.0, 100.1, 100.9];
  assert.equal(detectLast(cOpp), null);
  assert.equal(sequenceState(build(cOpp), 1, "SELL").state, "INVALIDATED");

  const bDoji = buySeq(); bDoji[2] = [101.1, 101.6, 100.8, 101.1];
  assert.equal(detectLast(bDoji), null);
  assert.equal(sequenceState(build(bDoji), 1, "BUY").state, "INVALIDATED");
});

test("once invalidated a sequence stays dead: a later correct candle cannot revive it", () => {
  const rows = [...quiet(6), P_BULL, A_SELL, [100.9, 101.5, 100.7, 101.4] as Row, B_RED, C_RED];   // B was green, then two reds
  const cs = build(rows);
  const i = cs.length - 1;
  assert.equal(detectContinuationSignal(cs, i), null);                  // A is now 3 candles back, not the (A, B, C) triple
  assert.equal(sequenceState(cs, cs.length - 4, "SELL").state, "INVALIDATED");
});

test("no signal before C closes: the engine reports AWAITING_B / AWAITING_C", () => {
  const rows = [...quiet(6), ...sellSeq()];
  const upToA = build(rows.slice(0, 8)), upToB = build(rows.slice(0, 9)), all = build(rows);
  assert.equal(sequenceState(upToA, 7, "SELL").state, "AWAITING_B");
  assert.equal(sequenceState(upToB, 7, "SELL").state, "AWAITING_C");
  assert.equal(detectContinuationSignal(upToA, upToA.length - 1), null);
  assert.equal(detectContinuationSignal(upToB, upToB.length - 1), null);
  assert.equal(sequenceState(all, 7, "SELL").state, "CONFIRMED");
  assert.ok(detectContinuationSignal(all, all.length - 1));
});

test("unfinished candles are never used", () => {
  const cs = build([...quiet(6), ...sellSeq()]);
  const cForming = cs.map((c, i) => (i === cs.length - 1 ? { ...c, closed: false } : c));
  assert.equal(detectContinuationSignal(cForming, cs.length - 1), null);
  assert.equal(sequenceState(cForming, cs.length - 3, "SELL").state, "AWAITING_C");
  const bForming = cs.map((c, i) => (i === cs.length - 2 ? { ...c, closed: false } : c));
  assert.equal(detectContinuationSignal(bForming, cs.length - 1), null);
  const aForming = cs.map((c, i) => (i === cs.length - 3 ? { ...c, closed: false } : c));
  assert.equal(detectContinuationSignal(aForming, cs.length - 1), null);
});

test("candle timestamp errors void the pattern: missing, duplicated or out-of-order candles", () => {
  const cs = build([...quiet(6), ...sellSeq()]);
  const n = cs.length;
  const gap = cs.map((c, i) => (i === n - 1 ? { ...c, time: c.time + TF } : c));         // a candle is missing before C
  assert.equal(detectContinuationSignal(gap, n - 1), null);
  const dup = cs.map((c, i) => (i === n - 1 ? { ...c, time: cs[n - 2].time } : c));
  assert.equal(detectContinuationSignal(dup, n - 1), null);
  const swapped = cs.map((c, i) => (i === n - 2 ? cs[n - 1] : i === n - 1 ? cs[n - 2] : c));
  assert.equal(detectContinuationSignal(swapped, n - 1), null);
  assert.ok(detectContinuationSignal(gap, n - 1, { ...CONTINUATION_DEFAULTS, requireContiguousTimes: false }), "the check can be switched off");
});

test("invalid OHLC candles are rejected", () => {
  const bad = sellSeq(); bad[3] = [100.2, 100.0, 99.4, 99.5];          // high below open
  assert.equal(detectLast(bad), null);
  const nan = sellSeq(); nan[2] = [100.9, NaN, 100.1, 100.2];
  assert.equal(detectLast(nan), null);
});

test("optional minimum confirmation body ratio is off by default and works when set", () => {
  const rows = sellSeq(); rows[2] = [100.9, 101.5, 99.9, 100.8];       // red but body 0.1 of range 1.6
  assert.ok(detectLast(rows));
  assert.equal(detectLast(rows, { ...CONTINUATION_DEFAULTS, minConfirmBodyRatio: 0.3 }), null);
});

// ------------------------------------------------------------------------------------------ engine properties
test("reads nothing after index i (no look-ahead, no repainting)", () => {
  const rows = [...quiet(6), ...sellSeq(), ...quiet(5)];
  const cs = build(rows);
  const i = 9;
  assert.deepEqual(detectContinuationSignal(cs, i), detectContinuationSignal(cs.slice(0, i + 1), i));
  assert.ok(detectContinuationSignal(cs, i));
});

test("a SELL and a BUY sequence cannot both qualify on the same candle", () => {
  const cs = build([...quiet(6), ...sellSeq()]);
  const ex = explainContinuation(cs, cs.length - 1);
  assert.equal(ex.sell.state, "CONFIRMED"); assert.notEqual(ex.buy.state, "CONFIRMED");
  assert.ok(ex.buy.trace.checks.some((c) => !c.pass), "the failed BUY check is logged with its numbers");
});

test("mirror symmetry: flipping prices turns every SELL signal into the matching BUY signal", () => {
  let a = 12345; const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const cs: Candle[] = []; let p = 100;
  for (let i = 0; i < 6000; i++) { const o = p, c = o + (rnd() - 0.5) * 2, h = Math.max(o, c) + rnd() * 0.8, l = Math.min(o, c) - rnd() * 0.8; cs.push({ time: T0 + i * TF, open: o, high: h, low: l, close: c }); p = c; }
  const mir = cs.map((c) => ({ time: c.time, open: -c.open, high: -c.low, low: -c.high, close: -c.close }));
  let n = 0;
  for (let i = 3; i < cs.length; i++) {
    const x = detectContinuationSignal(cs, i), y = detectContinuationSignal(mir, i);
    assert.equal(!!x, !!y);
    if (x && y) { assert.notEqual(x.side, y.side); n++; }
  }
  assert.ok(n > 20, `random data should contain some setups (${n})`);
});
