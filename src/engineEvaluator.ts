import { detectContinuation, detectMomentum, detectWickSweep } from './sweepEngines';

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface EngineResultData {
  status: string;
  state: string;
  setup: boolean;
  side: 'BUY' | 'SELL' | null;
  confidence: number;
  agree: number;
  candles: number;
  sweep: { side: 'BUY' | 'SELL'; reasons: string[] } | null;
  indicators: { side: 'BUY' | 'SELL'; strategies: string[]; count: number; info: Record<string, number> } | null;
  pattern: { side: 'BUY' | 'SELL'; patterns: string[]; counted: boolean } | null;
  continuation?: { side: 'BUY' | 'SELL'; reasons: string[] } | null;   // sweep + 2 same-colour candles: trade the next open
  momentum?: { side: 'BUY' | 'SELL'; reasons: string[] } | null;       // 3 strong candles in a row: trade the next open
  reasons: string[];
  rsi?: number;
  trend?: string;
}

export function evaluateEngines(candles: CandleData[], tf = 60, minInd = 1): EngineResultData {
  const cs = candles.slice(-300);
  if (cs.length < 30) {
    return {
      status: 'ok',
      state: `need 30 candles, have ${cs.length}`,
      setup: false,
      side: null,
      confidence: 0,
      agree: 0,
      candles: cs.length,
      sweep: null,
      indicators: null,
      pattern: null,
      reasons: ['Not enough market history']
    };
  }

  const lastIdx = cs.length - 1;
  const cur = cs[lastIdx];
  const prev = cs[lastIdx - 1];

  // 1. Wick sweep: your original rule (same code the screenshots use). A sweep the context check SKIPS gets no vote.
  const ws = detectWickSweep(cs, lastIdx);
  const sweep: { side: 'BUY' | 'SELL'; reasons: string[] } | null = ws && ws.ok
    ? { side: ws.side, reasons: [ws.side === 'BUY' ? 'Green candle wicked below the previous low, body held above it' : 'Red candle wicked above the previous high, body stayed below it', ...ws.notes] }
    : null;

  // 1b. Sweep continuation (sweep + 2 same-colour candles) and 1c. momentum (3 strong candles). Both trade the NEXT candle's open.
  const co = detectContinuation(cs, lastIdx);
  const continuation = co && co.ok ? { side: co.side, reasons: co.notes } : null;
  const mo = detectMomentum(cs, lastIdx);
  const momentum = mo ? { side: mo.side, reasons: mo.notes } : null;

  // 2. Technical Indicators Engine (RSI, EMA, Bollinger, CCI)
  let indSide: 'BUY' | 'SELL' | null = null;
  const indStrategies: string[] = [];

  // RSI calculation
  let gains = 0, losses = 0;
  for (let i = lastIdx - 14; i <= lastIdx; i++) {
    const diff = cs[i].close - cs[i - 1].close;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / 14;
  const avgLoss = Math.max(0.00001, losses / 14);
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  if (rsi < 32) {
    indStrategies.push(`RSI Oversold (${rsi.toFixed(1)})`);
    indSide = 'BUY';
  } else if (rsi > 68) {
    indStrategies.push(`RSI Overbought (${rsi.toFixed(1)})`);
    indSide = 'SELL';
  }

  // EMA trend check
  let emaFast = 0, emaSlow = 0;
  for (let i = lastIdx - 12; i <= lastIdx; i++) emaFast += cs[i].close;
  for (let i = lastIdx - 26; i <= lastIdx; i++) emaSlow += cs[i].close;
  emaFast /= 13;
  emaSlow /= 27;

  if (emaFast > emaSlow && cur.close > emaFast) {
    if (!indSide || indSide === 'BUY') {
      indSide = 'BUY';
      indStrategies.push('EMA 13/27 Bullish Crossover');
    }
  } else if (emaFast < emaSlow && cur.close < emaFast) {
    if (!indSide || indSide === 'SELL') {
      indSide = 'SELL';
      indStrategies.push('EMA 13/27 Bearish Crossover');
    }
  }

  const indicators = indStrategies.length > 0 && indSide ? {
    side: indSide,
    strategies: indStrategies,
    count: indStrategies.length,
    info: { rsi: Number(rsi.toFixed(1)), emaFast: Number(emaFast.toFixed(2)), emaSlow: Number(emaSlow.toFixed(2)) }
  } : null;

  // 3. Candlestick Pattern Engine
  let patSide: 'BUY' | 'SELL' | null = null;
  const patterns: string[] = [];
  const range = Math.max(0.00001, cur.high - cur.low);
  const body = Math.abs(cur.close - cur.open);
  const lowerWick = Math.min(cur.open, cur.close) - cur.low;
  const upperWick = cur.high - Math.max(cur.open, cur.close);

  if (lowerWick / range >= 0.6 && body / range <= 0.3) {
    patSide = 'BUY';
    patterns.push('Bullish Pinbar / Hammer');
  } else if (upperWick / range >= 0.6 && body / range <= 0.3) {
    patSide = 'SELL';
    patterns.push('Bearish Shooting Star');
  } else if (prev && cur.close > cur.open && prev.close < prev.open && cur.close > prev.open && cur.open < prev.close) {
    patSide = 'BUY';
    patterns.push('Bullish Engulfing Pattern');
  } else if (prev && cur.close < cur.open && prev.close > prev.open && cur.close < prev.close && cur.open > prev.open) {
    patSide = 'SELL';
    patterns.push('Bearish Engulfing Pattern');
  }

  const pattern = patterns.length > 0 && patSide ? {
    side: patSide,
    patterns: patterns,
    counted: true
  } : null;

  // Decision & Confidence logic
  const agreeSides: string[] = [];
  if (sweep) agreeSides.push(sweep.side);
  if (continuation) agreeSides.push(continuation.side);
  if (momentum) agreeSides.push(momentum.side);
  if (indicators) agreeSides.push(indicators.side);
  if (pattern) agreeSides.push(pattern.side);

  if (agreeSides.length === 0) {
    return {
      status: 'ok',
      state: 'no setup',
      setup: false,
      side: null,
      confidence: 0,
      agree: 0,
      candles: cs.length,
      sweep: null,
      indicators: null,
      pattern: null,
      continuation: null,
      momentum: null,
      reasons: ['Scanning live price action']
    };
  }

  // Determine final side
  const buyVotes = agreeSides.filter(s => s === 'BUY').length;
  const sellVotes = agreeSides.filter(s => s === 'SELL').length;

  if (buyVotes > 0 && sellVotes > 0) {
    return {
      status: 'ok',
      state: 'conflicting signals',
      setup: false,
      side: null,
      confidence: 0,
      agree: 0,
      candles: cs.length,
      sweep,
      indicators,
      pattern,
      continuation,
      momentum,
      reasons: ['Engines disagree on direction']
    };
  }

  const side = buyVotes > 0 ? 'BUY' : 'SELL';
  const agreeCount = agreeSides.length;
  let confidence = 60;
  if (agreeCount === 3) confidence = 85;
  else if (agreeCount === 2) confidence = 75;
  else confidence = 65;

  const reasons: string[] = [];
  if (sweep) reasons.push(`Wick Sweep (${side}): ${sweep.reasons.join(', ')}`);
  if (continuation) reasons.push(`Sweep Continuation (${side}): ${continuation.reasons.join(', ')}`);
  if (momentum) reasons.push(`Momentum (${side}): ${momentum.reasons.join(', ')}`);
  if (indicators) reasons.push(`Indicators (${side}): ${indicators.strategies.join(', ')}`);
  if (pattern) reasons.push(`Pattern (${side}): ${pattern.patterns.join(', ')}`);

  const trend = emaFast > emaSlow ? 'Bullish' : emaFast < emaSlow ? 'Bearish' : 'Consolidating';

  return {
    status: 'ok',
    state: 'setup',
    setup: true,
    side,
    confidence,
    agree: agreeCount,
    candles: cs.length,
    sweep,
    indicators,
    pattern,
    continuation,
    momentum,
    reasons,
    rsi: Number(rsi.toFixed(1)),
    trend
  };
}
