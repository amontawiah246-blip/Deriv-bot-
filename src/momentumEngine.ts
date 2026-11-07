// ENGINE 6: THREE-CANDLE BODY MOMENTUM (body dominance).
//
// Works on candle shape and size only. It never looks for a liquidity sweep and does not import any sweep code.
//
// A candle is STRONG (in the trade direction) when all of these hold:
//   body / range          >= strongBodyRatio        (default 0.65)
//   total wick / range    <= maxWickRatio           (default 0.35)
//   body                  >= strongBodyMedianMult x median body of the 20 completed candles before the sequence (default 1.20)
// A sequence of `consecutive` (3) same-direction candles qualifies when
//   - at least `minStrong` (2) of them are strong,
//   - every non-strong one still closes in the direction AND has body/range >= minWeakBodyRatio (not a doji / tiny-body rejection),
//   - the sum of the three real bodies >= minCombinedBodyMult x that median body.
// Any opposite or doji candle inside the sequence rejects it. The signal is for the NEXT candle and only exists once the last candle has closed.
//
// Note: body ratio + wick ratio = 1 for every candle, so with the default 0.65 / 0.35 the first two tests are the same test.
// They are both evaluated and logged, because if you set them to values that do not add up to 1 the stricter one decides.
//
// The numbers are experimental starting values, not tuned. Reads candles with index <= i only. No indicators.
import { Candle, Anatomy, Tracer, Trace, anatomy, contiguous, fmt, geq, isUnfinished, leq, median, validOhlc } from './candleMath';

export interface MomentumParams {
  consecutive: number;            // candles in the sequence (3)
  strongBodyRatio: number;        // 0.65
  maxWickRatio: number;           // 0.35
  strongBodyMedianMult: number;   // 1.20
  medianLookback: number;         // 20 completed candles
  minStrong: number;              // 2 (set to `consecutive` to demand all candles strong)
  minWeakBodyRatio: number;       // 0.30: a same-direction candle below this is a doji-like / tiny-body candle  (my assumption, configurable)
  minCombinedBodyMult: number;    // 3.0: sum of bodies >= this x median body                                    (my assumption, configurable)
  /** 'beforeSequence': one median from the 20 candles before the first candle of the sequence (default).
   *  'beforeEachCandle': each candle is compared with the median of the 20 candles right before it (the baseline then includes earlier candles of the run). */
  baseline: 'beforeSequence' | 'beforeEachCandle';
  requireContiguousTimes: boolean;
}
export const MOMENTUM_DEFAULTS: MomentumParams = {
  consecutive: 3, strongBodyRatio: 0.65, maxWickRatio: 0.35, strongBodyMedianMult: 1.2, medianLookback: 20, minStrong: 2,
  minWeakBodyRatio: 0.3, minCombinedBodyMult: 3, baseline: 'beforeSequence', requireContiguousTimes: true,
};

export interface MomentumCandleInfo extends Anatomy {
  index: number; time: number;
  directional: boolean; strong: boolean;
  baselineMedian: number; bodyVsMedian: number;
}

export interface MomentumSignal {
  engine: 'momentum';
  patternId: string;                 // e.g. MOMENTUM_2_OF_3_STRONG
  side: 'BUY' | 'SELL';
  signalIndex: number;
  signalTime: number;                // open time of the last candle of the sequence
  strongCount: number;
  avgBodyRatio: number;
  avgWickRatio: number;
  combinedBody: number;              // sum of the real bodies
  netMove: number;                   // directional distance from the first open to the last close (positive = in the trade direction)
  medianBody: number;                // baseline median body
  combinedVsMedian: number;
  candles: MomentumCandleInfo[];
  startLevel: number;                // open of the first candle
  entryReference: number;            // close of the last candle
  reasons: string[];
}

export interface MomentumEval { signal: MomentumSignal | null; trace: Trace; failed: string | null }

export function evaluateMomentum(cs: Candle[], i: number, p: MomentumParams = MOMENTUM_DEFAULTS, verbose = false): MomentumEval {
  const t = new Tracer(verbose);
  const fail = (): MomentumEval => ({ signal: null, trace: t.result(), failed: t.result().failed });
  /** Verbose mode keeps evaluating after a failed check so the log shows every number; structural failures must still stop the run. */
  const stop = () => !t.passed;
  const n = p.consecutive;
  const first = i - n + 1;

  if (!t.step('enough history', n >= 2 && first - p.medianLookback >= 0 && i < cs.length,
    () => `need ${n} candles + ${p.medianLookback} before them; candles available up to index ${i}: ${i + 1}`) || stop()) return fail();
  const seq = cs.slice(first, i + 1);

  if (!t.step('candles valid and closed', seq.every((c) => validOhlc(c) && !isUnfinished(c)), () => `valid ${seq.every(validOhlc)}, closed ${seq.every((c) => !isUnfinished(c))}`) || stop()) return fail();
  if (p.requireContiguousTimes && (!t.step('consecutive candles', contiguous(seq), () => `times ${seq.map((c) => c.time).join(', ')}`) || stop())) return fail();

  const an = seq.map(anatomy);
  const bear = an.every((a) => a.direction === 'bear'), bull = an.every((a) => a.direction === 'bull');
  if (!t.step(`${n} candles in one direction, none opposite or doji`, bear || bull, () => `directions ${an.map((a) => a.direction).join(', ')}`) || stop()) return fail();
  const side: 'BUY' | 'SELL' = bull ? 'BUY' : 'SELL';

  const seqBase = median(cs.slice(first - p.medianLookback, first).map((c) => Math.abs(c.close - c.open)));
  if (!t.step('baseline median body is positive', seqBase > 0, () => `median body of ${p.medianLookback} candles before the sequence = ${fmt(seqBase)}`) || stop()) return fail();

  const info: MomentumCandleInfo[] = [];
  let strongCount = 0;
  for (let k = 0; k < n; k++) {
    const idx = first + k, a = an[k];
    const base = p.baseline === 'beforeEachCandle' ? median(cs.slice(idx - p.medianLookback, idx).map((c) => Math.abs(c.close - c.open))) : seqBase;
    const ratioOk = geq(a.bodyRatio, p.strongBodyRatio);
    const wickOk = leq(a.wickRatio, p.maxWickRatio);
    const sizeOk = base > 0 && geq(a.body, p.strongBodyMedianMult * base);
    const strong = ratioOk && wickOk && sizeOk;
    if (strong) strongCount++;
    info.push({ ...a, index: idx, time: cs[idx].time, directional: true, strong, baselineMedian: base, bodyVsMedian: base > 0 ? a.body / base : NaN });
    t.step(`candle ${k + 1} strength`, true, () =>
      `${strong ? 'STRONG' : 'weaker'}: body/range ${fmt(a.bodyRatio)} ${ratioOk ? '>=' : '<'} ${fmt(p.strongBodyRatio)}, ` +
      `wick/range ${fmt(a.wickRatio)} ${wickOk ? '<=' : '>'} ${fmt(p.maxWickRatio)}, ` +
      `body ${fmt(a.body)} ${sizeOk ? '>=' : '<'} ${fmt(p.strongBodyMedianMult)} x median ${fmt(base)} = ${fmt(p.strongBodyMedianMult * base)}`);
    if (!strong) {
      const ok = geq(a.bodyRatio, p.minWeakBodyRatio);
      t.step(`candle ${k + 1} not a doji / tiny-body candle`, ok, () => `body/range ${fmt(a.bodyRatio)} >= ${fmt(p.minWeakBodyRatio)}`);
    }
  }

  t.step('enough strong candles', strongCount >= p.minStrong, () => `${strongCount} strong of ${n}, need >= ${p.minStrong}`);

  const combinedBody = an.reduce((s, a) => s + a.body, 0);
  t.step('combined body strength', geq(combinedBody, p.minCombinedBodyMult * seqBase),
    () => `sum of bodies ${fmt(combinedBody)} >= ${fmt(p.minCombinedBodyMult)} x median ${fmt(seqBase)} = ${fmt(p.minCombinedBodyMult * seqBase)}`);
  if (stop()) return fail();

  const dirSign = side === 'BUY' ? 1 : -1;
  const netMove = dirSign * (seq[n - 1].close - seq[0].open);
  const avg = (f: (a: Anatomy) => number) => an.reduce((s, a) => s + f(a), 0) / n;
  const signal: MomentumSignal = {
    engine: 'momentum', patternId: `MOMENTUM_${strongCount}_OF_${n}_STRONG`, side, signalIndex: i, signalTime: seq[n - 1].time,
    strongCount, avgBodyRatio: avg((a) => a.bodyRatio), avgWickRatio: avg((a) => a.wickRatio), combinedBody, netMove,
    medianBody: seqBase, combinedVsMedian: combinedBody / seqBase, candles: info,
    startLevel: seq[0].open, entryReference: seq[n - 1].close, reasons: [],
  };
  return { signal, trace: t.result(), failed: null };
}

/** The engine. Signal candle = i = the last candle of the sequence. Trade = the next candle's open. */
export function detectMomentumSignal(cs: Candle[], i: number, p: MomentumParams = MOMENTUM_DEFAULTS): MomentumSignal | null {
  const quick = evaluateMomentum(cs, i, p, false);
  if (!quick.signal) return null;
  const full = evaluateMomentum(cs, i, p, true);          // verbose pass only for the (rare) accepted setups
  return { ...quick.signal, reasons: full.trace.checks.map((c) => `${c.name}: ${c.detail}`) };
}

/** Full arithmetic (pass or fail) for candle i. For logs and the backtest trace. */
export const explainMomentum = (cs: Candle[], i: number, p: MomentumParams = MOMENTUM_DEFAULTS) => evaluateMomentum(cs, i, p, true);
