// The three price-action engines. Pure functions: candles in, verdict out. Every function reads CLOSED candles only,
// and reads nothing after index i (no look-ahead).
//
//  1. wickSweep      your original rule (ported 1:1 from bridge/engines/wick_sweep_engine.py, checked against it in the tests):
//                    a candle wicks past the previous candle's extreme, its body stays inside, then the context check decides TAKE or SKIP.
//  2. continuation   ENGINE 5 (src/continuationEngine.ts): sweeper (Pattern 1/2), then TWO fully closed candles in the trade direction. Trade the NEXT candle's open.
//  3. momentum       ENGINE 6 (src/momentumEngine.ts): three same-direction candles, at least two of them STRONG (body dominance). No sweep needed. Trade the NEXT candle's open.

import { ContinuationParams, CONTINUATION_DEFAULTS, detectContinuationSignal } from './continuationEngine';
import { MomentumParams, MOMENTUM_DEFAULTS, detectMomentumSignal } from './momentumEngine';

export interface C { time: number; open: number; high: number; low: number; close: number; closed?: boolean }
export type Side = 'BUY' | 'SELL';
export type EngineName = 'sweep' | 'continuation' | 'momentum';

export interface Verdict {
  engine: EngineName;
  side: Side;
  ok: boolean;                 // true = TAKE, false = SKIP
  block: string | null;        // why it was skipped
  notes: string[];
  entry: number;               // close of the signal candle (reference price)
  sweptLevel: number;          // the extreme that was swept (or the momentum start level)
  from: number;                // index of the first candle that belongs to the pattern (for highlighting)
  signalIndex: number;         // index of the last candle of the pattern (the candle that just closed)
  tradeAtNextOpen: boolean;    // continuation + momentum: the trade opens on the next candle
  trace?: string[];            // continuation + momentum: the exact arithmetic of every check that qualified the setup
}

const EPS = 1e-12;
const range = (c: C) => Math.max(c.high - c.low, EPS);
const body = (c: C) => Math.abs(c.close - c.open);
const bodyRatio = (c: C) => body(c) / range(c);
const mirror = (c: C): C => ({ time: c.time, open: -c.open, high: -c.low, low: -c.high, close: -c.close });

/** A broker "filler" candle (no movement at all) is not real price action. Windows containing one are not evaluated. */
export const isFlat = (c: C) => c.open === c.high && c.high === c.low && c.low === c.close;

// ------------------------------------------------------------------------------------------------ 1. wick sweep
export interface WickParams { lookback: number; minEvidence: number; maxStrength: number; strongBody: number; wickRatio: number }
export const WICK_DEFAULTS: WickParams = { lookback: 6, minEvidence: 2, maxStrength: 0.5, strongBody: 0.6, wickRatio: 0.4 };
const wickWindow = (p: WickParams) => p.lookback + 3;
const SELL_NOTES: Record<string, string> = { 'low swept and bought back': 'high swept and sold back' };

function checkLong(cs: C[], p: WickParams): { ok: boolean; block: string | null; notes: string[] } | null {
  const i = cs.length - 1;
  if (i < wickWindow(p) - 1) return null;
  const cur = cs[i], sw = cs[i - 1];
  if (!(sw.close < sw.open && cur.close > cur.open)) return null;      // swept candle bearish, sweeper bullish
  if (!(cur.low < sw.low)) return null;                                // the wick goes below the swept low
  if (Math.min(cur.open, cur.close) < sw.low) return null;             // but the BODY stays at or above it

  const zone = cs.slice(i - 1 - p.lookback, i);
  let tried = 0, firm = 0;
  const notes: string[] = [];
  zone.forEach((c, k) => {
    const pv = k ? zone[k - 1] : zone[0];
    const r = range(c);
    const lw = (Math.min(c.open, c.close) - c.low) / r;
    const b = Math.abs(c.close - c.open) / r;
    if (lw >= p.wickRatio) { tried++; notes.push('wick rejection'); }
    else if (c.close > c.open && b >= p.strongBody) { tried++; notes.push('strong push'); }
    else if (c.low < pv.low && c.close > pv.close) { tried++; notes.push('low swept and bought back'); }
    if (c.close < c.open && b >= p.strongBody && c.close <= c.low + 0.2 * r) firm++;
  });
  let strength = firm / zone.length;
  const swr = range(sw);
  if (Math.abs(sw.close - sw.open) / swr >= 0.8 && sw.close <= sw.low + 0.1 * swr) strength += 0.25;

  if (tried < p.minEvidence) return { ok: false, block: 'initiating side never really tried', notes };
  if (strength > p.maxStrength) return { ok: false, block: 'opposing side still in firm control', notes };
  return { ok: true, block: null, notes };
}

export function detectWickSweep(cs: C[], i: number, p: WickParams = WICK_DEFAULTS): Verdict | null {
  const w = wickWindow(p);
  if (i < w - 1 || i >= cs.length) return null;
  const win = cs.slice(i - w + 1, i + 1);
  const make = (side: Side, r: { ok: boolean; block: string | null; notes: string[] }, level: number): Verdict => ({
    engine: 'sweep', side, ok: r.ok, block: r.block, notes: [...new Set(r.notes)], entry: cs[i].close, sweptLevel: level,
    from: i - 1, signalIndex: i, tradeAtNextOpen: false,
  });
  const buy = checkLong(win, p);
  if (buy) return make('BUY', buy, win[w - 2].low);
  const sell = checkLong(win.map(mirror), p);
  if (sell) return make('SELL', { ...sell, notes: sell.notes.map((n) => SELL_NOTES[n] ?? n) }, win[w - 2].high);
  return null;
}

// ------------------------------------------------------------------------------------------------ 2. sweep continuation (ENGINE 5)
// The rules live in src/continuationEngine.ts: sweeper that satisfies Pattern 1 / 2, then TWO fully closed candles in the trade
// direction. These adapters only translate the engine's signal into the Verdict shape the watcher, charts and UI already use.
export type ContParams = ContinuationParams;
export const CONT_DEFAULTS: ContParams = CONTINUATION_DEFAULTS;

/** Signal candle = i, the SECOND confirming candle. Pattern = [prior, sweeper, confirm 1, confirm 2]. Trade = next candle's open. */
export function detectContinuation(cs: C[], i: number, p: ContParams = CONT_DEFAULTS): Verdict | null {
  const s = detectContinuationSignal(cs, i, p);
  if (!s) return null;
  const sell = s.side === 'SELL';
  const colour = sell ? 'red' : 'green';
  return {
    engine: 'continuation', side: s.side, ok: true, block: null,
    notes: [
      sell ? 'red candle swept the high of the green candle' : 'green candle swept the low of the red candle',
      `next two candles closed ${colour}`,
      'trade on the next candle open',
    ],
    trace: s.reasons,
    entry: s.entryReference, sweptLevel: s.sweptLevel, from: i - 3, signalIndex: i, tradeAtNextOpen: true,
  };
}

// ------------------------------------------------------------------------------------------------ 3. momentum (ENGINE 6)
// Body-dominance rules live in src/momentumEngine.ts (no sweep needed, no indicators).
export type MomParams = MomentumParams;
export const MOM_DEFAULTS: MomParams = MOMENTUM_DEFAULTS;

/** Signal candle = i, the THIRD candle. At least 2 of the 3 same-direction candles must be strong (big body, small wicks, big vs the recent median). */
export function detectMomentum(cs: C[], i: number, p: MomParams = MOM_DEFAULTS): Verdict | null {
  const s = detectMomentumSignal(cs, i, p);
  if (!s) return null;
  const up = s.side === 'BUY';
  const n = p.consecutive;
  return {
    engine: 'momentum', side: s.side, ok: true, block: null,
    notes: [
      `${s.strongCount} of ${n} ${up ? 'green' : 'red'} candles strong, ${n} in a row`,
      `avg body ${(s.avgBodyRatio * 100).toFixed(0)}% / wick ${(s.avgWickRatio * 100).toFixed(0)}% of range, combined body ${s.combinedVsMedian.toFixed(1)}x median`,
      'trade on the next candle open',
    ],
    trace: s.reasons,
    entry: s.entryReference, sweptLevel: s.startLevel, from: i - n + 1, signalIndex: i, tradeAtNextOpen: true,
  };
}

/** Everything that fires on closed candle i. */
export function detectAll(cs: C[], i: number): Verdict[] {
  const out: Verdict[] = [];
  const w = detectWickSweep(cs, i); if (w) out.push(w);
  const c = detectContinuation(cs, i); if (c) out.push(c);
  const m = detectMomentum(cs, i); if (m) out.push(m);
  return out;
}
