"""Wick-sweep watch: one agent per market, all running the SAME wick sweep engine on CLOSED candles.

The moment a candle closes and the engine sees a setup, the agent renders a chart screenshot (SVG, same look as the marked
"Valid Buy / Sell Setup" images) and stores it as an alert. The app's Menu shows the alerts so you can confirm by eye that the
engine is detecting the right thing.

Both kinds of result are kept, labelled: TAKE (sweep + context check passed) and SKIP (sweep seen, context check said no).
"""
from __future__ import annotations
import asyncio, json, os, time
from dataclasses import dataclass
from typing import Awaitable, Callable, Dict, List, Optional

try:
    from .engines.wick_sweep_engine import Candle, Params, detect
    from .sweep_chart import render_alert_svg
except ImportError:                      # started from inside bridge/ (tests) instead of as bridge.server
    from engines.wick_sweep_engine import Candle, Params, detect
    from sweep_chart import render_alert_svg

# The 16 agents of the Signal Package tab (same symbols and names as SYNTHETIC_AGENTS in src/SignalPackageAgents.tsx).
AGENTS = [
    ("1HZ100V", "Agent Titan-100V", "Volatility 100 (1s) Index"), ("1HZ75V", "Agent Surge-75V", "Volatility 75 (1s) Index"),
    ("1HZ50V", "Agent Pulse-50V", "Volatility 50 (1s) Index"), ("1HZ25V", "Agent Apex-25V", "Volatility 25 (1s) Index"),
    ("1HZ10V", "Agent Nova-10V", "Volatility 10 (1s) Index"), ("R_100", "Agent Omega-100", "Volatility 100 Index"),
    ("R_75", "Agent Sigma-75", "Volatility 75 Index"), ("R_50", "Agent Phoenix-50", "Volatility 50 Index"),
    ("R_25", "Agent Viper-25", "Volatility 25 Index"), ("R_10", "Agent Zeta-10", "Volatility 10 Index"),
    ("CRASH1000", "Agent Crash-1000", "Crash 1000 Index"), ("CRASH500", "Agent Crash-500", "Crash 500 Index"),
    ("BOOM1000", "Agent Boom-1000", "Boom 1000 Index"), ("BOOM500", "Agent Boom-500", "Boom 500 Index"),
    ("stpRNG", "Agent Step-100", "Step Index 100"), ("JD100", "Agent Jump-100", "Jump 100 Index"),
]
TFS = (30, 60, 120, 180, 300)
FETCH = 60            # candles pulled per market and check (the chart shows the last 16)
KEEP = 300            # alerts kept (oldest deleted first)
DELAY = 2.5           # seconds after a candle boundary before checking, so the broker has published the closed candle

Fetch = Callable[[str, int, int], Awaitable[List[dict]]]


def closed_only(cs: List[dict], tf: int, now: float) -> List[dict]:
    """Only candles that have fully closed. The newest candle from a broker is usually still forming."""
    return [c for c in cs if c["time"] + tf <= now]


class AlertStore:
    def __init__(self, folder: str):
        self.folder = folder
        os.makedirs(folder, exist_ok=True)
        self.alerts: List[dict] = []
        self.seen: Dict[tuple, None] = {}        # every (market, tf, candle) ever alerted, even after the alert itself was trimmed
        self.next_id = 1
        try:
            with open(os.path.join(folder, "index.json")) as f:
                raw = json.load(f)
            self.alerts = raw["alerts"] if isinstance(raw, dict) else raw
            for k in (raw.get("seen", []) if isinstance(raw, dict) else []):
                self.seen[tuple(k)] = None
        except Exception:
            self.alerts = []
        for a in self.alerts:
            self.seen[(a["symbol"], a["tf"], a["candle_time"])] = None
            self.next_id = max(self.next_id, a["id"] + 1)

    def has(self, symbol: str, tf: int, candle_time: int) -> bool:
        return (symbol, tf, candle_time) in self.seen

    def add(self, meta: dict, svg: str) -> dict:
        a = {**meta, "id": self.next_id}
        self.next_id += 1
        with open(os.path.join(self.folder, f"{a['id']}.svg"), "w", encoding="utf-8") as f:
            f.write(svg)
        self.alerts.append(a)
        self.seen[(a["symbol"], a["tf"], a["candle_time"])] = None
        while len(self.seen) > 20000:
            self.seen.pop(next(iter(self.seen)))
        while len(self.alerts) > KEEP:
            old = self.alerts.pop(0)
            try:
                os.remove(os.path.join(self.folder, f"{old['id']}.svg"))
            except OSError:
                pass
        self._save()
        return a

    def svg(self, alert_id: int) -> Optional[str]:
        if not any(a["id"] == alert_id for a in self.alerts):
            return None
        try:
            with open(os.path.join(self.folder, f"{alert_id}.svg"), encoding="utf-8") as f:
                return f.read()
        except OSError:
            return None

    def clear(self) -> None:
        for a in self.alerts:
            try:
                os.remove(os.path.join(self.folder, f"{a['id']}.svg"))
            except OSError:
                pass
        self.alerts = []                         # 'seen' is kept on purpose: cleared setups do not come back on the next backfill
        self._save()

    def _save(self) -> None:
        tmp = os.path.join(self.folder, "index.json.tmp")
        with open(tmp, "w") as f:
            json.dump({"alerts": self.alerts, "seen": [list(k) for k in self.seen]}, f)
        os.replace(tmp, os.path.join(self.folder, "index.json"))


class SweepWatcher:
    def __init__(self, fetch: Fetch, store: AlertStore, agents=AGENTS, params: Params = Params(),
                 clock: Callable[[], float] = time.time):
        self.fetch, self.store, self.agents, self.params, self.clock = fetch, store, list(agents), params, clock
        self.tf = 60
        self.task: Optional[asyncio.Task] = None
        self.last_run = 0.0
        self.market: Dict[str, dict] = {a[0]: {"last_candle": 0, "error": ""} for a in self.agents}

    # ---- evaluation -------------------------------------------------------------------------------------------------
    def _alert(self, agent, tf: int, closed: List[dict], i: int, live: bool) -> Optional[dict]:
        """Run the engine on closed[:i+1] only (nothing after i is ever read) and, if it fires, render the screenshot."""
        symbol, name, market = agent
        win = closed[max(0, i + 1 - 40): i + 1]
        eng = [Candle(str(c["time"]), c["open"], c["high"], c["low"], c["close"]) for c in win]
        sg = detect(eng, len(eng) - 1, self.params)
        if sg is None or self.store.has(symbol, tf, win[-1]["time"]):
            return None
        svg = render_alert_svg(win, side=sg.side.value, ok=sg.ok, swept_level=sg.swept_level, tf=tf, market=f"{name} \u00b7 {market}",
                               symbol=symbol, block=sg.block, notes=sg.notes)
        meta = {"symbol": symbol, "name": name, "market": market, "tf": tf, "candle_time": int(win[-1]["time"]),
                "side": sg.side.value, "ok": sg.ok, "block": sg.block, "notes": list(dict.fromkeys(sg.notes)),
                "entry": sg.entry, "swept_level": sg.swept_level, "created": self.clock(), "live": live}
        return self.store.add(meta, svg)

    async def _check(self, agent, tf: int, backfill: int, now: float) -> List[dict]:
        symbol = agent[0]
        want = int(now // tf) * tf - tf          # open time of the candle that should have just closed
        cs: List[dict] = []
        for attempt in range(4):                 # the broker can publish the closed candle a moment late
            cs = closed_only(await self.fetch(symbol, tf, FETCH + backfill), tf, now)
            if cs and cs[-1]["time"] >= want:
                break
            if attempt < 3:
                await asyncio.sleep(2)
        if not cs:
            raise RuntimeError("no candles")
        cs = sorted(cs, key=lambda c: c["time"])
        self.market[symbol].update(last_candle=int(cs[-1]["time"]), error="")
        out = []
        first = max(0, len(cs) - 1 - backfill)
        for i in range(first, len(cs)):
            a = self._alert(agent, tf, cs, i, live=(i == len(cs) - 1 and backfill == 0))
            if a:
                out.append(a)
        return out

    async def run_once(self, backfill: int = 0) -> List[dict]:
        now, tf = self.clock(), self.tf
        sem = asyncio.Semaphore(8)
        found: List[dict] = []

        async def one(agent):
            async with sem:
                try:
                    found.extend(await self._check(agent, tf, backfill, now))
                except Exception as e:           # one market failing must never stop the other fifteen
                    self.market[agent[0]]["error"] = str(e)[:120] or e.__class__.__name__

        await asyncio.gather(*(one(a) for a in self.agents))
        self.last_run = self.clock()
        return found

    # ---- lifecycle --------------------------------------------------------------------------------------------------
    async def _loop(self, backfill: int):
        await self.run_once(backfill)
        while True:
            now = self.clock()
            await asyncio.sleep(max(0.5, (int(now // self.tf) + 1) * self.tf + DELAY - now))
            await self.run_once(0)

    def start(self, tf: int = 60, backfill: int = 0) -> None:
        self.stop()
        self.tf = tf if tf in TFS else 60
        self.task = asyncio.create_task(self._loop(max(0, min(int(backfill), FETCH * 4))))

    def stop(self) -> None:
        if self.task and not self.task.done():
            self.task.cancel()
        self.task = None

    def state(self) -> dict:
        last = self.store.alerts[-1]["id"] if self.store.alerts else 0
        return {"running": bool(self.task and not self.task.done()), "tf": self.tf, "agents": len(self.agents),
                "last_run": self.last_run, "last_id": last, "total": len(self.store.alerts), "now": self.clock(),
                "markets": [{"symbol": s, "name": n, **self.market[s]} for s, n, _ in self.agents],
                "failed": [s for s, m in self.market.items() if m["error"]]}
