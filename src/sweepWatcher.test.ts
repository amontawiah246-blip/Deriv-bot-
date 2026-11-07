import test from "node:test";
import assert from "node:assert/strict";
import { SweepWatcherService, WatcherDeps } from "./sweepWatcherCore";
import { C, detectAll } from "./sweepEngines";

const TF = 60, T0 = 1_762_300_020;                       // a multiple of 60
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function walk(n: number, seed: number): C[] {
  const r = rng(seed), g = () => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
  let p = 1000; const out: C[] = [];
  for (let i = 0; i < n; i++) {
    const o = p, c = o + g() * 1.4, f = () => [0.2, 1, 2][Math.floor(r() * 3)];
    out.push({ time: T0 + i * TF, open: o, close: c, high: Math.max(o, c) + Math.abs(g()) * f(), low: Math.min(o, c) - Math.abs(g()) * f() });
    p = c;
  }
  return out;
}

/** Fake broker clock + feed. The newest candle returned is "forming", with garbage values, until its minute is over. */
function feed(data: Record<string, C[]>, failing: string[] = []) {
  const st = { now: 0 };
  const deps: WatcherDeps = {
    now: async () => st.now,
    sleep: async () => {},
    fetchCandles: async (symbol, _tf, count) => {
      if (failing.includes(symbol)) throw new Error("boom");
      const cs = data[symbol].filter((c) => c.time <= st.now).map((c) => ({ ...c }));
      const last = cs[cs.length - 1];
      if (last && last.time + TF > st.now) Object.assign(last, { open: last.open + 50, close: last.close - 50, high: last.high + 80, low: last.low - 80 });
      return cs.slice(-count);
    },
  };
  return { st, deps };
}
const AGENTS = ["A1", "A2", "A3", "A4", "A5", "A6"].map((s) => ({ symbol: s, name: `Agent ${s}`, market: `Market ${s}` }));

test("live watching gives exactly the engines' signals on the finished series (no filler, no forming candle, no look-ahead)", async () => {
  const two = AGENTS.slice(0, 2);
  const data: Record<string, C[]> = Object.fromEntries(two.map((a, i) => [a.symbol, walk(400, 11 + i)]));
  const { st, deps } = feed(data);
  const w = new SweepWatcherService({ agents: two, deps });
  for (let i = 60; i < 400; i++) { st.now = T0 + (i + 1) * TF + 3; await w.runPass(0); }

  const all = w.getAlerts(0, 300);
  const got = all.map((a) => `${a.symbol}|${a.engine}|${a.candle_time}|${a.side}|${a.ok}`).sort();
  const want: string[] = [];
  for (const a of two) {
    const cs = data[a.symbol];
    for (let i = 60; i < 400; i++) for (const v of detectAll(cs.slice(Math.max(0, i - 44), i + 1), Math.min(i, 44))) want.push(`${a.symbol}|${v.engine}|${cs[i].time}|${v.side}|${v.ok}`);
  }
  assert.ok(want.length > 80 && want.length < 300, `test data should hold plenty of setups (${want.length})`);
  assert.deepEqual(got, want.sort());
  assert.ok(new Set(all.map((a) => a.engine)).size >= 2, "more than one engine fired");
  assert.ok(all.every((a) => a.live));
  assert.ok(all.every((a) => !("svg" in a)), "the list never carries the heavy svg");
});

test("every alert is a setup an engine found: nothing is posted when there is no setup", async () => {
  const data = { A1: walk(120, 5) };
  const { st, deps } = feed(data);
  const w = new SweepWatcherService({ agents: [AGENTS[0]], deps });
  st.now = T0 + 119 * TF + 3; await w.runPass(0);
  const n = w.getAlerts(0, 300).length;
  const cs = data.A1.slice(0, 119);                      // candles 0..118 are closed at that moment
  assert.equal(n, detectAll(cs, 118).length);
});

test("a market that fails does not stop the others and is reported", async () => {
  const data: Record<string, C[]> = Object.fromEntries(AGENTS.map((a, i) => [a.symbol, walk(300, 40 + i)]));
  const { st, deps } = feed(data, ["A3"]);
  const w = new SweepWatcherService({ agents: AGENTS, deps });
  st.now = T0 + 299 * TF + 3; await w.runPass(250);
  const s = w.getState();
  assert.deepEqual(s.failed, ["A3"]);
  assert.ok(w.getAlerts(0, 300).some((a) => a.symbol !== "A3"));
  assert.equal(s.agents, 6);
  assert.ok(s.markets.filter((m) => m.symbol !== "A3").every((m) => m.last_candle > 0));
});

test("backfill finds earlier setups as 'earlier' (not live) and never duplicates them", async () => {
  const data = { A1: walk(300, 9), A2: walk(300, 10) };
  const { st, deps } = feed(data);
  const w = new SweepWatcherService({ agents: AGENTS.slice(0, 2), deps });
  st.now = T0 + 299 * TF + 3;
  await w.runPass(200);
  const first = w.getAlerts(0, 300);
  assert.ok(first.length > 0 && first.every((a) => !a.live));
  await w.runPass(200);
  assert.equal(w.getAlerts(0, 300).length, first.length);
});

test("a window containing broker filler (flat) candles is not evaluated", async () => {
  const cs = walk(200, 3);
  for (let i = 150; i < 160; i++) cs[i] = { time: cs[i].time, open: 1000, high: 1000, low: 1000, close: 1000 };
  const { st, deps } = feed({ A1: cs });
  const w = new SweepWatcherService({ agents: [AGENTS[0]], deps });
  st.now = T0 + 159 * TF + 3; await w.runPass(0);
  assert.equal(w.getAlerts(0, 300).length, 0);
});

test("each engine's screenshot says what it found", async () => {
  // quiet history, then a red sweeper + two red candles (continuation SELL), built on prices around 100
  const quiet = (n: number): C[] => Array.from({ length: n }, (_, i) => ({ time: T0 + i * TF, open: 100 + (i % 2) * 0.1, high: 100.3, low: 99.8, close: 100.05 + ((i + 1) % 2) * 0.1 }));
  const tail = [
    [100.0, 102.2, 99.8, 102.0], [101.8, 102.6, 100.8, 100.9], [100.9, 101.0, 100.1, 100.2], [100.2, 100.3, 99.4, 99.5],
  ].map((r, j) => ({ time: T0 + (20 + j) * TF, open: r[0], high: r[1], low: r[2], close: r[3] }));
  const cs = [...quiet(20), ...tail, { time: T0 + 24 * TF, open: 99.5, high: 99.6, low: 99.0, close: 99.1 }];
  const { st, deps } = feed({ A1: cs });
  const w = new SweepWatcherService({ agents: [AGENTS[0]], deps });
  st.now = T0 + 24 * TF + 3; await w.runPass(0);
  const a = w.getAlerts(0, 10).find((x) => x.engine === "continuation");
  assert.ok(a, "continuation alert posted");
  assert.equal(a!.side, "SELL"); assert.equal(a!.ok, true); assert.equal(a!.trade_at_next_open, true);
  const svg = w.getAlertSvg(a!.id)!;
  assert.match(svg, /Valid Sell Continuation/); assert.match(svg, /next open/); assert.match(svg, /swept high 102\.200/);
  assert.equal(w.getAlertSvg(99999), null);
});

test("Engine 5 / 6 alerts carry the arithmetic of their checks and a conflict flag", async () => {
  const row = (i: number, o: number, h: number, l: number, c: number): C => ({ time: T0 + i * TF, open: o, high: h, low: l, close: c });
  const cs: C[] = [];
  for (let i = 0; i < 30; i++) cs.push(row(i, 100 + (i % 2) * 0.1, 100.3, 99.8, 100 + ((i + 1) % 2) * 0.1 + 0.05));
  cs.push(row(30, 100, 100.1, 99.1, 99.2), row(31, 99.2, 99.3, 98.3, 98.4), row(32, 98.4, 98.5, 97.5, 97.6));   // three strong red candles
  const { st, deps } = feed({ A1: cs });
  const w = new SweepWatcherService({ agents: [AGENTS[0]], deps });
  st.now = T0 + 33 * TF + 3;
  await w.runPass(0);
  const alerts = w.getAlerts(0, 50);
  const mom = alerts.find((a) => a.engine === "momentum");
  assert.ok(mom, "momentum alert expected");
  assert.equal(mom!.side, "SELL"); assert.equal(mom!.candle_time, cs[32].time); assert.equal(mom!.trade_at_next_open, true);
  assert.ok(mom!.trace.length >= 8 && mom!.trace.some((l) => /body\/range/.test(l)));
  assert.equal(typeof mom!.conflict, "boolean"); assert.equal(mom!.conflict, false);
  await w.runPass(0);                                                              // same candle again: no duplicate entry
  assert.equal(w.getAlerts(0, 50).filter((a) => a.engine === "momentum").length, 1);
});
