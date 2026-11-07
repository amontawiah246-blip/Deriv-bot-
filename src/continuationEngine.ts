// ENGINE 5: THREE-CANDLE SWEEP CONTINUATION.
//
//   P  the candle that gets swept (bullish for a SELL setup, bearish for a BUY setup)
//   A  the sweeper: satisfies the original sweep definition against P (Pattern 1 for SELL, Pattern 2 for BUY)
//   B  must CLOSE in the trade direction (bearish for SELL, bullish for BUY), fully closed
//   C  must CLOSE in the trade direction, fully closed
//   After C closes the engine issues the signal for the NEXT candle. Never earlier.
//
// If B or C closes the other way (or as a doji) the sequence is INVALIDATED and can never produce a signal.
// The engine says nothing about whether the next candle will continue; it only reports that the sequence qualified.
//
// Reads candles with index <= i only. No indicators. Independent of the momentum engine.
import { Candle, Tracer, Trace, contiguous, fmt, geq, anatomy, isUnfinished, validOhlc } from './candleMath';
import { SWEEP_DEFAULTS, SweepDefinition, SweepSide, checkSweep, sweptLevel } from './sweepPatterns';

export interface ContinuationParams extends SweepDefinition {
  /** B and C must each have body/range >= this. 0 = off (default): the spec only asks that they CLOSE in the direction. */
  minConfirmBodyRatio: number;
  /** P, A, B, C must be consecutive candles (equal time spacing). A missing candle in between voids the pattern. */
  requireContiguousTimes: boolean;
}
export const CONTINUATION_DEFAULTS: ContinuationParams = { ...SWEEP_DEFAULTS, minConfirmBodyRatio: 0, requireContiguousTimes: true };

export type SequenceState = 'NO_SWEEP' | 'AWAITING_B' | 'AWAITING_C' | 'CONFIRMED' | 'INVALIDATED';

export interface ContinuationEval { side: SweepSide; state: SequenceState; reason: string; trace: Trace }

export interface ContinuationSignal {
  engine: 'continuation';
  patternId: 'SWEEP_CONTINUATION';
  side: SweepSide;
  signalIndex: number;          // index of candle C, the candle that just closed
  signalTime: number;           // open time of candle C
  aIndex: number;
  sweptLevel: number;
  entryReference: number;       // close of C
  prior: Candle; a: Candle; b: Candle; c: Candle;
  reasons: string[];            // the arithmetic of every check that passed
}

/**
 * Follows the sequence whose sweeper is candle `aIdx`, using only candles up to aIdx + 2.
 * Used both for the signal (aIdx = i - 2) and for live progress reporting (AWAITING_B / AWAITING_C).
 */
export function sequenceState(cs: Candle[], aIdx: number, side: SweepSide, p: ContinuationParams = CONTINUATION_DEFAULTS, verbose = false): ContinuationEval {
  const t = new Tracer(verbose);
  const done = (state: SequenceState, reason: string): ContinuationEval => ({ side, state, reason, trace: t.result() });
  const sell = side === 'SELL';
  const colour = sell ? 'bearish' : 'bullish';
  /** Records the check and returns whether it really passed (Tracer.step keeps going in verbose mode; stage decisions must not). */
  const must = (name: string, pass: boolean, detail: () => string): boolean => { t.step(name, pass, detail); return pass; };

  if (aIdx < 1 || aIdx >= cs.length) return done('NO_SWEEP', 'not enough candles for P and A');
  const P = cs[aIdx - 1], A = cs[aIdx];

  // candle data must be usable and finished
  if (!must('P and A valid and closed', validOhlc(P) && validOhlc(A) && !isUnfinished(P) && !isUnfinished(A),
    () => `valid P ${validOhlc(P)}, valid A ${validOhlc(A)}, closed P ${!isUnfinished(P)}, closed A ${!isUnfinished(A)}`)) return done('NO_SWEEP', t.result().failed!);

  // Candle A: the original sweep definition
  if (!checkSweep(t, side, P, A, p)) return done('NO_SWEEP', t.result().failed ?? 'sweep failed');

  const bIdx = aIdx + 1, cIdx = aIdx + 2;
  const confirm = (label: 'B' | 'C', q: Candle): boolean => {
    const an = anatomy(q);
    const dirOk = sell ? q.close < q.open : q.close > q.open;
    const a1 = must(`${label} closed ${colour}`, dirOk,
      () => `${label}.close ${fmt(q.close)} ${sell ? '<' : '>'} ${label}.open ${fmt(q.open)}${q.close === q.open ? ' (doji)' : ''}`);
    if (!a1) return false;
    if (p.minConfirmBodyRatio > 0) {
      return must(`${label} body ratio`, geq(an.bodyRatio, p.minConfirmBodyRatio),
        () => `body/range ${fmt(an.bodyRatio)} >= ${fmt(p.minConfirmBodyRatio)}`);
    }
    return true;
  };

  if (bIdx >= cs.length) return done('AWAITING_B', 'A swept; B has not closed yet');
  const B = cs[bIdx];
  if (!must('B valid and closed', validOhlc(B) && !isUnfinished(B), () => `valid ${validOhlc(B)}, closed ${!isUnfinished(B)}`)) {
    return done(isUnfinished(B) ? 'AWAITING_B' : 'INVALIDATED', isUnfinished(B) ? 'B is still forming' : 'B has invalid OHLC');
  }
  if (!confirm('B', B)) return done('INVALIDATED', `B did not close ${colour}`);

  if (cIdx >= cs.length) return done('AWAITING_C', 'B confirmed; C has not closed yet');
  const C = cs[cIdx];
  if (!must('C valid and closed', validOhlc(C) && !isUnfinished(C), () => `valid ${validOhlc(C)}, closed ${!isUnfinished(C)}`)) {
    return done(isUnfinished(C) ? 'AWAITING_C' : 'INVALIDATED', isUnfinished(C) ? 'C is still forming' : 'C has invalid OHLC');
  }
  if (!confirm('C', C)) return done('INVALIDATED', `C did not close ${colour}`);

  if (p.requireContiguousTimes) {
    if (!must('P, A, B, C are consecutive candles', contiguous([P, A, B, C]), () => `times ${[P, A, B, C].map((x) => x.time).join(', ')}`)) {
      return done('INVALIDATED', 'candles are not consecutive (missing, duplicated or out-of-order candle)');
    }
  }
  return done('CONFIRMED', `A swept, B and C closed ${colour}`);
}

/** The engine. Signal candle = i = candle C (the second confirmation). Trade = the next candle's open. */
export function detectContinuationSignal(cs: Candle[], i: number, p: ContinuationParams = CONTINUATION_DEFAULTS): ContinuationSignal | null {
  if (i < 3 || i >= cs.length) return null;
  for (const side of ['SELL', 'BUY'] as const) {
    const e = sequenceState(cs, i - 2, side, p, false);
    if (e.state !== 'CONFIRMED') continue;
    const full = sequenceState(cs, i - 2, side, p, true);          // verbose pass only for the (rare) accepted setups
    const [prior, a, b, c] = [cs[i - 3], cs[i - 2], cs[i - 1], cs[i]];
    return {
      engine: 'continuation', patternId: 'SWEEP_CONTINUATION', side, signalIndex: i, signalTime: c.time, aIndex: i - 2,
      sweptLevel: sweptLevel(side, prior), entryReference: c.close, prior, a, b, c,
      reasons: full.trace.checks.filter((x) => x.pass).map((x) => `${x.name}: ${x.detail}`),
    };
  }
  return null;
}

/** Full arithmetic for both directions at candle i, including why each one failed. For logs and the backtest trace. */
export function explainContinuation(cs: Candle[], i: number, p: ContinuationParams = CONTINUATION_DEFAULTS): { sell: ContinuationEval; buy: ContinuationEval } {
  return { sell: sequenceState(cs, i - 2, 'SELL', p, true), buy: sequenceState(cs, i - 2, 'BUY', p, true) };
}
