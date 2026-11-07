// Pattern 1 (bearish high sweep) and Pattern 2 (bullish low sweep), exactly as written in the strategy specification.
// Engine 5 uses these as its "Candle A" test, and the backtester uses them for the "enter right after the sweep" baseline.
// Nothing here changes any existing engine: src/sweepEngines.ts keeps its own wick-sweep engine untouched.
//
// Pattern 1  SELL   previous candle bullish, current candle bearish, current.high > previous.high (strictly),
//                   current.close inside the previous candle's real body.
// Pattern 2  BUY    previous candle bearish, current candle bullish, current.low  < previous.low  (strictly),
//                   current.close inside the previous candle's real body.
// A wick that only touches the previous extreme is NOT a sweep.
//
// Option requireWickOnlySweep (default ON): the current candle must also not OPEN beyond the swept level, so only the wick
// goes through (the "body stays inside / wick rejection" rule the existing wick-sweep engine uses). Turn it off to run the
// literal Pattern 1/2 text, which would also accept a candle that gaps open beyond the level and then closes back inside.
import { Candle, Tracer, fmt } from './candleMath';

export interface SweepDefinition { requireWickOnlySweep: boolean }
export const SWEEP_DEFAULTS: SweepDefinition = { requireWickOnlySweep: true };

export type SweepSide = 'SELL' | 'BUY';

/** Tests Pattern 1 (side SELL) or Pattern 2 (side BUY) for `prev` -> `cur`, writing every check into `t`. Returns t.passed. */
export function checkSweep(t: Tracer, side: SweepSide, prev: Candle, cur: Candle, def: SweepDefinition = SWEEP_DEFAULTS): boolean {
  const sell = side === 'SELL';
  const bodyLo = Math.min(prev.open, prev.close), bodyHi = Math.max(prev.open, prev.close);

  if (!t.step(sell ? 'previous candle bullish' : 'previous candle bearish',
    sell ? prev.close > prev.open : prev.close < prev.open,
    () => `prev.close ${fmt(prev.close)} ${sell ? '>' : '<'} prev.open ${fmt(prev.open)}`)) return false;

  if (!t.step(sell ? 'sweeper bearish' : 'sweeper bullish',
    sell ? cur.close < cur.open : cur.close > cur.open,
    () => `cur.close ${fmt(cur.close)} ${sell ? '<' : '>'} cur.open ${fmt(cur.open)}`)) return false;

  // strict penetration: equal is a touch, not a sweep
  if (!t.step(sell ? 'high strictly above previous high' : 'low strictly below previous low',
    sell ? cur.high > prev.high : cur.low < prev.low,
    () => sell ? `cur.high ${fmt(cur.high)} > prev.high ${fmt(prev.high)}${cur.high === prev.high ? ' (equal = touch only)' : ''}`
      : `cur.low ${fmt(cur.low)} < prev.low ${fmt(prev.low)}${cur.low === prev.low ? ' (equal = touch only)' : ''}`)) return false;

  if (!t.step('close inside previous real body',
    cur.close >= bodyLo && cur.close <= bodyHi,
    () => `${fmt(bodyLo)} <= cur.close ${fmt(cur.close)} <= ${fmt(bodyHi)}`)) return false;

  if (def.requireWickOnlySweep) {
    if (!t.step(sell ? 'open not beyond swept high (wick-only sweep)' : 'open not beyond swept low (wick-only sweep)',
      sell ? cur.open <= prev.high : cur.open >= prev.low,
      () => sell ? `cur.open ${fmt(cur.open)} <= prev.high ${fmt(prev.high)}` : `cur.open ${fmt(cur.open)} >= prev.low ${fmt(prev.low)}`)) return false;
  }
  return t.passed;
}

/** Convenience: does `cur` sweep `prev` (Pattern 1 for SELL, Pattern 2 for BUY)? */
export function isSweep(side: SweepSide, prev: Candle, cur: Candle, def: SweepDefinition = SWEEP_DEFAULTS): boolean {
  return checkSweep(new Tracer(false), side, prev, cur, def);
}

/** Price level that a sweep of `prev` takes out. */
export const sweptLevel = (side: SweepSide, prev: Candle) => (side === 'SELL' ? prev.high : prev.low);
