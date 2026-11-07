// Renders a setup as an SVG chart in the style of the marked "Valid Buy / Sell Setup" screenshots.
// The chart ends at the candle that just closed: exactly what the engine saw (no future candles).
import type { EngineName } from './sweepEngines';

export interface AlertChartOptions {
  engine: EngineName;
  side: 'BUY' | 'SELL';
  ok: boolean;
  swept_level: number;
  tf: number;
  market: string;
  symbol: string;
  block?: string | null;
  notes?: string[];
  /** how many candles (ending at the last one) belong to the pattern: sweep 2, momentum 3, continuation 4 */
  patternLen: number;
}

const W = 1168, H = 784;
const GREEN = '#3cb54f', RED = '#e8202e', AMBER = '#f5b942';
const BG = '#030a1a', GRID = '#1b2742', TXT = '#ffffff', DIM = '#8a96b4';
const FONT = "Inter, 'Segoe UI', Arial, Helvetica, sans-serif";
const L = 118, R = 1128, T = 168, B = 686;
const TRAIL = 3;                       // empty slots to the right: room for the "next candle" arrow

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad2 = (v: number) => String(v).padStart(2, '0');

export function alertTitle(o: Pick<AlertChartOptions, 'engine' | 'side' | 'ok'>): string {
  const buy = o.side === 'BUY';
  const s = buy ? 'Buy' : 'Sell';
  const col = buy ? 'Green' : 'Red';
  if (o.engine === 'sweep') return o.ok ? `Valid ${s} Setup \u2013 Liquidity Sweep of Prior ${buy ? 'Low' : 'High'}` : `Skipped ${s} Setup \u2013 Sweep of Prior ${buy ? 'Low' : 'High'}`;
  if (o.engine === 'continuation') return o.ok ? `Valid ${s} Continuation \u2013 Sweep + 2 ${col} Candles` : `Skipped ${s} Continuation`;
  return `Valid ${s} Momentum \u2013 3 ${col} Candles, Body Dominance`;
}

export function alertRule(o: Pick<AlertChartOptions, 'engine' | 'side'>): string {
  const buy = o.side === 'BUY';
  if (o.engine === 'sweep') return buy ? "Wick pokes below the red candle's low, body stays above it, closes green" : "Wick pokes above the green candle's high, body stays below it, closes red";
  if (o.engine === 'continuation') return buy ? 'Green candle sweeps the low of a red one, then 2 more green closes. BUY at the next candle open' : 'Red candle sweeps the high of a green one, then 2 more red closes. SELL at the next candle open';
  return buy ? '3 green candles in a row, at least 2 with big bodies and small wicks. BUY at the next candle open' : '3 red candles in a row, at least 2 with big bodies and small wicks. SELL at the next candle open';
}

export function renderAlertSvg(
  candles: Array<{ time: number; open: number; high: number; low: number; close: number }>,
  o: AlertChartOptions,
): string {
  const cs = candles.slice(-16);
  const n = cs.length;
  if (n === 0) return '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>';

  const slots = n + TRAIL;
  const slot = (R - L) / slots;
  const bw = slot * 0.56;
  const buy = o.side === 'BUY';
  const colour = o.ok ? (buy ? GREEN : RED) : AMBER;

  const lo = Math.min(...cs.map((c) => c.low));
  const hi = Math.max(...cs.map((c) => c.high));
  const span = Math.max(hi - lo, Math.abs(hi) * 1e-6, 1e-9);
  const sweepArrowOnCandle = o.engine === 'sweep';
  const [topPad, botPad] = sweepArrowOnCandle ? (buy ? [0.08, 0.22] : [0.22, 0.08]) : [0.12, 0.12];
  const ymin = lo - span * botPad, ymax = hi + span * topPad;
  const y = (p: number) => B - ((p - ymin) / (ymax - ymin)) * (B - T);
  const x = (i: number) => L + slot * (i + 0.5);
  const dec = hi >= 1000 ? 2 : hi >= 100 ? 3 : hi >= 10 ? 4 : 5;
  const hhmm = (e: number) => {
    const d = new Date(e * 1000);
    return o.tf < 60 ? `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}` : `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  };

  const s: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">`,
    `<rect width="${W}" height="${H}" fill="${BG}"/>`,
  ];

  for (let k = 0; k < 9; k++) {
    const p = ymin + ((ymax - ymin) * k) / 8, yy = y(p);
    s.push(`<line x1="${L}" y1="${yy.toFixed(1)}" x2="${R}" y2="${yy.toFixed(1)}" stroke="${GRID}" stroke-width="1.5" stroke-dasharray="7 7"/>`);
    s.push(`<text x="${L - 12}" y="${(yy + 6).toFixed(1)}" fill="${DIM}" font-size="19" text-anchor="end">${p.toFixed(dec)}</text>`);
  }
  const step = Math.max(1, Math.round(n / 8));
  for (let i = 0; i < n; i += step) {
    const xx = x(i);
    s.push(`<line x1="${xx.toFixed(1)}" y1="${T}" x2="${xx.toFixed(1)}" y2="${B}" stroke="${GRID}" stroke-width="1.5" stroke-dasharray="7 7"/>`);
    s.push(`<text x="${xx.toFixed(1)}" y="${B + 34}" fill="${DIM}" font-size="19" text-anchor="middle">${hhmm(cs[i].time)}</text>`);
  }

  // index of the swept candle (the one whose extreme was taken) and of the sweeper
  const patternLen = Math.min(Math.max(o.patternLen, 2), n);
  const first = n - patternLen;                                   // first candle of the pattern
  const sweptIdx = o.engine === 'momentum' ? -1 : (o.engine === 'sweep' ? n - 2 : n - 4);
  const sweeperIdx = o.engine === 'momentum' ? -1 : sweptIdx + 1;

  const frame = (i: number, stroke: string, op = 0.8) => {
    const c = cs[i];
    s.push(`<rect x="${(x(i) - slot * 0.42).toFixed(1)}" y="${(y(c.high) - 8).toFixed(1)}" width="${(slot * 0.84).toFixed(1)}" height="${(y(c.low) - y(c.high) + 16).toFixed(1)}" rx="6" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-dasharray="4 5" opacity="${op}"/>`);
  };

  if (sweptIdx >= 0 && sweptIdx < n - 1) {
    const yl = y(o.swept_level);
    const x0 = x(sweptIdx) - slot * 0.5, x1 = x(n - 1) + slot * 0.9;
    s.push(`<line x1="${x0.toFixed(1)}" y1="${yl.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${yl.toFixed(1)}" stroke="${AMBER}" stroke-width="2.5" stroke-dasharray="3 6"/>`);
    s.push(`<text x="${(x1 + 8).toFixed(1)}" y="${(yl + 6).toFixed(1)}" fill="${AMBER}" font-size="18" font-weight="700">${buy ? 'swept low' : 'swept high'} ${o.swept_level.toFixed(dec)}</text>`);
    frame(sweptIdx, DIM, 0.7);
    if (sweeperIdx >= 0 && o.engine === 'continuation') frame(sweeperIdx, AMBER, 0.9);
  }
  if (o.engine === 'momentum') {
    const top = y(Math.max(...cs.slice(first).map((c) => c.high))) - 10, bot = Math.max(...cs.slice(first).map((c) => y(c.low))) + 10;
    s.push(`<rect x="${(x(first) - slot * 0.46).toFixed(1)}" y="${top.toFixed(1)}" width="${(x(n - 1) - x(first) + slot * 0.92).toFixed(1)}" height="${(bot - top).toFixed(1)}" rx="8" fill="none" stroke="${colour}" stroke-width="2" stroke-dasharray="6 6" opacity=".85"/>`);
  }

  for (let i = 0; i < n; i++) {
    const c = cs[i], col = c.close >= c.open ? GREEN : RED, xx = x(i);
    const top = y(Math.max(c.open, c.close)), bot = y(Math.min(c.open, c.close));
    s.push(`<line x1="${xx.toFixed(1)}" y1="${y(c.high).toFixed(1)}" x2="${xx.toFixed(1)}" y2="${y(c.low).toFixed(1)}" stroke="${col}" stroke-width="3"/>`);
    s.push(`<rect x="${(xx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(bot - top, 2).toFixed(1)}" fill="${col}"/>`);
  }

  // small step labels under the candles of a continuation pattern
  if (o.engine === 'continuation') {
    const labels: Array<[number, string]> = [[n - 4, 'prior'], [n - 3, 'sweep'], [n - 2, '+1'], [n - 1, '+2']];
    for (const [i, t] of labels) if (i >= 0) s.push(`<text x="${x(i).toFixed(1)}" y="${(B - 10).toFixed(1)}" fill="${i >= n - 2 ? colour : AMBER}" font-size="16" font-weight="700" text-anchor="middle">${t}</text>`);
  }

  const sig = cs[n - 1];
  const label = (t: string) => `${t}${o.ok ? '' : ' (skipped)'}`;
  if (sweepArrowOnCandle) {
    const ax = x(n - 1);
    if (buy) {
      const tip = y(sig.low) + 26;
      s.push(`<path d="M${ax.toFixed(1)} ${tip.toFixed(1)} l-20 28 h13 v34 h14 v-34 h13 z" fill="${colour}"/>`);
      s.push(`<text x="${ax.toFixed(1)}" y="${(tip + 100).toFixed(1)}" fill="${colour}" font-size="30" font-weight="800" text-anchor="middle">${label('BUY')}</text>`);
    } else {
      const tip = y(sig.high) - 26;
      s.push(`<path d="M${ax.toFixed(1)} ${tip.toFixed(1)} l-20 -28 h13 v-34 h14 v34 h13 z" fill="${colour}"/>`);
      s.push(`<text x="${ax.toFixed(1)}" y="${(tip - 72).toFixed(1)}" fill="${colour}" font-size="30" font-weight="800" text-anchor="middle">${label('SELL')}</text>`);
    }
  } else {
    // the trade opens on the NEXT candle: the arrow sits in the empty slot where that candle will open
    const ax = x(n), cy = y(sig.close);
    s.push(`<line x1="${x(n - 1).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${ax.toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${colour}" stroke-width="2" stroke-dasharray="3 6" opacity=".6"/>`);
    if (buy) {
      const tip = cy - 40;                      // arrow points UP, label above
      s.push(`<path d="M${ax.toFixed(1)} ${tip.toFixed(1)} l-20 28 h13 v34 h14 v-34 h13 z" fill="${colour}"/>`);
      s.push(`<text x="${ax.toFixed(1)}" y="${(tip - 34).toFixed(1)}" fill="${colour}" font-size="26" font-weight="800" text-anchor="middle">${label('BUY')}</text>`);
      s.push(`<text x="${ax.toFixed(1)}" y="${(tip - 10).toFixed(1)}" fill="${DIM}" font-size="17" text-anchor="middle">next open</text>`);
    } else {
      const tip = cy + 40;                      // arrow points DOWN, label below
      s.push(`<path d="M${ax.toFixed(1)} ${tip.toFixed(1)} l-20 -28 h13 v-34 h14 v34 h13 z" fill="${colour}"/>`);
      s.push(`<text x="${ax.toFixed(1)}" y="${(tip + 34).toFixed(1)}" fill="${colour}" font-size="26" font-weight="800" text-anchor="middle">${label('SELL')}</text>`);
      s.push(`<text x="${ax.toFixed(1)}" y="${(tip + 58).toFixed(1)}" fill="${DIM}" font-size="17" text-anchor="middle">next open</text>`);
    }
  }

  s.push(`<text x="${W / 2}" y="58" fill="${o.ok ? TXT : colour}" font-size="38" font-weight="700" text-anchor="middle">${esc(alertTitle(o))}</text>`);
  const when = new Date(sig.time * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const tfl = o.tf < 60 ? `${o.tf}s` : `${Math.floor(o.tf / 60)}m`;
  s.push(`<text x="${W / 2}" y="98" fill="${DIM}" font-size="23" text-anchor="middle">${esc(o.market)} \u00b7 ${esc(o.symbol)} \u00b7 ${tfl} \u00b7 last closed candle ${when}</text>`);
  const notes = (o.notes ?? []).filter((t) => !/next candle open/.test(t));
  const why = o.ok ? (notes.join(', ') || 'confirmed') : (o.block || 'context check failed');
  s.push(`<text x="${W / 2}" y="132" fill="${colour}" font-size="${why.length > 80 ? 18 : 22}" font-weight="600" text-anchor="middle">${o.ok ? 'TAKE' : 'SKIP'}: ${esc(why)}</text>`);
  s.push(`<text x="${L}" y="${H - 22}" fill="${DIM}" font-size="19">${esc(alertRule(o))}</text>`);
  s.push('</svg>');
  return s.join('\n');
}
