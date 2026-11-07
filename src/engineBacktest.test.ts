import test from "node:test";
import assert from "node:assert/strict";
import { Candle } from "./candleMath";
import { BACKTEST_DEFAULTS, StrategyDef, TraceRecord, cleanCandles, defaultStrategies, normalCdf, renderReport, runBacktest, sessionOf, summarize, twoProportionZ, wilson, Trade } from "./engineBacktest";
import { synthCandles } from "./syntheticData";
import { parseCsv } from "./engineBacktestCli";

const TF = 300, T0 = 1_762_300_200;
const flatSeries = (n: number, f: (i: number) => [number, number, number, number], t0 = T0): Candle[] => Array.from({ length: n }, (_, i) => { const [o, h, l, c] = f(i); return { time: t0 + i * TF, open: o, high: h, low: l, close: c }; });
/** a strategy that fires on the listed candle indexes */
const fireAt = (id: string, side: "BUY" | "SELL", idx: number[]): StrategyDef => ({ id, label: id, group: "engine5", detect: (_cs, i) => (idx.includes(i) ? { side } : null) });
const trade = (pnl: number, entryTime: number, result: Trade["result"] = pnl > 0 ? "win" : "loss"): Trade => ({ strategy: "x", symbol: "S", side: "BUY", signalIndex: 0, entryIndex: 1, exitIndex: 1, signalTime: entryTime - TF, entryTime, expiry: TF, entry: 1, exit: 1, result, pnl, session: "Asia", segment: "train", conflict: false });

// ------------------------------------------------------------------------------------------ trade mechanics
test("entry is the NEXT candle's open; settlement is the close of the candle that ends at entry + expiry", () => {
  // candle i: open 100 -> close 101 (signal candle); candle 41 opens 105 (a gap, to prove the entry is the open, not the signal close); 41 closes 106; 42 closes 104
  const cs = flatSeries(60, (i) => (i === 41 ? [105, 107, 104, 106] : i === 42 ? [106, 106.5, 103, 104] : [100, 101, 99, 100.5]));
  const { trades } = runBacktest([{ symbol: "S", candles: cs }], { expiries: [300, 600], strategies: [fireAt("b", "BUY", [40]), fireAt("s", "SELL", [40])] });
  const get = (id: string, e: number) => trades.find((t) => t.strategy === id && t.expiry === e)!;
  const b1 = get("b", 300), b2 = get("b", 600), s2 = get("s", 600);
  assert.equal(b1.entryIndex, 41); assert.equal(b1.signalIndex, 40); assert.equal(b1.entry, 105); assert.equal(b1.exit, 106); assert.equal(b1.exitIndex, 41); assert.equal(b1.result, "win");
  assert.equal(b2.exitIndex, 42); assert.equal(b2.exit, 104); assert.equal(b2.result, "loss");          // 104 < 105: BUY loses
  assert.equal(s2.result, "win");
  assert.ok(Math.abs(b1.pnl - 0.92) < 1e-12 && b2.pnl === -1);
});

test("ties return the stake; cost is deducted from every trade", () => {
  const cs = flatSeries(50, (i) => (i === 41 ? [100, 101, 99, 100] : [100, 101, 99, 100.5]));          // candle 41 closes exactly at its open
  const { trades } = runBacktest([{ symbol: "S", candles: cs }], { expiries: [300], costPerTrade: 0.02, strategies: [fireAt("b", "BUY", [40, 30])] });
  const tie = trades.find((t) => t.signalIndex === 40)!, win = trades.find((t) => t.signalIndex === 30)!;
  assert.equal(tie.result, "tie"); assert.ok(Math.abs(tie.pnl - -0.02) < 1e-12);
  assert.equal(win.result, "win"); assert.ok(Math.abs(win.pnl - (0.92 - 0.02)) < 1e-12);
});

test("expiry must be a whole number of candles", () => {
  assert.throws(() => runBacktest([{ symbol: "S", candles: flatSeries(80, () => [100, 101, 99, 100.5]) }], { expiries: [450] }), /multiple/);
  assert.throws(() => runBacktest([{ symbol: "S", candles: flatSeries(80, () => [100, 101, 99, 100.5]) }], { expiries: [100] }), /multiple/);
});

test("duplicate-entry protection: one open trade per strategy, instrument and expiry", () => {
  const cs = flatSeries(100, () => [100, 101, 99, 100.5]);
  const every = Array.from({ length: 60 }, (_, i) => 30 + i);
  const { trades, report } = runBacktest([{ symbol: "S", candles: cs }], { expiries: [300, 900], strategies: [fireAt("b", "BUY", every)] });
  const one = trades.filter((t) => t.expiry === 300), three = trades.filter((t) => t.expiry === 900).sort((a, b) => a.entryIndex - b.entryIndex);
  assert.equal(one.length, 60);                                              // each 1-candle trade has settled before the next entry
  for (let k = 1; k < three.length; k++) assert.ok(three[k].entryIndex > three[k - 1].exitIndex, "no overlapping trades");
  assert.equal(three.length, 20);
  assert.equal(report.strategies[0].byExpiry[900].skippedOverlap, 40);
});

test("a missing candle between entry and settlement voids the trade; so does running off the end of the data", () => {
  const cs = flatSeries(60, () => [100, 101, 99, 100.5]).filter((c) => c.time !== T0 + 42 * TF);     // candle 42 is missing
  const { trades, report } = runBacktest([{ symbol: "S", candles: cs }], { expiries: [600], strategies: [fireAt("b", "BUY", [40, 56])] });
  assert.equal(trades.filter((t) => t.signalTime === T0 + 40 * TF).length, 0);
  assert.ok(report.strategies[0].byExpiry[600].skippedIncomplete >= 1);
  const end = runBacktest([{ symbol: "S", candles: flatSeries(60, () => [100, 101, 99, 100.5]) }], { expiries: [600], strategies: [fireAt("b", "BUY", [58])] });
  assert.equal(end.trades.length, 0);
});

// ------------------------------------------------------------------------------------------ look-ahead
test("no strategy reads past its signal candle: signals on the full series equal signals on the truncated series", () => {
  const cs = synthCandles({ n: 4000, seed: 77, persistence: 0.1 });
  let checked = 0, fired = 0;
  for (const s of defaultStrategies()) {
    for (let i = 30; i < cs.length - 1; i += 3) {
      const full = s.detect(cs, i), cut = s.detect(cs.slice(0, i + 1), i);
      assert.deepEqual(full, cut, `${s.id} at ${i}`);
      checked++; if (full) fired++;
    }
  }
  assert.ok(fired > 300, `the check should include many real signals (${fired} of ${checked})`);
});

test("changing candles after a trade settles cannot change that trade or any earlier signal", () => {
  const cs = synthCandles({ n: 3000, seed: 5, persistence: 0.1 });
  const a = runBacktest([{ symbol: "S", candles: cs }], { expiries: [300] });
  const tampered = cs.map((c, i) => (i >= 2500 ? { ...c, open: c.open * 1.1, high: c.high * 1.2, low: c.low * 0.9, close: c.close * 0.95 } : c));
  const b = runBacktest([{ symbol: "S", candles: tampered }], { expiries: [300] });
  const early = (ts: Trade[]) => ts.filter((t) => t.exitIndex < 2490).map((t) => `${t.strategy}|${t.entryIndex}|${t.side}|${t.result}`);
  assert.deepEqual(early(a.trades), early(b.trades));
  assert.ok(early(a.trades).length > 500);
});

// ------------------------------------------------------------------------------------------ segments
test("chronological split: train, then validation, then test; boundary-crossing trades are embargoed", () => {
  const cs = synthCandles({ n: 5000, seed: 3 });
  const straddlers = fireAt("edge", "BUY", [2998, 3998, 2500, 3500, 4500]);          // entries at 2999 / 3999 settle after the boundary (3 candles)
  const { trades } = runBacktest([{ symbol: "S", candles: cs }], { expiries: [900], strategies: [...defaultStrategies(), straddlers] });
  const trainEnd = 3000, valEnd = 4000;
  for (const t of trades) {
    if (t.segment === "train") assert.ok(t.entryIndex < trainEnd && t.exitIndex < trainEnd);
    if (t.segment === "validation") assert.ok(t.entryIndex >= trainEnd && t.entryIndex < valEnd && t.exitIndex < valEnd);
    if (t.segment === "test") assert.ok(t.entryIndex >= valEnd);
    if (t.segment === "embargo") assert.ok((t.entryIndex < trainEnd && t.exitIndex >= trainEnd) || (t.entryIndex < valEnd && t.exitIndex >= valEnd));
  }
  const edge = trades.filter((t) => t.strategy === "edge").sort((a, b) => a.entryIndex - b.entryIndex);
  assert.deepEqual(edge.map((t) => t.segment), ["train", "embargo", "validation", "embargo", "test"]);
  const lastTrain = Math.max(...trades.filter((t) => t.segment === "train").map((t) => t.exitIndex));
  const firstVal = Math.min(...trades.filter((t) => t.segment === "validation").map((t) => t.entryIndex));
  assert.ok(lastTrain < firstVal);
});

test("a split without a test segment is refused", () => {
  assert.throws(() => runBacktest([{ symbol: "S", candles: flatSeries(80, () => [100, 101, 99, 100.5]) }], { split: { train: 0.7, validation: 0.3 } }), /test segment/);
});

// ------------------------------------------------------------------------------------------ statistics
test("summarize: win rate, expectancy, breakeven, drawdown (chronological, pooled) and the Wilson interval", () => {
  const ts = [trade(0.92, 1), trade(0.92, 2), trade(-1, 3), trade(-1, 4), trade(-1, 5), trade(0.92, 6), trade(0, 7, "tie")];
  const s = summarize(ts, 0.92, 0);
  assert.equal(s.trades, 7); assert.equal(s.wins, 3); assert.equal(s.losses, 3); assert.equal(s.ties, 1);
  assert.equal(s.winRate, 0.5); assert.equal(s.lossRate, 0.5);
  assert.ok(Math.abs(s.totalPnl - (3 * 0.92 - 3)) < 1e-12);
  assert.ok(Math.abs(s.expectancy! - (3 * 0.92 - 3) / 7) < 1e-12);
  assert.ok(Math.abs(s.maxDrawdown - 3) < 1e-12);                           // peak 1.84 after trade 2, trough -1.16 after trade 5
  assert.ok(Math.abs(s.breakevenWinRate - 1 / 1.92) < 1e-12);
  assert.equal(s.vsBreakeven, "inconclusive");
  const w = wilson(50, 100)!;
  assert.ok(Math.abs(w[0] - 0.4038) < 1e-3 && Math.abs(w[1] - 0.5962) < 1e-3);
  assert.equal(summarize([], 0.92, 0).winRate, null);
});

test("normal CDF and two-proportion test sanity", () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6 && Math.abs(normalCdf(1.96) - 0.975) < 1e-3);
  const z = twoProportionZ(60, 100, 50, 100)!;
  assert.ok(Math.abs(z.z - 1.4142) < 0.01 && z.p > 0.15 && z.p < 0.17);
});

test("sessions are UTC hours of the entry candle", () => {
  const at = (h: number) => Date.UTC(2026, 0, 5, h, 0, 0) / 1000;
  assert.deepEqual([0, 6, 7, 12, 13, 20, 21, 23].map((h) => sessionOf(at(h))), ["Asia", "Asia", "London", "London", "NewYork", "NewYork", "Late", "Late"]);
});

// ------------------------------------------------------------------------------------------ data validation
test("candle validator: sorts out-of-order data, removes duplicate timestamps, reports gaps and bad candles", () => {
  const base = flatSeries(10, () => [100, 101, 99, 100.5]);
  const messy = [base[3], base[0], base[1], base[1], base[2], base[5], { ...base[6], high: 90 }];
  const { candles, issues } = cleanCandles(messy);
  assert.deepEqual(candles.map((c) => c.time), [0, 1, 2, 3, 5, 6].map((k) => T0 + k * TF));
  const text = issues.join("|");
  assert.match(text, /sorted/); assert.match(text, /duplicate/); assert.match(text, /gap/); assert.match(text, /invalid OHLC/);
});

test("parseCsv accepts epoch seconds, epoch milliseconds and ISO dates", () => {
  const a = parseCsv("time,open,high,low,close\n1762300200,1,2,0.5,1.5\n1762300500,1.5,2,1,1.2\n");
  assert.equal(a[0].time, 1762300200); assert.equal(a[1].close, 1.2);
  assert.equal(parseCsv("Epoch,Open,High,Low,Close\n1762300200000,1,2,0.5,1.5\n")[0].time, 1762300200);
  assert.equal(parseCsv("date,open,high,low,close\n2025-11-05T00:00:00Z,1,2,0.5,1.5\n")[0].time, Date.UTC(2025, 10, 5) / 1000);
  assert.throws(() => parseCsv("a,b\n1,2"), /columns/);
});

// ------------------------------------------------------------------------------------------ conflicts
test("conflicts: opposite Engine 5 / Engine 6 signals whose trades overlap are detected; sequential ones are not", () => {
  const cs = flatSeries(120, () => [100, 101, 99, 100.5]);
  const strategies = [fireAt("e5_continuation", "SELL", [50]), fireAt("e6_momentum", "BUY", [51])];
  const { report, trades } = runBacktest([{ symbol: "S", candles: cs }], { expiries: [300, 600], strategies });
  assert.equal(report.conflicts.overlappingOpposite[300], 0);                // 1-candle trades: entry 51 settles before entry 52
  assert.equal(report.conflicts.overlappingOpposite[600], 1);                // 2-candle trades overlap on candle 52
  assert.equal(trades.filter((t) => t.conflict && t.expiry === 600).length, 2);
  assert.equal(trades.filter((t) => t.conflict && t.expiry === 300).length, 0);
  const same = runBacktest([{ symbol: "S", candles: cs }], { expiries: [300], strategies: [fireAt("e5_continuation", "SELL", [50]), fireAt("e6_momentum", "BUY", [50])] });
  assert.equal(same.report.conflicts.opposite, 1);
});

// ------------------------------------------------------------------------------------------ whole run on synthetic data
test("no-edge market: win rates sit at 50%, expectancy is negative by about the payout gap, nothing looks 'above breakeven'", () => {
  const data = [1, 2, 3].map((k) => ({ symbol: `N${k}`, candles: synthCandles({ n: 15000, seed: 400 + k, persistence: 0 }) }));
  const { report } = runBacktest(data, { expiries: [300] });
  for (const s of report.strategies) {
    const o = s.byExpiry[300].overall;
    assert.ok(o.trades > 100, `${s.id} should have trades`);
    const z = (o.winRate! - 0.5) / Math.sqrt(0.25 / (o.wins + o.losses));
    assert.ok(Math.abs(z) < 3.6, `${s.id} z=${z.toFixed(2)}`);
    assert.ok(o.expectancy! < 0.01, `${s.id} EV ${o.expectancy}`);
    assert.notEqual(o.vsBreakeven, "above", `${s.id} must not look profitable on random data`);
  }
});

test("planted edge: when candle direction really persists, the harness finds it (and the control streak shows it most clearly)", () => {
  const data = [1, 2, 3].map((k) => ({ symbol: `P${k}`, candles: synthCandles({ n: 15000, seed: 900 + k, persistence: 0.25 }) }));
  const { report } = runBacktest(data, { expiries: [300] });
  const by = Object.fromEntries(report.strategies.map((s) => [s.id, s.byExpiry[300]]));
  assert.equal(by["ctl_streak3"].overall.vsBreakeven, "above");
  assert.equal(by["e6_momentum"].overall.vsBreakeven, "above");
  assert.ok(by["e6_momentum"].bySegment.test.winRate! > 0.53, "the edge holds in the out-of-sample segment too");
});

test("threshold selection uses the validation segment only and reports the test segment untouched", () => {
  const data = [1, 2].map((k) => ({ symbol: `Q${k}`, candles: synthCandles({ n: 20000, seed: 60 + k, persistence: 0.15 }) }));
  const { report } = runBacktest(data, { expiries: [300] });
  const grid = report.strategies.filter((s) => s.id.startsWith("e6_grid_")).map((s) => ({ id: s.id, v: s.byExpiry[300].bySegment.validation, t: s.byExpiry[300].bySegment.test }));
  const eligible = grid.filter((g) => g.v.trades >= BACKTEST_DEFAULTS.minTradesForSelection);
  const best = [...eligible].sort((a, b) => b.v.expectancy! - a.v.expectancy!)[0];
  const sel = report.selection[0];
  assert.equal(sel.chosen, best.id); assert.deepEqual(sel.test, best.t); assert.deepEqual(sel.validation, best.v);
  assert.match(sel.note, /test numbers were not used/);
});

test("trace records qualified setups and near-misses, each with its arithmetic", () => {
  const recs: TraceRecord[] = [];
  runBacktest([{ symbol: "S", candles: synthCandles({ n: 6000, seed: 21, persistence: 0.15 }) }], { expiries: [300], traceSink: (r) => recs.push(r) });
  const e5q = recs.find((r) => r.strategy === "e5_continuation" && r.qualified);
  const e5x = recs.find((r) => r.strategy === "e5_continuation" && !r.qualified);
  const e6q = recs.find((r) => r.strategy === "e6_momentum" && r.qualified);
  const e6x = recs.find((r) => r.strategy === "e6_momentum" && !r.qualified);
  for (const r of [e5q, e5x, e6q, e6x]) { assert.ok(r, "record kinds present"); assert.ok(r!.lines.some((l) => /[<>]=?/.test(l)), "carries comparisons with numbers"); }
  assert.equal(e5x!.state, "INVALIDATED"); assert.match(e6x!.state, /^REJECTED: /);
  assert.ok(e6q!.lines.some((l) => /strength/.test(l)));
});

test("the text report renders for every strategy, expiry, session and instrument", () => {
  const { report } = runBacktest([{ symbol: "S1", candles: synthCandles({ n: 5000, seed: 1 }) }, { symbol: "S2", candles: synthCandles({ n: 5000, seed: 2 }) }], { expiries: [300, 600] });
  const txt = renderReport(report);
  for (const id of ["e5_continuation", "e5_base_immediate", "e5_base_plus1", "e6_momentum", "e6_all3", "e6_two_plus_one", "ctl_streak3"]) assert.match(txt, new RegExp(id));
  assert.match(txt, /EXPIRY 300s/); assert.match(txt, /EXPIRY 600s/); assert.match(txt, /by session/); assert.match(txt, /by instrument/);
  assert.match(txt, /Do the two confirmation candles help/); assert.match(txt, /Threshold selection/); assert.match(txt, /Assumptions/);
});
