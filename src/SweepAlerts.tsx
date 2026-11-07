// Wick sweep alerts: the 16 agents post a chart screenshot here the moment the wick sweep engine sees a setup.
// The bridge does the watching (bridge/sweep_watch.py); this screen only shows what it found.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";

export interface SweepAlert {
  id: number; symbol: string; name: string; market: string; tf: number; candle_time: number;
  side: "BUY" | "SELL"; ok: boolean; block: string | null; notes: string[]; entry: number; swept_level: number;
  created: number; live: boolean;
}
export interface SweepState {
  running: boolean; tf: number; agents: number; last_run: number; last_id: number; total: number; now: number;
  failed: string[]; markets: { symbol: string; name: string; last_candle: number; error: string }[];
}
export interface SweepFeed {
  alerts: SweepAlert[]; state: SweepState | null; error: string; unseen: number; lastId: number;
  markSeen: () => void;
  start: (tf: number, backfill?: number) => Promise<void>;
  stop: () => Promise<void>;
  clear: () => Promise<void>;
}

const SEEN_KEY = "qx-sweep-seen";
const VERDICT_KEY = "qx-sweep-verdicts";
const readNum = (k: string) => { try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; } };
const TFS = [{ sec: 30, label: "30s" }, { sec: 60, label: "1m" }, { sec: 120, label: "2m" }, { sec: 180, label: "3m" }, { sec: 300, label: "5m" }];

/** Polls the bridge every few seconds. Lives in App so the Menu badge and the toast work from any tab. */
export function useSweepFeed(http: string, onNew?: (a: SweepAlert) => void): SweepFeed {
  const [alerts, setAlerts] = useState<SweepAlert[]>([]);
  const [state, setState] = useState<SweepState | null>(null);
  const [error, setError] = useState("");
  const [seen, setSeen] = useState<number>(() => readNum(SEEN_KEY));
  const lastId = useRef(0);
  const first = useRef(true);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;

  const poll = useCallback(async () => {
    try {
      const r = await apiFetch(`${http}/api/sweep/alerts?since=${lastId.current}&limit=100`);
      if (!r.ok) throw new Error(`bridge answered ${r.status}`);
      const d: { alerts: SweepAlert[]; state: SweepState } = await r.json();
      setState(d.state);
      setError("");
      if (d.alerts.length) {
        const fresh = d.alerts;
        lastId.current = Math.max(lastId.current, ...fresh.map((a) => a.id));
        setAlerts((prev) => {
          const m = new Map(prev.map((a) => [a.id, a]));
          fresh.forEach((a) => m.set(a.id, a));
          return [...m.values()].sort((a, b) => b.candle_time - a.candle_time || b.id - a.id).slice(0, 150);
        });
        if (!first.current) fresh.filter((a) => a.live).sort((a, b) => a.id - b.id).forEach((a) => onNewRef.current?.(a));
      }
      first.current = false;
    } catch (e) {
      setError(`Cannot reach the bridge (${(e as Error).message})`);
    }
  }, [http]);

  useEffect(() => {
    lastId.current = 0; first.current = true; setAlerts([]);
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [poll]);

  const post = async (path: string, body: object = {}) => {
    try {
      const r = await apiFetch(`${http}/api/sweep/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.status === "error") setError(d.msg || "Request failed");
    } catch (e) { setError(`Cannot reach the bridge (${(e as Error).message})`); }
  };

  const lastIdNow = alerts.reduce((m, a) => Math.max(m, a.id), 0);
  return {
    alerts, state, error, lastId: lastIdNow,
    unseen: alerts.filter((a) => a.id > seen).length,
    markSeen: () => { if (lastIdNow > seen) { setSeen(lastIdNow); try { localStorage.setItem(SEEN_KEY, String(lastIdNow)); } catch { /* storage unavailable */ } } },
    start: async (tf, backfill = 0) => { await post("start", { tf, backfill }); await poll(); },
    stop: async () => { await post("stop"); await poll(); },
    clear: async () => { await post("clear"); lastId.current = 0; setAlerts([]); await poll(); },
  };
}

const ago = (sec: number) => (sec < 90 ? "just now" : sec < 3600 ? `${Math.round(sec / 60)}m ago` : `${Math.round(sec / 3600)}h ago`);
const hhmm = (epoch: number, tf: number) =>
  new Date(epoch * 1000).toLocaleTimeString([], tf < 60 ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : { hour: "2-digit", minute: "2-digit" });

export default function SweepAlerts({ feed, http }: { feed: SweepFeed; http: string }) {
  const { alerts, state, error } = feed;
  const [filter, setFilter] = useState<"all" | "take" | "skip">("all");
  const [zoom, setZoom] = useState<SweepAlert | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, "yes" | "no">>(() => {
    try { return JSON.parse(localStorage.getItem(VERDICT_KEY) || "{}"); } catch { return {}; }
  });
  const vote = (id: number, v: "yes" | "no") => {
    setVerdicts((p) => {
      const n = { ...p }; if (n[id] === v) delete n[id]; else n[id] = v;
      try { localStorage.setItem(VERDICT_KEY, JSON.stringify(n)); } catch { /* storage unavailable */ }
      return n;
    });
  };

  const shown = alerts.filter((a) => (filter === "all" ? true : filter === "take" ? a.ok : !a.ok));
  const yes = alerts.filter((a) => verdicts[a.id] === "yes").length;
  const no = alerts.filter((a) => verdicts[a.id] === "no").length;
  const nowSec = state?.now ?? Date.now() / 1000;
  const checked = state?.last_run ? ago(nowSec - state.last_run) : "not yet";

  return (
    <section className="sw">
      <div className="sw-card">
        <div className="sw-head">
          <b>Wick sweep watch</b>
          <span className={`sw-dot ${state?.running ? "on" : ""}`}>{state?.running ? "Watching" : "Stopped"}</span>
        </div>
        <p className="sw-sub">
          {state ? `${state.agents} agents, one per market. Last check: ${checked}.` : "Connecting to the bridge…"}
          {state && state.failed.length > 0 && ` No data from: ${state.failed.join(", ")}.`}
        </p>
        {error && <p className="sw-err">{error}</p>}
        <div className="sw-row">
          {TFS.map((t) => (
            <button key={t.sec} className={`sw-chip ${state?.tf === t.sec ? "on" : ""}`} onClick={() => feed.start(t.sec)}>{t.label}</button>
          ))}
        </div>
        <div className="sw-row">
          {state?.running
            ? <button className="sw-btn" onClick={() => feed.stop()}>Stop</button>
            : <button className="sw-btn pri" onClick={() => feed.start(state?.tf ?? 60)}>Start</button>}
          <button className="sw-btn" onClick={() => feed.start(state?.tf ?? 60, 60)}>Load recent setups</button>
          <button className="sw-btn" onClick={() => { if (window.confirm("Delete all alerts?")) feed.clear(); }}>Clear</button>
        </div>
      </div>

      <div className="sw-row sw-filter">
        {([["all", "All"], ["take", "Taken"], ["skip", "Skipped"]] as const).map(([k, l]) => (
          <button key={k} className={`sw-chip ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
        <span className="sw-tally">Checked by you: {yes} correct, {no} wrong</span>
      </div>

      {shown.length === 0 && (
        <p className="muted">
          {alerts.length === 0
            ? "No setups yet. A screenshot appears here the moment any agent sees one. Tap “Load recent setups” to see the latest ones from the last 60 candles."
            : "Nothing in this filter."}
        </p>
      )}

      {shown.map((a) => (
        <article key={a.id} className={`sw-alert ${a.ok ? "" : "skip"}`}>
          <div className="sw-ahead">
            <span className={`sw-side ${a.side === "BUY" ? "buy" : "sell"}`}>{a.side}</span>
            <div className="sw-title">
              <b>{a.name}</b>
              <small>{a.symbol} · {hhmm(a.candle_time, a.tf)} · {ago(nowSec - (a.candle_time + a.tf))}{a.live ? "" : " · earlier"}</small>
            </div>
            <span className={`sw-tag ${a.ok ? "take" : "skip"}`}>{a.ok ? "TAKE" : "SKIP"}</span>
          </div>
          <img className="sw-img" loading="lazy" alt={`${a.side} setup on ${a.name}`} src={`${http}/api/sweep/image/${a.id}`} onClick={() => setZoom(a)} />
          <p className="sw-why">{a.ok ? a.notes.join(", ") || "sweep confirmed" : a.block}</p>
          <div className="sw-row">
            <button className={`sw-btn ${verdicts[a.id] === "yes" ? "yes" : ""}`} onClick={() => vote(a.id, "yes")}>✓ Engine is right</button>
            <button className={`sw-btn ${verdicts[a.id] === "no" ? "no" : ""}`} onClick={() => vote(a.id, "no")}>✗ Engine is wrong</button>
          </div>
        </article>
      ))}

      {zoom && (
        <div className="sw-zoom" onClick={() => setZoom(null)} role="dialog" aria-label="Setup screenshot">
          <img alt="Setup screenshot" src={`${http}/api/sweep/image/${zoom.id}`} />
        </div>
      )}
    </section>
  );
}
