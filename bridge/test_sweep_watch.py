"""Tests for the wick-sweep watch.  Run:  cd bridge && python3 -m unittest test_sweep_watch"""
import asyncio, random, shutil, tempfile, unittest
import xml.dom.minidom

import sweep_watch

from engines.wick_sweep_engine import Candle, Params, scan
from sweep_chart import render_alert_svg
from sweep_watch import AGENTS, AlertStore, SweepWatcher, closed_only

TF = 60
T0 = 1_762_300_000 // TF * TF


def walk(n, seed):
    r, p, out = random.Random(seed), 1000.0, []
    for i in range(n):
        o = p
        c = o + r.gauss(0, 1.2)
        h = max(o, c) + abs(r.gauss(0, 1.0)) * r.choice([0.2, 1, 2])
        l = min(o, c) - abs(r.gauss(0, 1.0)) * r.choice([0.2, 1, 2])
        out.append({"time": T0 + i * TF, "open": o, "high": h, "low": l, "close": c})
        p = c
    return out


class Feed:
    """Fake broker: returns every closed candle up to 'now' plus a FORMING candle with garbage values."""
    def __init__(self, data, fail=()):
        self.data, self.now, self.fail = data, 0.0, set(fail)

    def clock(self):
        return self.now

    async def __call__(self, symbol, tf, count):
        if symbol in self.fail:
            raise RuntimeError("boom")
        cs = [c for c in self.data[symbol] if c["time"] <= self.now]
        if cs and cs[-1]["time"] + TF > self.now:  # newest one is still forming: make it differ from what it will finally be
            f = dict(cs[-1]); f.update(open=f["open"] + 50, close=f["close"] - 50, high=f["high"] + 80, low=f["low"] - 80)
            cs[-1] = f
        return cs[-(count):]


class WatchTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_closed_only_drops_forming(self):
        cs = [{"time": 0}, {"time": 60}, {"time": 120}]
        self.assertEqual([c["time"] for c in closed_only(cs, 60, 150)], [0, 60])
        self.assertEqual([c["time"] for c in closed_only(cs, 60, 180)], [0, 60, 120])

    def test_live_feed_equals_engine_scan_exactly(self):
        """Candle-by-candle live watching must give the same signals as scanning the finished series (no look-ahead, no forming candles)."""
        n = 400
        data = {a[0]: walk(n, i) for i, a in enumerate(AGENTS)}
        feed = Feed(data)
        keep, sweep_watch.KEEP = sweep_watch.KEEP, 10**6        # do not trim: compare against every signal
        self.addCleanup(setattr, sweep_watch, "KEEP", keep)
        w = SweepWatcher(feed, AlertStore(self.dir), clock=feed.clock)

        async def go():
            for i in range(60, n):
                feed.now = T0 + (i + 1) * TF + 3            # 3s after candle i closed
                await w.run_once()
        asyncio.run(go())

        got = {(a["symbol"], a["candle_time"], a["side"], a["ok"]) for a in w.store.alerts}
        want = set()
        for sym, cs in data.items():
            ec = [Candle(str(c["time"]), c["open"], c["high"], c["low"], c["close"]) for c in cs]
            for s in scan(ec, Params()):
                if s.index >= 60:                            # the watcher started at candle 60
                    want.add((sym, cs[s.index]["time"], s.side.value, s.ok))
        self.assertGreater(len(want), 20, "test data should contain plenty of sweeps")
        self.assertEqual(got, want)
        self.assertTrue(all(a["live"] for a in w.store.alerts))

    def test_no_duplicates_and_persistence(self):
        data = {a[0]: walk(300, 5 + i) for i, a in enumerate(AGENTS)}
        feed = Feed(data); feed.now = T0 + 300 * TF + 3
        w = SweepWatcher(feed, AlertStore(self.dir), clock=feed.clock)
        first = asyncio.run(w.run_once(backfill=200))
        self.assertTrue(first)
        self.assertEqual(asyncio.run(w.run_once(backfill=200)), [])          # same candles again: nothing new
        reloaded = AlertStore(self.dir)                                        # restart: still known, still deduped
        self.assertEqual(len(reloaded.alerts), len(w.store.alerts))
        w2 = SweepWatcher(feed, reloaded, clock=feed.clock)
        self.assertEqual(asyncio.run(w2.run_once(backfill=200)), [])
        a = reloaded.alerts[-1]
        xml.dom.minidom.parseString(reloaded.svg(a["id"]))
        self.assertFalse(any(x["live"] for x in first))                         # backfilled ones are not "live"

    def test_one_market_failing_does_not_stop_the_rest(self):
        data = {a[0]: walk(300, 9 + i) for i, a in enumerate(AGENTS)}
        feed = Feed(data, fail={"R_100"}); feed.now = T0 + 300 * TF + 3
        w = SweepWatcher(feed, AlertStore(self.dir), clock=feed.clock)
        asyncio.run(w.run_once(backfill=250))
        st = w.state()
        self.assertEqual(st["failed"], ["R_100"])
        self.assertTrue(any(a["symbol"] != "R_100" for a in w.store.alerts))
        self.assertEqual(st["agents"], 16)

    def test_sixteen_distinct_markets(self):
        self.assertEqual(len({a[0] for a in AGENTS}), 16)


class ChartTests(unittest.TestCase):
    def cs(self):
        return [{"time": T0 + i * TF, "open": 100 + i * .1, "high": 101 + i * .1, "low": 99.5 + i * .1, "close": 100.6 + i * .1} for i in range(20)]

    def test_all_variants_are_valid_svg(self):
        for side in ("BUY", "SELL"):
            for ok in (True, False):
                s = render_alert_svg(self.cs(), side=side, ok=ok, swept_level=100.0, tf=60, market="Agent X", symbol="R_100",
                                     block=None if ok else "opposing side still in firm control", notes=["wick rejection"])
                xml.dom.minidom.parseString(s)
                self.assertIn(side, s)
                self.assertIn("Valid" if ok else "Skipped", s)

    def test_short_history_ok(self):
        xml.dom.minidom.parseString(render_alert_svg(self.cs()[:3], side="BUY", ok=True, swept_level=99.6, tf=30, market="m", symbol="s"))


if __name__ == "__main__":
    unittest.main()
