export function renderAlertSvg(
  candles: Array<{ time: number; open: number; high: number; low: number; close: number }>,
  options: {
    side: 'BUY' | 'SELL';
    ok: boolean;
    swept_level: number;
    tf: number;
    market: string;
    symbol: string;
    block?: string | null;
    notes?: string[];
  }
): string {
  const maxCandles = 16;
  const cs = candles.slice(-maxCandles);
  const n = cs.length;
  if (n === 0) return '<svg width="100" height="100"></svg>';

  const W = 1168, H = 784;
  const GREEN = '#3cb54f', RED = '#e8202e', AMBER = '#f5b942';
  const BG = '#030a1a', GRID = '#1b2742', TXT = '#ffffff', DIM = '#8a96b4';
  const FONT = "Inter, 'Segoe UI', Arial, Helvetica, sans-serif";
  const L = 118, R = 1128, T = 168, B = 686;
  const TRAIL = 3;

  const slots = n + TRAIL;
  const slot = (R - L) / slots;
  const bw = slot * 0.56;
  const buy = options.side === 'BUY';
  const colourCode = options.ok ? (buy ? GREEN : RED) : AMBER;

  let lo = Math.min(...cs.map(c => c.low));
  let hi = Math.max(...cs.map(c => c.high));
  const span = Math.max(hi - lo, Math.abs(hi) * 1e-6, 1e-9);

  const [topPad, botPad] = buy ? [0.08, 0.22] : [0.22, 0.08];
  const ymin = lo - span * botPad;
  const ymax = hi + span * topPad;

  const y = (p: number) => B - ((p - ymin) / (ymax - ymin)) * (B - T);
  const x = (i: number) => L + slot * (i + 0.5);
  const dec = hi >= 1000 ? 2 : hi >= 100 ? 3 : hi >= 10 ? 4 : 5;

  const formatHhmm = (epoch: number, tf: number) => {
    const d = new Date(epoch * 1000);
    const pad = (v: number) => String(v).padStart(2, '0');
    return tf < 60
      ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
      : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  };

  const title = options.ok
    ? `Valid ${buy ? 'Buy' : 'Sell'} Setup – Liquidity Sweep of Prior ${buy ? 'Low' : 'High'}`
    : `Skipped ${buy ? 'Buy' : 'Sell'} Setup – Sweep of Prior ${buy ? 'Low' : 'High'}`;

  const escapeHtml = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const o: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">`,
    `<rect width="${W}" height="${H}" fill="${BG}"/>`
  ];

  for (let k = 0; k < 9; k++) {
    const p = ymin + ((ymax - ymin) * k) / 8;
    const yy = y(p);
    o.push(`<line x1="${L}" y1="${yy.toFixed(1)}" x2="${R}" y2="${yy.toFixed(1)}" stroke="${GRID}" stroke-width="1.5" stroke-dasharray="7 7"/>`);
    o.push(`<text x="${L - 12}" y="${(yy + 6).toFixed(1)}" fill="${DIM}" font-size="19" text-anchor="end">${p.toFixed(dec)}</text>`);
  }

  const step = Math.max(1, Math.round(n / 8));
  for (let i = 0; i < n; i += step) {
    const xx = x(i);
    o.push(`<line x1="${xx.toFixed(1)}" y1="${T}" x2="${xx.toFixed(1)}" y2="${B}" stroke="${GRID}" stroke-width="1.5" stroke-dasharray="7 7"/>`);
    o.push(`<text x="${xx.toFixed(1)}" y="${B + 34}" fill="${DIM}" font-size="19" text-anchor="middle">${formatHhmm(cs[i].time, options.tf)}</text>`);
  }

  if (n >= 2) {
    const yl = y(options.swept_level);
    const x0 = x(n - 2) - slot * 0.5;
    const x1 = x(n - 1) + slot * 0.9;
    o.push(`<line x1="${x0.toFixed(1)}" y1="${yl.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${yl.toFixed(1)}" stroke="${AMBER}" stroke-width="2.5" stroke-dasharray="3 6"/>`);
    o.push(`<text x="${(x1 + 8).toFixed(1)}" y="${(yl + 6).toFixed(1)}" fill="${AMBER}" font-size="18" font-weight="700">${buy ? 'swept low' : 'swept high'} ${options.swept_level.toFixed(dec)}</text>`);

    const sc = cs[n - 2];
    o.push(`<rect x="${(x(n - 2) - slot * 0.42).toFixed(1)}" y="${(y(sc.high) - 8).toFixed(1)}" width="${(slot * 0.84).toFixed(1)}" height="${(y(sc.low) - y(sc.high) + 16).toFixed(1)}" rx="6" fill="none" stroke="${DIM}" stroke-width="1.5" stroke-dasharray="4 5" opacity=".7"/>`);
  }

  for (let i = 0; i < n; i++) {
    const c = cs[i];
    const isUp = c.close >= c.open;
    const col = isUp ? GREEN : RED;
    const xx = x(i);
    const top = y(Math.max(c.open, c.close));
    const bot = y(Math.min(c.open, c.close));
    o.push(`<line x1="${xx.toFixed(1)}" y1="${y(c.high).toFixed(1)}" x2="${xx.toFixed(1)}" y2="${y(c.low).toFixed(1)}" stroke="${col}" stroke-width="3"/>`);
    o.push(`<rect x="${(xx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(bot - top, 2).toFixed(1)}" fill="${col}"/>`);
  }

  const sig = cs[n - 1];
  const ax = x(n - 1);
  if (buy) {
    const tip = y(sig.low) + 26;
    o.push(`<path d="M${ax.toFixed(1)} ${tip.toFixed(1)} l-20 28 h13 v34 h14 v-34 h13 z" fill="${colourCode}"/>`);
    o.push(`<text x="${ax.toFixed(1)}" y="${(tip + 100).toFixed(1)}" fill="${colourCode}" font-size="30" font-weight="800" text-anchor="middle">BUY${options.ok ? '' : ' (skipped)'}</text>`);
  } else {
    const tip = y(sig.high) - 26;
    o.push(`<path d="M${ax.toFixed(1)} ${tip.toFixed(1)} l-20 -28 h13 v-34 h14 v34 h13 z" fill="${colourCode}"/>`);
    o.push(`<text x="${ax.toFixed(1)}" y="${(tip - 72).toFixed(1)}" fill="${colourCode}" font-size="30" font-weight="800" text-anchor="middle">SELL${options.ok ? '' : ' (skipped)'}</text>`);
  }

  o.push(`<text x="${W / 2}" y="58" fill="${options.ok ? TXT : colourCode}" font-size="40" font-weight="700" text-anchor="middle">${escapeHtml(title)}</text>`);
  const when = new Date(sig.time * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const tfl = options.tf < 60 ? `${options.tf}s` : `${Math.floor(options.tf / 60)}m`;
  o.push(`<text x="${W / 2}" y="98" fill="${DIM}" font-size="23" text-anchor="middle">${escapeHtml(options.market)} · ${escapeHtml(options.symbol)} · ${tfl} · signal candle ${when}</text>`);

  const why = options.ok ? (options.notes && options.notes.length > 0 ? options.notes.join(', ') : 'sweep confirmed') : (options.block || 'context check failed');
  o.push(`<text x="${W / 2}" y="132" fill="${colourCode}" font-size="22" font-weight="600" text-anchor="middle">${options.ok ? 'TAKE' : 'SKIP'}: ${escapeHtml(why)}</text>`);

  const rule = buy
    ? "BUY SIGNAL: Green candle sweeps low of red, or equal lows wick sweep (body closes inside)"
    : "SELL SIGNAL: Red candle sweeps high of green, or equal highs wick sweep (body closes inside)";
  o.push(`<text x="${L}" y="${H - 22}" fill="${DIM}" font-size="19">${rule}</text>`);

  o.push('</svg>');
  return o.join('\n');
}
