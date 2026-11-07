// Shared candle arithmetic for Engines 5 and 6 (and the backtester). Pure functions, no indicators, no imports.
//
// Every number an engine uses to accept or reject a setup is produced here or in the engine itself and can be written out
// as a "check": a name, pass/fail, and the exact arithmetic (e.g. "cur.high 102.6 > prev.high 102.2").

/** OHLC candle. `closed === false` marks a candle that is still forming; every engine refuses such a candle. */
export interface Candle { time: number; open: number; high: number; low: number; close: number; closed?: boolean }

export type Direction = 'bull' | 'bear' | 'doji';

export interface Anatomy {
  body: number;          // |close - open|
  range: number;         // high - low
  upperWick: number;     // high - max(open, close)
  lowerWick: number;     // min(open, close) - low
  totalWick: number;     // upperWick + lowerWick
  bodyRatio: number;     // body / range   (0 for a zero-range candle)
  wickRatio: number;     // totalWick / range (0 for a zero-range candle)
  direction: Direction;  // strict: close > open = bull, close < open = bear, equal = doji
}

/** Relative tolerance for "at least" / "at most" comparisons, so 0.65 written as 0.6499999999 still counts as 0.65. */
const REL_TOL = 1e-9;
export const geq = (a: number, b: number) => a >= b - Math.abs(b) * REL_TOL;
export const leq = (a: number, b: number) => a <= b + Math.abs(b) * REL_TOL;

/** Zero-range candles are handled safely: both ratios are 0 and the candle is a doji (or invalid), never a division by zero. */
export function anatomy(c: Candle): Anatomy {
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const totalWick = upperWick + lowerWick;
  const ok = range > 0;
  return {
    body, range, upperWick, lowerWick, totalWick,
    bodyRatio: ok ? body / range : 0,
    wickRatio: ok ? totalWick / range : 0,
    direction: c.close > c.open ? 'bull' : c.close < c.open ? 'bear' : 'doji',
  };
}

/** Finite numbers and high/low really bracket open and close. */
export function validOhlc(c: Candle): boolean {
  return [c.open, c.high, c.low, c.close].every(Number.isFinite)
    && c.high >= c.low && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close);
}

export const isUnfinished = (c: Candle) => c.closed === false;

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Number as text with no float noise (102.20000000000002 -> 102.2). */
export const fmt = (x: number) => (Number.isFinite(x) ? String(+x.toPrecision(10)) : String(x));

// ---------------------------------------------------------------------------------------------------- traces
export interface Check { name: string; pass: boolean; detail: string }
export interface Trace { ok: boolean; failed: string | null; checks: Check[] }

/**
 * Collects pass/fail checks with their arithmetic. In quiet mode (the backtest's hot loop) it stops at the first failure and
 * builds no strings. In verbose mode it evaluates every check so the log shows all the numbers, not just the first failure.
 */
export class Tracer {
  private ok = true;
  private failed: string | null = null;
  private checks: Check[] = [];
  constructor(public readonly verbose: boolean) {}

  /** Records one check. Returns true while the caller should keep evaluating (always in verbose mode, only while passing in quiet mode). */
  step(name: string, pass: boolean, detail: () => string): boolean {
    if (!pass && this.ok) { this.ok = false; this.failed = name; }
    if (this.verbose) this.checks.push({ name, pass, detail: detail() });
    return pass || this.verbose;
  }

  get passed() { return this.ok; }
  result(): Trace { return { ok: this.ok, failed: this.failed, checks: this.checks }; }
}

export const traceLines = (t: Trace): string[] => t.checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`);

/** True when the candles are in strict chronological order with one constant spacing (no missing or duplicated candle). */
export function contiguous(cs: Candle[]): boolean {
  if (cs.length < 2) return true;
  const d = cs[1].time - cs[0].time;
  if (!(d > 0)) return false;
  for (let k = 2; k < cs.length; k++) if (cs[k].time - cs[k - 1].time !== d) return false;
  return true;
}
