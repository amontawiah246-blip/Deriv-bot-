"""Renders a wick-sweep alert as an SVG chart in the style of the marked "Valid Buy / Sell Setup" screenshots.

Pure standard library (no matplotlib / Pillow), so it runs anywhere the bridge runs. The browser shows the SVG in an <img>.
The chart ends at the signal candle: that is exactly what the engine saw when it fired (no future candles).
"""
from __future__ import annotations
from datetime import datetime, timezone
from html import escape

W, H = 1168, 784
GREEN, RED, AMBER = "#3cb54f", "#e8202e", "#f5b942"
BG, GRID, TXT, DIM = "#030a1a", "#1b2742", "#ffffff", "#8a96b4"
FONT = "Inter, 'Segoe UI', Arial, Helvetica, sans-serif"
L, R, T, B = 118, 1128, 168, 686            # plot box
TRAIL = 3                                    # empty slots to the right of the signal candle (room for the arrow)


def _dec(p: float) -> int:
    return 2 if p >= 1000 else 3 if p >= 100 else 4 if p >= 10 else 5


def _hhmm(epoch: int, tf: int) -> str:
    d = datetime.fromtimestamp(int(epoch), timezone.utc)
    return d.strftime("%H:%M:%S") if tf < 60 else d.strftime("%H:%M")


def title_for(side: str, ok: bool) -> str:
    low = side == "BUY"
    if ok:
        return f"Valid {'Buy' if low else 'Sell'} Setup \u2013 Liquidity Sweep of Prior {'Low' if low else 'High'}"
    return f"Skipped {'Buy' if low else 'Sell'} Setup \u2013 Sweep of Prior {'Low' if low else 'High'}"


def render_alert_svg(candles: list[dict], *, side: str, ok: bool, swept_level: float, tf: int,
                     market: str, symbol: str, block: str | None = None, notes: tuple | list = (),
                     max_candles: int = 16) -> str:
    """candles: [{time,open,high,low,close}] oldest first; the LAST one is the signal candle, the one before it is the swept candle."""
    cs = candles[-max_candles:]
    n = len(cs)
    slots = n + TRAIL
    slot = (R - L) / slots
    bw = slot * 0.56
    buy = side == "BUY"
    colour = (GREEN if buy else RED) if ok else AMBER

    lo = min(c["low"] for c in cs)
    hi = max(c["high"] for c in cs)
    span = max(hi - lo, abs(hi) * 1e-6, 1e-9)
    # extra headroom on the arrow side so the arrow + label never sits on a candle
    top_pad, bot_pad = (0.08, 0.22) if buy else (0.22, 0.08)
    ymin, ymax = lo - span * bot_pad, hi + span * top_pad
    y = lambda p: B - (p - ymin) / (ymax - ymin) * (B - T)
    x = lambda i: L + slot * (i + 0.5)
    d = _dec(hi)

    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="{FONT}">',
         f'<rect width="{W}" height="{H}" fill="{BG}"/>']

    # grid + price axis
    for k in range(9):
        p = ymin + (ymax - ymin) * k / 8
        yy = y(p)
        o.append(f'<line x1="{L}" y1="{yy:.1f}" x2="{R}" y2="{yy:.1f}" stroke="{GRID}" stroke-width="1.5" stroke-dasharray="7 7"/>')
        o.append(f'<text x="{L - 12}" y="{yy + 6:.1f}" fill="{DIM}" font-size="19" text-anchor="end">{p:.{d}f}</text>')
    step = max(1, round(n / 8))
    for i in range(0, n, step):
        xx = x(i)
        o.append(f'<line x1="{xx:.1f}" y1="{T}" x2="{xx:.1f}" y2="{B}" stroke="{GRID}" stroke-width="1.5" stroke-dasharray="7 7"/>')
        o.append(f'<text x="{xx:.1f}" y="{B + 34}" fill="{DIM}" font-size="19" text-anchor="middle">{_hhmm(cs[i]["time"], tf)}</text>')

    # swept level line, from the swept candle to the right edge of the signal candle
    if n >= 2:
        yl = y(swept_level)
        x0, x1 = x(n - 2) - slot * 0.5, x(n - 1) + slot * 0.9
        o.append(f'<line x1="{x0:.1f}" y1="{yl:.1f}" x2="{x1:.1f}" y2="{yl:.1f}" stroke="{AMBER}" stroke-width="2.5" stroke-dasharray="3 6"/>')
        o.append(f'<text x="{x1 + 8:.1f}" y="{yl + 6:.1f}" fill="{AMBER}" font-size="18" font-weight="700">'
                 f'{"swept low" if buy else "swept high"} {swept_level:.{d}f}</text>')
        # soft frame round the swept candle
        sc = cs[-2]
        o.append(f'<rect x="{x(n - 2) - slot * 0.42:.1f}" y="{y(sc["high"]) - 8:.1f}" width="{slot * 0.84:.1f}" '
                 f'height="{y(sc["low"]) - y(sc["high"]) + 16:.1f}" rx="6" fill="none" stroke="{DIM}" stroke-width="1.5" stroke-dasharray="4 5" opacity=".7"/>')

    # candles
    for i, c in enumerate(cs):
        up = c["close"] >= c["open"]
        col = GREEN if up else RED
        xx = x(i)
        top, bot = y(max(c["open"], c["close"])), y(min(c["open"], c["close"]))
        o.append(f'<line x1="{xx:.1f}" y1="{y(c["high"]):.1f}" x2="{xx:.1f}" y2="{y(c["low"]):.1f}" stroke="{col}" stroke-width="3"/>')
        o.append(f'<rect x="{xx - bw / 2:.1f}" y="{top:.1f}" width="{bw:.1f}" height="{max(bot - top, 2):.1f}" fill="{col}"/>')

    # arrow + label under the low (BUY) or over the high (SELL) of the signal candle
    sig = cs[-1]
    ax = x(n - 1)
    if buy:
        tip = y(sig["low"]) + 26
        o.append(f'<path d="M{ax:.1f} {tip:.1f} l-20 28 h13 v34 h14 v-34 h13 z" fill="{colour}"/>')
        o.append(f'<text x="{ax:.1f}" y="{tip + 100:.1f}" fill="{colour}" font-size="30" font-weight="800" text-anchor="middle">BUY{"" if ok else " (skipped)"}</text>')
    else:
        tip = y(sig["high"]) - 26
        o.append(f'<path d="M{ax:.1f} {tip:.1f} l-20 -28 h13 v-34 h14 v34 h13 z" fill="{colour}"/>')
        o.append(f'<text x="{ax:.1f}" y="{tip - 72:.1f}" fill="{colour}" font-size="30" font-weight="800" text-anchor="middle">SELL{"" if ok else " (skipped)"}</text>')

    # header + footer
    o.append(f'<text x="{W / 2}" y="58" fill="{colour if not ok else TXT}" font-size="40" font-weight="700" text-anchor="middle">{escape(title_for(side, ok))}</text>')
    when = datetime.fromtimestamp(int(sig["time"]), timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    tfl = f"{tf}s" if tf < 60 else f"{tf // 60}m"
    o.append(f'<text x="{W / 2}" y="98" fill="{DIM}" font-size="23" text-anchor="middle">{escape(market)} \u00b7 {escape(symbol)} \u00b7 {tfl} \u00b7 signal candle {when}</text>')
    why = block if not ok else ", ".join(dict.fromkeys(notes)) or "sweep confirmed"
    o.append(f'<text x="{W / 2}" y="132" fill="{colour}" font-size="22" font-weight="600" text-anchor="middle">'
             f'{"TAKE" if ok else "SKIP"}: {escape(why or "")}</text>')
    rule = ("Wick pokes below the red candle's low, body stays above it, closes green" if buy
            else "Wick pokes above the green candle's high, body stays below it, closes red")
    o.append(f'<text x="{L}" y="{H - 22}" fill="{DIM}" font-size="19">{rule}</text>')
    o.append("</svg>")
    return "\n".join(o)
