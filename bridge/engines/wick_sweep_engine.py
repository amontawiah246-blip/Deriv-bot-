"""Wick sweep engine: deterministic signal detection. (Vendored unchanged from wick_sweep_engine.zip, wick_sweep/engine.py.)

Rules (ported 1:1 from the live demo):

  BUY pattern on closed candle ``i`` (``sw`` = candle ``i-1``):
    1. ``sw`` is bearish; ``cur`` is bullish (closes above its own open).
    2. ``cur.low`` trades below ``sw.low`` (the sweep).
    3. ``cur``'s BODY stays at or above ``sw.low`` (wick sweep only).

  Context check over the zone ``cs[i-1-lookback : i]`` (``lookback + 1`` candles):
    * Evidence that buyers "tried": count candles with a long lower wick,
      a strong bullish body, or a low swept and bought back. Need >= min_evidence.
    * Seller control: fraction of zone candles that are strong bearish bodies
      closing near their low, +0.25 if the swept candle itself is a marubozu-like
      bearish candle. Must be <= max_strength.

  SELL is the BUY logic run on mirrored (price-negated) candles.

Signals are produced on CLOSED candles only. No look-ahead: ``detect`` reads
``candles[i-lookback-2 : i+1]`` and nothing after ``i``.
"""
from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass
from enum import Enum
from typing import Deque, Iterable, List, Optional, Sequence, Tuple

_EPS = 1e-12


_SELL_NOTES = {"low swept and bought back": "high swept and sold back"}


class Side(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


@dataclass(frozen=True)
class Candle:
    time: str
    o: float
    h: float
    l: float
    c: float

    def validate(self) -> None:
        vals = (self.o, self.h, self.l, self.c)
        if not all(math.isfinite(v) for v in vals):
            raise ValueError(f"non-finite price in candle at {self.time}: {vals}")
        if self.h < max(self.o, self.c) or self.l > min(self.o, self.c) or self.h < self.l:
            raise ValueError(f"inconsistent OHLC at {self.time}: {vals}")

    def mirrored(self) -> "Candle":
        return Candle(self.time, -self.o, -self.l, -self.h, -self.c)

    @property
    def range(self) -> float:
        return max(self.h - self.l, _EPS)


@dataclass(frozen=True)
class Params:
    lookback: int = 6          # zone = lookback + 1 candles ending at the swept candle
    min_evidence: int = 2      # minimum "tried" candles in the zone
    max_strength: float = 0.5  # maximum opposing control score
    strong_body: float = 0.6   # body/range that counts as a strong candle
    wick_ratio: float = 0.4    # wick/range that counts as a rejection wick

    def __post_init__(self) -> None:
        if self.lookback < 1:
            raise ValueError("lookback must be >= 1")
        if self.min_evidence < 0:
            raise ValueError("min_evidence must be >= 0")
        for name in ("max_strength", "strong_body", "wick_ratio"):
            v = getattr(self, name)
            if not math.isfinite(v) or v < 0:
                raise ValueError(f"{name} must be a finite number >= 0")

    @property
    def window(self) -> int:
        """Candles needed before a signal is evaluated: zone + sweeper + one warm-up
        candle (kept from the demo, which starts at index lookback + 2)."""
        return self.lookback + 3


@dataclass(frozen=True)
class Signal:
    index: int            # index of the sweeper (signal) candle in the series
    time: str
    side: Side
    ok: bool              # passes the context check
    block: Optional[str]  # reason when ok is False
    notes: Tuple[str, ...]
    entry: float          # close of the signal candle (reference entry price)
    swept_level: float    # the swept extreme (low for BUY, high for SELL), real prices


def _check_long(cs: Sequence[Candle], p: Params) -> Optional[Tuple[bool, Optional[str], Tuple[str, ...]]]:
    """Long-side check on the LAST candle of ``cs`` (already mirrored for SELL).

    Returns None if the sweep pattern is absent, else (ok, block_reason, notes).
    """
    i = len(cs) - 1
    if i < p.window - 1:
        return None
    cur, sw = cs[i], cs[i - 1]
    if not (sw.c < sw.o and cur.c > cur.o):
        return None
    if not (cur.l < sw.l):
        return None
    if min(cur.o, cur.c) < sw.l:
        return None

    zone = cs[i - 1 - p.lookback: i]
    tried = 0
    firm = 0
    notes: List[str] = []
    for k, c in enumerate(zone):
        pv = zone[k - 1] if k else zone[0]
        r = c.range
        lw = (min(c.o, c.c) - c.l) / r
        body = abs(c.c - c.o) / r
        if lw >= p.wick_ratio:
            tried += 1
            notes.append("wick rejection")
        elif c.c > c.o and body >= p.strong_body:
            tried += 1
            notes.append("strong push")
        elif c.l < pv.l and c.c > pv.c:
            tried += 1
            notes.append("low swept and bought back")
        if c.c < c.o and body >= p.strong_body and c.c <= c.l + 0.2 * r:
            firm += 1

    strength = firm / len(zone)
    sw_r = sw.range
    if abs(sw.c - sw.o) / sw_r >= 0.8 and sw.c <= sw.l + 0.1 * sw_r:
        strength += 0.25

    if tried < p.min_evidence:
        return False, "initiating side never really tried", tuple(notes)
    if strength > p.max_strength:
        return False, "opposing side still in firm control", tuple(notes)
    return True, None, tuple(notes)


def detect(candles: Sequence[Candle], i: int, params: Params = Params()) -> Optional[Signal]:
    """Evaluate candle ``i`` (must be closed). Reads only candles[i-window+1 : i+1]."""
    if i < 0 or i >= len(candles):
        raise IndexError(f"candle index {i} out of range")
    w = params.window
    if i < w - 1:
        return None
    win = candles[i - w + 1: i + 1]

    res = _check_long(win, params)
    if res is not None:
        ok, block, notes = res
        return Signal(i, candles[i].time, Side.BUY, ok, block, notes, candles[i].c, win[-2].l)

    res = _check_long([c.mirrored() for c in win], params)
    if res is not None:
        ok, block, notes = res
        notes = tuple(_SELL_NOTES.get(n, n) for n in notes)
        return Signal(i, candles[i].time, Side.SELL, ok, block, notes, candles[i].c, win[-2].h)
    return None


def scan(candles: Sequence[Candle], params: Params = Params()) -> List[Signal]:
    """Batch scan: every signal (context-passing and context-blocked) in order."""
    for c in candles:
        c.validate()
    out: List[Signal] = []
    for i in range(params.window - 1, len(candles)):
        s = detect(candles, i, params)
        if s is not None:
            out.append(s)
    return out


class WickSweepEngine:
    """Streaming engine: feed CLOSED candles one at a time.

    Produces exactly the same signals as ``scan`` over the same series.
    """

    def __init__(self, params: Params = Params()) -> None:
        self.params = params
        self._buf: Deque[Candle] = deque(maxlen=params.window)
        self._n = 0

    def on_candle(self, candle: Candle) -> Optional[Signal]:
        candle.validate()
        self._buf.append(candle)
        idx = self._n
        self._n += 1
        if len(self._buf) < self.params.window:
            return None
        win = list(self._buf)
        s = detect(win, len(win) - 1, self.params)
        if s is None:
            return None
        return Signal(idx, s.time, s.side, s.ok, s.block, s.notes, s.entry, s.swept_level)

    def feed(self, candles: Iterable[Candle]) -> List[Signal]:
        out: List[Signal] = []
        for c in candles:
            s = self.on_candle(c)
            if s is not None:
                out.append(s)
        return out
