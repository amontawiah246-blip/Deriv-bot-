import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { C, detectContinuation, detectMomentum, detectWickSweep, isFlat } from "./sweepEngines";

const k = (o: number, h: number, l: number, c: number, t = 0): C => ({ time: t, open: o, high: h, low: l, close: c });
const withTimes = (cs: C[]) => cs.map((c, i) => ({ ...c, time: 1000 + i * 60 }));
/** n quiet candles (small bodies), used as history */
const quiet = (n: number, base = 100): C[] => Array.from({ length: n }, (_, i) => k(base + (i % 2) * 0.1, base + 0.3, base - 0.2, base + ((i + 1) % 2) * 0.1 + 0.05));

// ---------------------------------------------------------------- 1. wick sweep == the Python engine
test("wick sweep port gives exactly the Python engine's signals (3 x 1500 candles, ok and blocked)", () => {
  const sets = JSON.parse(readFileSync(new URL("./fixtures/wick_sweep_vectors.json", import.meta.url), "utf8"));
  let total = 0, blocked = 0;
  for (const s of sets) {
    const cs: C[] = s.candles.map((r: number[]) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4] }));
    const got: any[] = [];
    for (let i = 0; i < cs.length; i++) {
      const v = detectWickSweep(cs, i);
      if (v) got.push({ index: i, side: v.side, ok: v.ok, block: v.block, notes: v.notes, swept: v.sweptLevel });
    }
    const want = s.signals.map((x: any) => ({ ...x, notes: [...new Set(x.notes)] }));
    assert.deepEqual(got, want);
    total += got.length; blocked += got.filter((g) => !g.ok).length;
  }
  assert.ok(total > 900 && blocked > 100, `expected plenty of signals, got ${total} (${blocked} blocked)`);
});

test("wick sweep never reads candles after i", () => {
  const sets = JSON.parse(readFileSync(new URL("./fixtures/wick_sweep_vectors.json", import.meta.url), "utf8"));
  const cs: C[] = sets[0].candles.map((r: number[]) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4] }));
  for (const i of [60, 200, 777]) {
    const a = detectWickSweep(cs, i);
    const b = detectWickSweep(cs.slice(0, i + 1), i);
    assert.deepEqual(a, b);
  }
});

test("a sell is NOT a sweep when the sweeper's body closes beyond the swept high", () => {
  const h = quiet(12);
  const sw = k(101, 101.3, 100.5, 100.6);                 // green swept candle (high 101.3)
  const cur = k(101.5, 101.9, 100.9, 100.95);             // red, but its OPEN is above the swept high: body is not inside
  assert.equal(detectWickSweep([...h, sw, cur], h.length + 1), null);
});

// ---------------------------------------------------------------- 2. sweep continuation
const sellSetup = (): C[] => [
  k(100.0, 102.2, 99.8, 102.0),    // prior: green
  k(101.8, 102.6, 100.8, 100.9),   // red sweeper: wick above 102.2, body inside
  k(100.9, 101.0, 100.1, 100.2),   // red confirm 1
  k(100.2, 100.3, 99.4, 99.5),     // red confirm 2
];
const buySetup = (): C[] => [
  k(102.0, 102.2, 99.8, 100.0),    // prior: red
  k(100.2, 101.2, 99.4, 101.1),    // green sweeper: wick below 99.8, body inside
  k(101.1, 101.9, 101.0, 101.8),   // green confirm 1
  k(101.8, 102.6, 101.7, 102.5),   // green confirm 2
];

test("continuation SELL: red sweeper then two red candles -> sell on the next open", () => {
  const cs = withTimes([...quiet(10), ...sellSetup()]);
  const v = detectContinuation(cs, cs.length - 1)!;
  assert.equal(v.engine, "continuation"); assert.equal(v.side, "SELL"); assert.equal(v.ok, true);
  assert.equal(v.tradeAtNextOpen, true); assert.equal(v.sweptLevel, 102.2); assert.equal(v.from, cs.length - 4);
});

test("continuation BUY: green sweeper then two green candles -> buy on the next open", () => {
  const cs = withTimes([...quiet(10), ...buySetup()]);
  const v = detectContinuation(cs, cs.length - 1)!;
  assert.equal(v.side, "BUY"); assert.equal(v.ok, true); assert.equal(v.sweptLevel, 99.8);
});

test("continuation needs BOTH confirm candles in the trade direction", () => {
  const s = sellSetup(); s[3] = k(99.5, 100.4, 99.4, 100.3);  // second confirm turns green
  assert.equal(detectContinuation(withTimes([...quiet(10), ...s]), 13), null);
  const t = sellSetup(); t[2] = k(100.9, 101.0, 100.1, 101.0); // first confirm is a doji, not red
  assert.equal(detectContinuation(withTimes([...quiet(10), ...t]), 13), null);
});

test("continuation needs a real sweep with the body inside", () => {
  const noSweep = sellSetup(); noSweep[1] = k(101.8, 102.1, 100.8, 100.9);        // high 102.1 does not pass 102.2
  assert.equal(detectContinuation(withTimes([...quiet(10), ...noSweep]), 13), null);
  const bodyOut = sellSetup(); bodyOut[1] = k(102.5, 102.8, 100.8, 100.9);        // opens above the swept high
  assert.equal(detectContinuation(withTimes([...quiet(10), ...bodyOut]), 13), null);
});

test("continuation has no fake filter: small-body confirm candles still count while they are clearly red", () => {
  const s = sellSetup();
  s[2] = k(100.9, 101.2, 100.2, 100.6);   // red, body 0.3 of range 1.0
  s[3] = k(100.6, 100.9, 99.9, 100.3);    // red, body 0.3 of range 1.0
  const v = detectContinuation(withTimes([...quiet(10), ...s]), 13)!;
  assert.equal(v.ok, true); assert.equal(v.block, null);
});

// ---------------------------------------------------------------- 3. momentum (Engine 6, body dominance; full rules in momentumEngine.test.ts)
const bigRed = (): C[] => [k(100.0, 100.1, 98.9, 99.0), k(99.0, 99.1, 97.9, 98.0), k(98.0, 98.1, 96.9, 97.0)];
const bigGreen = (): C[] => [k(97.0, 98.1, 96.9, 98.0), k(98.0, 99.1, 97.9, 99.0), k(99.0, 100.1, 98.9, 100.0)];

test("momentum: three strong red candles, no sweep -> SELL on the next open", () => {
  const cs = withTimes([...quiet(22), ...bigRed()]);
  const m = detectMomentum(cs, cs.length - 1);
  assert.equal(m?.side, "SELL"); assert.equal(m?.tradeAtNextOpen, true);
  assert.ok(m!.trace!.length > 5, "the verdict carries the arithmetic of every check");
});

test("momentum: three strong green candles -> BUY", () => {
  const cs = withTimes([...quiet(22), ...bigGreen()]);
  const m = detectMomentum(cs, cs.length - 1);
  assert.equal(m?.side, "BUY");
});

test("momentum needs big bodies: three small-body candles give no signal (this is the definition, not a separate fake rule)", () => {
  const small = [k(100.0, 100.8, 99.2, 99.9), k(99.9, 100.7, 99.1, 99.8), k(99.8, 100.6, 99.0, 99.7)];
  const cs = withTimes([...quiet(22), ...small]);
  assert.equal(detectMomentum(cs, cs.length - 1), null);
});

test("momentum: mixed colours, or bodies not bigger than the market's recent median -> nothing", () => {
  const mixed = [bigRed()[0], bigGreen()[1], bigRed()[2]];
  assert.equal(detectMomentum(withTimes([...quiet(22), ...mixed]), 24), null);
  const bigHistory: C[] = Array.from({ length: 22 }, (_, i) => k(100 + i * 3, 104 + i * 3, 99.8 + i * 3, 103 + i * 3)); // body 3 each
  assert.equal(detectMomentum(withTimes([...bigHistory, ...bigRed()]), 24), null);                                   // new bodies of 1 are small for this market
});

test("flat filler candles are recognised", () => {
  assert.equal(isFlat(k(5, 5, 5, 5)), true);
  assert.equal(isFlat(k(5, 5.1, 5, 5)), false);
});
