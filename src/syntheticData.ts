// Deterministic SYNTHETIC candles for testing the backtester. This is not market data: it only proves that the plumbing works,
// that a no-edge market shows no edge, and that a planted edge is detected.
import { Candle } from './candleMath';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface SynthOptions {
  n: number; seed: number;
  tf?: number;              // seconds per candle (300)
  t0?: number;              // first candle open time (epoch seconds)
  start?: number;           // first price
  baseVol?: number;         // typical candle return sd as a fraction of price (0.0006 = 0.06%)
  persistence?: number;     // AR(1) on candle returns. 0 = no edge at all; 0.15 = returns tend to repeat the previous candle's direction
  ticks?: number;           // price steps inside each candle (builds realistic wicks)
}

export function synthCandles(o: SynthOptions): Candle[] {
  const { n, seed, tf = 300, t0 = 1_760_000_100, start = 1000, baseVol = 0.0006, persistence = 0, ticks = 24 } = o;
  const r = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
  const out: Candle[] = [];
  let p = start, logVol = 0, prevRet = 0;
  for (let i = 0; i < n; i++) {
    logVol = 0.97 * logVol + 0.25 * gauss();                      // volatility clusters: calm and busy stretches
    const sigma = baseVol * Math.exp(logVol * 0.5);
    const mu = persistence * prevRet;                              // the only source of predictability
    const open = p; let hi = p, lo = p, cur = p;
    for (let k = 0; k < ticks; k++) {
      cur *= 1 + mu / ticks + (sigma / Math.sqrt(ticks)) * gauss();
      if (cur > hi) hi = cur; if (cur < lo) lo = cur;
    }
    out.push({ time: t0 + i * tf, open, high: hi, low: lo, close: cur });
    prevRet = (cur - open) / open;
    p = cur;
  }
  return out;
}
