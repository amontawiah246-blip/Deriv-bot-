import React, { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

interface HistoryEntry {
  id: number;
  market: string;
  side: "buy" | "sell";
  result: "win" | "loss" | "draw";
  profit: number | null;
  time: number;
}

export default function HistoryPage({ apiBase, onBack }: { apiBase: string; onBack: () => void }) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${apiBase}/api/history`)
      .then((r) => r.json())
      .then((d) => {
        setHistory(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [apiBase]);

  return (
    <div className="sgwrap">
      <div className="sg">
        <div className="sg-bar">
          <button className="sg-back" onClick={onBack} aria-label="Back"><ArrowLeft size={20} /></button>
          <span className="sg-brand">TRADE HISTORY</span>
        </div>
        <div className="card">
          {loading ? (
            <p className="muted">Loading history...</p>
          ) : history.length === 0 ? (
            <p className="muted">No trades executed yet.</p>
          ) : (
            <div className="sg-hist-list">
              {history.map((r) => (
                <div className="sg-hrow" key={r.id}>
                  <span className={`sg-side ${r.side}`}>{r.side.toUpperCase()}</span>
                  <span className="sg-hm">{r.market}<small>{new Date(r.time).toLocaleString()}</small></span>
                  <span className={`sg-res ${r.result}`}>{r.result.toUpperCase()}</span>
                  <span className="sg-hc">{r.profit != null ? `$${r.profit.toFixed(2)}` : "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
