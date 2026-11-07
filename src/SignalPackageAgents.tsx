import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Camera,
  ChevronDown,
  Clock,
  Maximize2,
  RefreshCw,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Volume2,
  VolumeX,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { createChart, CrosshairMode, IChartApi, UTCTimestamp } from "lightweight-charts";
import { apiFetch } from "./api";
import { fmtShort } from "./assets";
import type { SweepAlert, SweepFeed } from "./SweepAlerts";

export interface AgentDef {
  id: string;
  name: string;
  codename: string;
  symbol: string;
  marketName: string;
  category: "1s" | "vol" | "crash_boom" | "jump_step";
  strategyName: string;
  specialty: string;
  badgeColor: string;
}

export const SYNTHETIC_AGENTS: AgentDef[] = [
  {
    id: "agent-10v",
    name: "Agent Nova-10V",
    codename: "NOVA-10V",
    symbol: "1HZ10V",
    marketName: "Volatility 10 (1s) Index",
    category: "1s",
    strategyName: "Micro-Structure Trend",
    specialty: "Smooth Directional Flow",
    badgeColor: "#8b5cf6",
  },
  {
    id: "agent-25v",
    name: "Agent Apex-25V",
    codename: "APEX-25V",
    symbol: "1HZ25V",
    marketName: "Volatility 25 (1s) Index",
    category: "1s",
    strategyName: "Support & Resistance Snipes",
    specialty: "Tight Wick Reversals",
    badgeColor: "#3b82f6",
  },
  {
    id: "agent-50v",
    name: "Agent Pulse-50V",
    codename: "PULSE-50V",
    symbol: "1HZ50V",
    marketName: "Volatility 50 (1s) Index",
    category: "1s",
    strategyName: "Multi-EMA Mean Reversion",
    specialty: "Mid-Frequency Volatility Pullbacks",
    badgeColor: "#eab308",
  },
  {
    id: "agent-75v",
    name: "Agent Surge-75V",
    codename: "SURGE-75V",
    symbol: "1HZ75V",
    marketName: "Volatility 75 (1s) Index",
    category: "1s",
    strategyName: "Dynamic Momentum Channel",
    specialty: "High-Speed Trend Waves",
    badgeColor: "#f97316",
  },
  {
    id: "agent-100v",
    name: "Agent Titan-100V",
    codename: "TITAN-100V",
    symbol: "1HZ100V",
    marketName: "Volatility 100 (1s) Index",
    category: "1s",
    strategyName: "Liquidity Sweep & RSI Rejection",
    specialty: "High-Frequency Volatility Breakouts",
    badgeColor: "#ef4444",
  },
  {
    id: "agent-150v",
    name: "Agent Hyper-150V",
    codename: "HYPER-150V",
    symbol: "1HZ150V",
    marketName: "Volatility 150 (1s) Index",
    category: "1s",
    strategyName: "Extreme Impulse Scalper",
    specialty: "1-Second Burst Breakouts",
    badgeColor: "#d946ef",
  },
  {
    id: "agent-200v",
    name: "Agent Vector-200V",
    codename: "VECTOR-200V",
    symbol: "1HZ200V",
    marketName: "Volatility 200 (1s) Index",
    category: "1s",
    strategyName: "Velocity Wave Scanner",
    specialty: "Ultra High Frequency Volatility",
    badgeColor: "#ec4899",
  },
  {
    id: "agent-250v",
    name: "Agent Quantum-250V",
    codename: "QUANTUM-250V",
    symbol: "1HZ250V",
    marketName: "Volatility 250 (1s) Index",
    category: "1s",
    strategyName: "Order Flow Delta Catcher",
    specialty: "Institutional Spike Exhaustion",
    badgeColor: "#06b6d4",
  },
  {
    id: "agent-300v",
    name: "Agent Astra-300V",
    codename: "ASTRA-300V",
    symbol: "1HZ300V",
    marketName: "Volatility 300 (1s) Index",
    category: "1s",
    strategyName: "Maximum Volatility Matrix",
    specialty: "Extreme Speed Reversals",
    badgeColor: "#14b8a6",
  },
  {
    id: "agent-vol10",
    name: "Agent Zeta-10",
    codename: "ZETA-10",
    symbol: "R_10",
    marketName: "Volatility 10 Index",
    category: "vol",
    strategyName: "EMA 9/21 Trend Ribbon",
    specialty: "Low-Noise Stable Trends",
    badgeColor: "#6366f1",
  },
  {
    id: "agent-vol25",
    name: "Agent Viper-25",
    codename: "VIPER-25",
    symbol: "R_25",
    marketName: "Volatility 25 Index",
    category: "vol",
    strategyName: "Fair Value Gap Sniping",
    specialty: "Precision Range Traps",
    badgeColor: "#14b8a6",
  },
  {
    id: "agent-vol50",
    name: "Agent Phoenix-50",
    codename: "PHOENIX-50",
    symbol: "R_50",
    marketName: "Volatility 50 Index",
    category: "vol",
    strategyName: "Bollinger Band Pinch & Bounce",
    specialty: "Balanced Mean Reversion",
    badgeColor: "#10b981",
  },
  {
    id: "agent-vol75",
    name: "Agent Sigma-75",
    codename: "SIGMA-75",
    symbol: "R_75",
    marketName: "Volatility 75 Index",
    category: "vol",
    strategyName: "Break of Structure (BOS)",
    specialty: "Trend Expansion Continuations",
    badgeColor: "#06b6d4",
  },
  {
    id: "agent-vol100",
    name: "Agent Omega-100",
    codename: "OMEGA-100",
    symbol: "R_100",
    marketName: "Volatility 100 Index",
    category: "vol",
    strategyName: "High-Impact Liquidity Boss",
    specialty: "Continuous Uncut Volatility",
    badgeColor: "#ec4899",
  },
  {
    id: "agent-vol150",
    name: "Agent Matrix-150",
    codename: "MATRIX-150",
    symbol: "R_150",
    marketName: "Volatility 150 Index",
    category: "vol",
    strategyName: "Structural Liquidity Sweep",
    specialty: "Multi-Candle Swing Sweeps",
    badgeColor: "#8b5cf6",
  },
  {
    id: "agent-vol200",
    name: "Agent Nexus-200",
    codename: "NEXUS-200",
    symbol: "R_200",
    marketName: "Volatility 200 Index",
    category: "vol",
    strategyName: "Macro Trend Expansion",
    specialty: "Heavy Volatility Waves",
    badgeColor: "#a855f7",
  },
  {
    id: "agent-vol250",
    name: "Agent Orbit-250",
    codename: "ORBIT-250",
    symbol: "R_250",
    marketName: "Volatility 250 Index",
    category: "vol",
    strategyName: "Velocity Squeeze Tracker",
    specialty: "Dynamic Band Breakouts",
    badgeColor: "#f43f5e",
  },
  {
    id: "agent-vol300",
    name: "Agent Zenith-300",
    codename: "ZENITH-300",
    symbol: "R_300",
    marketName: "Volatility 300 Index",
    category: "vol",
    strategyName: "Apex Momentum Engine",
    specialty: "Maximum Standard Volatility",
    badgeColor: "#ef4444",
  },
  {
    id: "agent-crash300",
    name: "Agent Crash-300",
    codename: "CRASH-300",
    symbol: "CRASH300",
    marketName: "Crash 300 Index",
    category: "crash_boom",
    strategyName: "Hyper Drop Scalp Catcher",
    specialty: "Frequent Crash Drop Dip Exploits",
    badgeColor: "#f43f5e",
  },
  {
    id: "agent-crash500",
    name: "Agent Crash-500",
    codename: "CRASH-500",
    symbol: "CRASH500",
    marketName: "Crash 500 Index",
    category: "crash_boom",
    strategyName: "Frequent Drop Counter-Attack",
    specialty: "Quick Drop Dip Exploits",
    badgeColor: "#e11d48",
  },
  {
    id: "agent-crash1000",
    name: "Agent Crash-1000",
    codename: "CRASH-1K",
    symbol: "CRASH1000",
    marketName: "Crash 1000 Index",
    category: "crash_boom",
    strategyName: "Post-Crash Rebound Scanner",
    specialty: "Sudden Drop Recovery Scalps",
    badgeColor: "#ef4444",
  },
  {
    id: "agent-boom300",
    name: "Agent Boom-300",
    codename: "BOOM-300",
    symbol: "BOOM300",
    marketName: "Boom 300 Index",
    category: "crash_boom",
    strategyName: "Rapid Spike Surge Tracker",
    specialty: "Frequent Boom Spike Surges",
    badgeColor: "#10b981",
  },
  {
    id: "agent-boom500",
    name: "Agent Boom-500",
    codename: "BOOM-500",
    symbol: "BOOM500",
    marketName: "Boom 500 Index",
    category: "crash_boom",
    strategyName: "Accumulation Base Catcher",
    specialty: "Upward Spike Reversals",
    badgeColor: "#22c55e",
  },
  {
    id: "agent-boom1000",
    name: "Agent Boom-1000",
    codename: "BOOM-1K",
    symbol: "BOOM1000",
    marketName: "Boom 1000 Index",
    category: "crash_boom",
    strategyName: "Explosion Continuation Engine",
    specialty: "Green Spike Surges",
    badgeColor: "#16a34a",
  },
  {
    id: "agent-step",
    name: "Agent Step-100",
    codename: "STEP-100",
    symbol: "stpRNG",
    marketName: "Step Index 100",
    category: "jump_step",
    strategyName: "Equal Step Distance Matrix",
    specialty: "Fixed Step Size Scalping",
    badgeColor: "#38bdf8",
  },
  {
    id: "agent-jump10",
    name: "Agent Jump-10",
    codename: "JUMP-10",
    symbol: "JD10",
    marketName: "Jump 10 Index",
    category: "jump_step",
    strategyName: "Micro Gap Jump Tracker",
    specialty: "Low Frequency Gap Continuation",
    badgeColor: "#818cf8",
  },
  {
    id: "agent-jump25",
    name: "Agent Jump-25",
    codename: "JD25",
    symbol: "JD25",
    marketName: "Jump 25 Index",
    category: "jump_step",
    strategyName: "Step-Jump Gap Catcher",
    specialty: "Precision Gap Momentum",
    badgeColor: "#c084fc",
  },
  {
    id: "agent-jump50",
    name: "Agent Jump-50",
    codename: "JD50",
    symbol: "JD50",
    marketName: "Jump 50 Index",
    category: "jump_step",
    strategyName: "Moderate Gap Jump Engine",
    specialty: "Mid Volatility Gap Surges",
    badgeColor: "#e879f9",
  },
  {
    id: "agent-jump75",
    name: "Agent Jump-75",
    codename: "JD75",
    symbol: "JD75",
    marketName: "Jump 75 Index",
    category: "jump_step",
    strategyName: "High Impact Jump Flow",
    specialty: "Expanded Gap Volatility",
    badgeColor: "#f472b6",
  },
  {
    id: "agent-jump100",
    name: "Agent Jump-100",
    codename: "JUMP-100",
    symbol: "JD100",
    marketName: "Jump 100 Index",
    category: "jump_step",
    strategyName: "Gap Jump Volatility Tracker",
    specialty: "Sudden Gap Flow Continuity",
    badgeColor: "#a855f7",
  },
];

export const TIMEFRAME_OPTIONS = [
  { label: "5 Seconds", sec: 5 },
  { label: "15 Seconds", sec: 15 },
  { label: "30 Seconds", sec: 30 },
  { label: "1 Minute (60s)", sec: 60 },
  { label: "2 Minutes (120s)", sec: 120 },
  { label: "3 Minutes (180s)", sec: 180 },
  { label: "4 Minutes (240s)", sec: 240 },
  { label: "5 Minutes (300s)", sec: 300 },
  { label: "10 Minutes (600s)", sec: 600 },
  { label: "15 Minutes (900s)", sec: 900 },
  { label: "30 Minutes (1800s)", sec: 1800 },
  { label: "1 Hour (3600s)", sec: 3600 },
];

export interface MiniCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface AgentLiveState {
  symbol: string;
  price: number;
  changePct: number;
  high: number;
  low: number;
  candles: MiniCandle[];
  side: "buy" | "sell" | "neutral";
  confidence: number;
  signalName: string;
  sweepReason: string;
  rsi: number;
  trend: "Bullish" | "Bearish" | "Consolidating";
  lastTrade?: {
    id: string;
    side: "buy" | "sell";
    stake: number;
    time: number;
    status: "pending" | "won" | "lost" | "draw";
    profit?: number | null;
  };
}

// Full interactive lightweight-charts canvas for the single active agent screen
function AgentFullChart({
  wsBase,
  symbol,
  tf,
  onPriceUpdate,
}: {
  wsBase: string;
  symbol: string;
  tf: number;
  onPriceUpdate?: (price: number, changePct: number, high: number, low: number, isUp: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart: IChartApi = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: "#060a17" }, textColor: "#8899b8", fontSize: 11 },
      grid: { vertLines: { color: "#111c33" }, horzLines: { color: "#111c33" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: tf < 60, rightOffset: 6, barSpacing: 10 },
      handleScroll: true,
      handleScale: true,
    });

    const series = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
    });

    let ws: WebSocket | null = null;
    let closed = false;
    let firstOpen = 0;
    let highP = 0;
    let lowP = Infinity;

    const openStream = () => {
      try {
        ws = new WebSocket(`${wsBase}/ws?broker=deriv&asset=${encodeURIComponent(symbol)}&tf=${tf}`);

        ws.onmessage = (e) => {
          if (closed) return;
          try {
            const m = JSON.parse(e.data);
            if (m.type === "history" && Array.isArray(m.candles) && m.candles.length) {
              const formatted = m.candles.map((c: any) => {
                if (c.high > highP) highP = c.high;
                if (c.low < lowP) lowP = c.low;
                return {
                  time: c.time as UTCTimestamp,
                  open: c.open,
                  high: c.high,
                  low: c.low,
                  close: c.close,
                };
              });
              series.setData(formatted);
              const last = formatted[formatted.length - 1];
              firstOpen = formatted[0].open;
              if (last && onPriceUpdate) {
                const pct = firstOpen ? ((last.close - firstOpen) / firstOpen) * 100 : 0;
                onPriceUpdate(last.close, pct, highP, lowP === Infinity ? last.low : lowP, last.close >= last.open);
              }
            } else if (m.type === "tick" && m.candle) {
              const c = m.candle;
              if (c.high > highP) highP = c.high;
              if (c.low < lowP) lowP = c.low;
              series.update({
                time: c.time as UTCTimestamp,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
              });
              if (onPriceUpdate) {
                const pct = firstOpen ? ((c.close - firstOpen) / firstOpen) * 100 : 0;
                onPriceUpdate(c.close, pct, highP, lowP, c.close >= c.open);
              }
            }
          } catch {
            /* ignore parse errors */
          }
        };

        ws.onerror = () => {};
      } catch {
        /* handled silently */
      }
    };

    openStream();

    return () => {
      closed = true;
      if (ws) ws.close();
      chart.remove();
    };
  }, [wsBase, symbol, tf, onPriceUpdate]);

  return (
    <div className="relative w-full h-[380px] md:h-[460px] rounded-2xl bg-[#060a17] border border-[#14213d] overflow-hidden my-3 shadow-2xl">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

interface Props {
  http: string;
  wsBase: string;
  onOpenChart: (symbol: string) => void;
  onToast: (msg: string) => void;
  activeBalance: number | null;
  isDemo: boolean;
  onSwitchAccount: (demo: boolean) => void;
  sweep: SweepFeed;
}

export default function SignalPackageAgents({
  http,
  wsBase,
  onOpenChart,
  onToast,
  activeBalance,
  isDemo,
  onSwitchAccount,
  sweep,
}: Props) {
  // Global Timeframe for ALL agents
  const [globalTf, setGlobalTf] = useState<number>(60);
  const [tfPickerOpen, setTfPickerOpen] = useState<boolean>(false);

  const [stake, setStake] = useState<number>(10);
  const [expirySec, setExpirySec] = useState<number>(60);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Agent ordering & Active full screen agent
  const [orderedAgents, setOrderedAgents] = useState<AgentDef[]>(SYNTHETIC_AGENTS);
  const [selectedAgentSymbol, setSelectedAgentSymbol] = useState<string>(SYNTHETIC_AGENTS[0].symbol);
  const [zoomScreenshot, setZoomScreenshot] = useState<boolean>(false);

  const topCardsBarRef = useRef<HTMLDivElement | null>(null);
  const lastAlertIdRef = useRef<number>(0);

  // Live state per agent symbol
  const [agentStates, setAgentStates] = useState<Record<string, AgentLiveState>>({});
  const [tradingBusy, setTradingBusy] = useState<Record<string, boolean>>({});

  const activeAgent = useMemo(() => {
    return orderedAgents.find((a) => a.symbol === selectedAgentSymbol) || orderedAgents[0];
  }, [orderedAgents, selectedAgentSymbol]);

  const activeSetup = useMemo(() => {
    return sweep.alerts.find((a) => a.symbol === activeAgent.symbol);
  }, [sweep.alerts, activeAgent.symbol]);

  const [priceInfo, setPriceInfo] = useState({
    price: 0,
    changePct: 0,
    high: 0,
    low: 0,
    isUp: true,
  });

  const handlePriceUpdate = useCallback((price: number, changePct: number, high: number, low: number, isUp: boolean) => {
    setPriceInfo({ price, changePct, high, low, isUp });
  }, []);

  const beepSound = (up: boolean) => {
    if (!soundEnabled) return;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = up ? 880 : 520;
      g.gain.value = 0.05;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.15);
      setTimeout(() => ctx.close(), 300);
    } catch {
      /* audio blocked */
    }
  };

  // Re-order agents when a fresh setup alert arrives: move agent to #1 and auto-select its full screen chart
  useEffect(() => {
    if (!sweep.alerts || sweep.alerts.length === 0) return;

    const newestAlert = sweep.alerts[0]; // Sorted descending by candle_time & id
    if (newestAlert && newestAlert.id > lastAlertIdRef.current) {
      lastAlertIdRef.current = newestAlert.id;

      const targetAgent = SYNTHETIC_AGENTS.find((a) => a.symbol === newestAlert.symbol);
      if (targetAgent) {
        setOrderedAgents((prev) => {
          const rest = prev.filter((a) => a.symbol !== targetAgent.symbol);
          return [targetAgent, ...rest];
        });

        // Automatically set the newly triggered agent as the active full screen agent
        setSelectedAgentSymbol(targetAgent.symbol);

        // Scroll top bar to start
        if (topCardsBarRef.current) {
          topCardsBarRef.current.scrollTo({ left: 0, behavior: "smooth" });
        }

        onToast(`🚨 Setup Found! Auto-switched to ${targetAgent.name} (#1 Position)`);
      }
    }
  }, [sweep.alerts, onToast]);

  // Helper to compute synthetic indicators from candles
  const evaluateAgent = (cs: MiniCandle[]): Partial<AgentLiveState> => {
    if (!cs || cs.length < 5) {
      return {
        side: "neutral",
        confidence: 50,
        signalName: "Scanning Deriv tick flow…",
        sweepReason: "Building candle structure",
        rsi: 50,
        trend: "Consolidating",
      };
    }

    const n = cs.length;
    const closes = cs.map((c) => c.close);
    const last = cs[n - 1];

    let gains = 0, losses = 0;
    const rsiPeriod = Math.min(14, n - 1);
    for (let i = n - rsiPeriod; i < n; i++) {
      const diff = cs[i].close - cs[i - 1].close;
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    const rs = losses === 0 ? 100 : gains / (losses || 1);
    const rsi = Math.round(100 - 100 / (1 + rs));

    const emaShort = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const emaLong = closes.slice(-15).reduce((a, b) => a + b, 0) / Math.min(15, closes.length);
    const isBull = emaShort > emaLong;

    const range = Math.max(last.high - last.low, 0.00001);
    const upperWick = last.high - Math.max(last.open, last.close);
    const lowerWick = Math.min(last.open, last.close) - last.low;
    const isLowerRejection = lowerWick / range > 0.45;
    const isUpperRejection = upperWick / range > 0.45;

    let side: "buy" | "sell" | "neutral" = "neutral";
    let conf = 50;
    let signalName = "Scanning";
    let sweepReason = "Normal range";

    if (isLowerRejection || (rsi < 36 && last.close > last.open)) {
      side = "buy";
      conf = Math.min(94, 65 + Math.round((40 - Math.min(40, rsi)) * 0.6) + (isBull ? 8 : 0));
      signalName = "STRONG RISE SETUP";
      sweepReason = isLowerRejection ? "Liquidity sweep below lows with wick rejection" : "Oversold RSI rebound confirmed";
    } else if (isUpperRejection || (rsi > 64 && last.close < last.open)) {
      side = "sell";
      conf = Math.min(94, 65 + Math.round((Math.max(60, rsi) - 60) * 0.6) + (!isBull ? 8 : 0));
      signalName = "STRONG FALL SETUP";
      sweepReason = isUpperRejection ? "Liquidity sweep above highs with wick rejection" : "Overbought RSI exhaustion confirmed";
    } else if (isBull) {
      side = "buy";
      conf = 68;
      signalName = "TRENDING RISE";
      sweepReason = "EMA ribbon expansion & buyer volume";
    } else {
      side = "sell";
      conf = 67;
      signalName = "TRENDING FALL";
      sweepReason = "EMA ribbon downward slope & seller volume";
    }

    const first = cs[0].open;
    const cur = last.close;
    const changePct = first ? ((cur - first) / first) * 100 : 0;
    const high = Math.max(...cs.map((c) => c.high));
    const low = Math.min(...cs.map((c) => c.low));

    return {
      price: cur,
      changePct,
      high,
      low,
      side,
      confidence: conf,
      signalName,
      sweepReason,
      rsi,
      trend: isBull ? "Bullish" : "Bearish",
    };
  };

  const loadAllAgents = useCallback(async () => {
    setRefreshing(true);
    try {
      const symbols = SYNTHETIC_AGENTS.map((a) => a.symbol);
      const updates: Record<string, AgentLiveState> = {};

      await Promise.all(
        symbols.map(async (sym) => {
          try {
            const res = await apiFetch(`${http}/api/deriv/synthetic-candles?symbol=${encodeURIComponent(sym)}&tf=${globalTf}&count=35`);
            if (res.ok) {
              const data = await res.json();
              const cs: MiniCandle[] = Array.isArray(data.candles) ? data.candles : [];
              const evalRes = evaluateAgent(cs);
              updates[sym] = {
                symbol: sym,
                candles: cs,
                price: evalRes.price ?? 0,
                changePct: evalRes.changePct ?? 0,
                high: evalRes.high ?? 0,
                low: evalRes.low ?? 0,
                side: evalRes.side ?? "neutral",
                confidence: evalRes.confidence ?? 50,
                signalName: evalRes.signalName ?? "Scanning",
                sweepReason: evalRes.sweepReason ?? "",
                rsi: evalRes.rsi ?? 50,
                trend: evalRes.trend ?? "Consolidating",
              };
            }
          } catch {
            /* ignore individual errors */
          }
        })
      );

      setAgentStates((prev) => ({
        ...prev,
        ...updates,
      }));
    } finally {
      setRefreshing(false);
    }
  }, [http, globalTf]);

  useEffect(() => {
    loadAllAgents();
    const interval = setInterval(loadAllAgents, Math.max(4000, globalTf * 1000));
    return () => clearInterval(interval);
  }, [loadAllAgents, globalTf]);

  const placeManualTrade = async (agent: AgentDef, side: "buy" | "sell") => {
    if (tradingBusy[agent.symbol]) return;

    setTradingBusy((prev) => ({ ...prev, [agent.symbol]: true }));
    beepSound(side === "buy");
    onToast(`Executing manual ${side === "buy" ? "RISE" : "FALL"} on ${agent.name} ($${stake}, ${fmtShort(expirySec)})…`);

    try {
      const res = await apiFetch(`${http}/api/trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          broker: "deriv",
          asset: agent.symbol,
          side,
          amount: stake,
          seconds: expirySec,
        }),
      });

      const data = await res.json();
      if (data.status === "ok") {
        const tradeId = data.id;
        onToast(`Trade placed: Contract #${tradeId}. Watching outcome…`);

        setAgentStates((prev) => ({
          ...prev,
          [agent.symbol]: {
            ...prev[agent.symbol],
            lastTrade: {
              id: tradeId,
              side,
              stake,
              time: Date.now(),
              status: "pending",
            },
          },
        }));

        const poll = async () => {
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, Math.min(3000, (expirySec * 1000) / 4)));
            try {
              const rRes = await apiFetch(`${http}/api/trade-result?broker=deriv&id=${tradeId}&seconds=${expirySec}`);
              if (rRes.ok) {
                const rData = await rRes.json();
                if (rData.status === "ok" && rData.result) {
                  const won = rData.result === "win";
                  const profit = rData.profit;
                  beepSound(won);
                  onToast(`${agent.name} trade settled: ${won ? "WON" : "LOST"} (${profit != null ? `${profit >= 0 ? "+" : ""}$${profit.toFixed(2)}` : ""})!`);
                  setAgentStates((p) => ({
                    ...p,
                    [agent.symbol]: {
                      ...p[agent.symbol],
                      lastTrade: {
                        ...(p[agent.symbol]?.lastTrade ?? { id: tradeId, side, stake, time: Date.now() }),
                        status: won ? "won" : "lost",
                        profit,
                      },
                    },
                  }));
                  return;
                }
              }
            } catch {
              /* ignore interim errors */
            }
          }
        };
        void poll();
      } else {
        onToast(`Order rejected: ${data.msg || "Check balance or limits"}`);
      }
    } catch (e) {
      onToast(`Network error placing trade: ${String(e)}`);
    } finally {
      setTradingBusy((prev) => ({ ...prev, [agent.symbol]: false }));
    }
  };

  const activeTfLabel = TIMEFRAME_OPTIONS.find((t) => t.sec === globalTf)?.label ?? `${globalTf}s`;

  return (
    <div className="w-full min-h-screen bg-[#070b14] text-slate-100 flex flex-col pb-24 overflow-y-auto">
      {/* Header Bar */}
      <div className="sticky top-0 z-30 bg-[#0a1020]/95 backdrop-blur-md border-b border-[#1c2944] px-4 py-2.5 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500/20 via-blue-500/20 to-purple-500/30 border border-blue-500/30 flex items-center justify-center text-blue-400 shadow-lg shadow-blue-500/10">
              <Zap size={20} className="text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm md:text-base font-bold tracking-tight text-white flex items-center gap-1.5">
                  SIGNAL PACKAGE <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono">LIVE AGENT MATRIX</span>
                </h1>
              </div>
              <p className="text-[11px] text-slate-400">
                Tap any agent card to launch its full-screen live chart · Auto-promotes to #1 position on setup
              </p>
            </div>
          </div>

          {/* Deriv Balance & Demo Switch */}
          <div className="flex items-center gap-2 bg-[#0e1628] border border-[#1e2e4f] rounded-xl px-3 py-1.5">
            <Wallet size={16} className="text-blue-400" />
            <div className="flex flex-col text-right">
              <span className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold">Deriv Balance</span>
              <span className="text-xs md:text-sm font-bold font-mono text-emerald-400">
                {activeBalance != null ? `$${activeBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Connecting…"}
              </span>
            </div>
            <button
              onClick={() => onSwitchAccount(!isDemo)}
              className={`ml-2 text-[10px] font-bold px-2 py-1 rounded-md transition-all ${
                isDemo
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30"
                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30"
              }`}
            >
              {isDemo ? "DEMO" : "REAL"}
            </button>
            <button
              onClick={loadAllAgents}
              disabled={refreshing}
              className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 transition"
              title="Refresh all agent data"
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin text-blue-400" : ""} />
            </button>
          </div>
        </div>

        {/* Global Timeframe Button & Trading Config Toolbar */}
        <div className="max-w-7xl mx-auto mt-2.5 pt-2 border-t border-[#18243e] flex flex-wrap items-center justify-between gap-3">
          {/* SINGLE TIMEFRAME BUTTON (opens dropdown sheet modal) */}
          <div className="relative">
            <button
              onClick={() => setTfPickerOpen(true)}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-[#121f38] hover:bg-[#1a2d52] border border-[#20345d] text-white text-xs font-mono font-bold rounded-xl shadow-md transition cursor-pointer"
            >
              <Clock size={14} className="text-blue-400" />
              <span>Timeframe: {activeTfLabel}</span>
              <ChevronDown size={14} className="text-slate-400 ml-1" />
            </button>
          </div>

          {/* Stake & Expiry manual trading config */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-[#101b33] border border-[#1d2f54] rounded-lg px-2 py-1 text-xs">
              <span className="text-slate-400 font-medium">Stake:</span>
              <span className="font-bold font-mono text-white">$</span>
              <input
                type="number"
                min="1"
                max="10000"
                value={stake}
                onChange={(e) => setStake(Math.max(1, Number(e.target.value)))}
                className="w-12 bg-transparent font-mono font-bold text-white text-center focus:outline-none"
              />
              <div className="flex gap-1 ml-1">
                {[5, 10, 25, 50].map((s) => (
                  <button
                    key={s}
                    onClick={() => setStake(s)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                      stake === s ? "bg-blue-600 text-white font-bold" : "bg-[#182644] text-slate-300 hover:bg-[#22355c]"
                    }`}
                  >
                    ${s}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1 bg-[#101b33] border border-[#1d2f54] rounded-lg px-2 py-1 text-xs">
              <span className="text-slate-400 font-medium">Expiry:</span>
              <select
                value={expirySec}
                onChange={(e) => setExpirySec(Number(e.target.value))}
                className="bg-transparent font-mono font-bold text-white focus:outline-none cursor-pointer"
              >
                <option value={15} className="bg-[#0e1628]">15s</option>
                <option value={30} className="bg-[#0e1628]">30s</option>
                <option value={60} className="bg-[#0e1628]">1m (60s)</option>
                <option value={120} className="bg-[#0e1628]">2m</option>
                <option value={300} className="bg-[#0e1628]">5m</option>
              </select>
            </div>

            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-1.5 rounded-lg border transition ${
                soundEnabled
                  ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                  : "bg-slate-800 border-slate-700 text-slate-500"
              }`}
              title={soundEnabled ? "Mute trade sounds" : "Enable trade sounds"}
            >
              {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* TIMEFRAME SELECTOR MODAL SHEET */}
      {tfPickerOpen && (
        <div
          className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setTfPickerOpen(false)}
        >
          <div
            className="bg-[#0c1428] border border-blue-500/30 rounded-3xl max-w-sm w-full p-5 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#1c2b4c] mb-4">
              <div className="flex items-center gap-2">
                <Clock size={18} className="text-blue-400" />
                <h3 className="font-bold text-base text-white font-mono">Select Timeframe</h3>
              </div>
              <button
                onClick={() => setTfPickerOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 max-h-[60vh] overflow-y-auto pr-1">
              {TIMEFRAME_OPTIONS.map((t) => (
                <button
                  key={t.sec}
                  onClick={() => {
                    setGlobalTf(t.sec);
                    setTfPickerOpen(false);
                    onToast(`Timeframe updated to ${t.label}`);
                  }}
                  className={`p-3 rounded-2xl border text-xs font-mono font-bold transition flex items-center justify-between cursor-pointer ${
                    globalTf === t.sec
                      ? "bg-blue-600 text-white border-blue-400 shadow-lg shadow-blue-500/30 scale-[1.02]"
                      : "bg-[#111d38] text-slate-300 hover:bg-[#192b52] border border-[#1e3056]"
                  }`}
                >
                  <span>{t.label}</span>
                  {globalTf === t.sec && <span className="text-emerald-300">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TOP ROW: PREMIUM ANIMATED AGENT CARDS (16 AGENTS) */}
      <div className="max-w-7xl mx-auto px-4 mt-4 w-full">
        <div className="flex items-center justify-between mb-2 text-xs font-mono text-slate-400">
          <span className="flex items-center gap-1.5 text-white font-bold">
            <Sparkles size={14} className="text-emerald-400 animate-spin" /> AI AGENTS MATRIX (30 MARKETS)
          </span>
          <span>Tap any card to load full chart below</span>
        </div>

        {/* Scrollable Row of Premium Animated Agent Cards */}
        <div
          ref={topCardsBarRef}
          className="flex overflow-x-auto gap-3 pb-3 pt-1 scrollbar-thin scrollbar-thumb-blue-600/30 scroll-smooth"
        >
          {orderedAgents.map((ag, idx) => {
            const setup = sweep.alerts.find((a) => a.symbol === ag.symbol);
            const isSelected = ag.symbol === selectedAgentSymbol;
            const liveState = agentStates[ag.symbol];

            return (
              <button
                key={ag.symbol}
                onClick={() => setSelectedAgentSymbol(ag.symbol)}
                className={`flex-shrink-0 w-48 md:w-56 p-3 rounded-2xl border text-left transition-all duration-300 cursor-pointer flex flex-col justify-between relative overflow-hidden ${
                  isSelected
                    ? "bg-gradient-to-br from-[#0e1d3e] via-[#0b1630] to-[#081024] border-blue-400 shadow-xl shadow-blue-500/20 scale-[1.03] ring-2 ring-blue-500/40"
                    : setup?.ok
                    ? "bg-gradient-to-br from-emerald-950/70 via-[#0a1628] to-[#071020] border-emerald-500/60 shadow-lg shadow-emerald-500/10 hover:border-emerald-400 animate-pulse"
                    : "bg-[#091124] border-[#182748] hover:border-[#263e6e] opacity-90 hover:opacity-100"
                }`}
              >
                {/* Agent Header */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-7 h-7 rounded-xl flex items-center justify-center font-bold text-xs text-white shadow-sm shrink-0"
                      style={{ backgroundColor: ag.badgeColor }}
                    >
                      {ag.codename.slice(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="font-bold text-xs text-white truncate">{ag.codename}</span>
                        {idx === 0 && (
                          <span className="px-1 py-0.2 rounded bg-emerald-500/30 text-emerald-300 text-[9px] font-mono font-bold">
                            #1
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono truncate block">
                        {ag.symbol}
                      </span>
                    </div>
                  </div>

                  {setup?.ok && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold font-mono bg-emerald-500 text-black shadow-md animate-bounce shrink-0">
                      TAKE
                    </span>
                  )}
                </div>

                {/* Price & Change */}
                <div className="flex items-baseline justify-between mt-1 text-xs font-mono">
                  <span className="font-bold text-white">
                    {liveState?.price ? liveState.price.toFixed(liveState.price < 10 ? 3 : 2) : "..."}
                  </span>
                  <span className={`text-[10px] font-semibold ${liveState && liveState.changePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {liveState && liveState.changePct >= 0 ? "+" : ""}
                    {liveState ? liveState.changePct.toFixed(2) : 0}%
                  </span>
                </div>

                {/* Status bar */}
                <div className="mt-2 pt-2 border-t border-[#14213d] flex items-center justify-between text-[10px] font-mono">
                  <span className="text-slate-400 truncate max-w-[110px]">{ag.marketName.replace(" Index", "")}</span>
                  <span className={isSelected ? "text-blue-400 font-bold" : "text-slate-400"}>
                    {isSelected ? "Active View →" : "Tap Chart"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* SINGLE ACTIVE AGENT FULL SCREEN CHART VIEW */}
      <div className="max-w-7xl mx-auto px-4 mt-3 w-full flex-1">
        <div className="bg-[#091024] border border-[#182744] rounded-3xl p-4 md:p-6 shadow-2xl flex flex-col justify-between overflow-hidden relative">
          {/* Active Agent Header Info */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-3">
                <div
                  className="w-11 h-11 rounded-2xl flex items-center justify-center font-extrabold text-base text-white shadow-lg shrink-0"
                  style={{ backgroundColor: activeAgent.badgeColor }}
                >
                  {activeAgent.codename.slice(0, 2)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-extrabold text-lg md:text-xl text-white tracking-tight">{activeAgent.name}</h2>
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  </div>
                  <p className="text-xs text-slate-400 font-mono">
                    {activeAgent.symbol} · {activeAgent.marketName} · <span className="text-blue-400">{activeAgent.specialty}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => onOpenChart(activeAgent.symbol)}
                  className="px-3.5 py-1.5 bg-[#121e38] hover:bg-[#1a2b4e] border border-[#20345b] text-slate-200 hover:text-white text-xs font-semibold rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                  title="Open main chart"
                >
                  <Maximize2 size={15} />
                  <span>Main Chart Screen</span>
                </button>
              </div>
            </div>

            {/* Live Ticker & Price Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#050914] border border-[#14203b] rounded-2xl p-3.5 my-2">
              <div className="flex items-baseline gap-3">
                <span className="text-2xl md:text-3xl font-black font-mono text-white tracking-tight">
                  {priceInfo.price > 0 ? priceInfo.price.toFixed(priceInfo.price < 10 ? 4 : 2) : "---"}
                </span>
                <span
                  className={`text-xs md:text-sm font-mono font-bold flex items-center ${
                    priceInfo.changePct >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {priceInfo.changePct >= 0 ? (
                    <TrendingUp size={15} className="mr-1" />
                  ) : (
                    <TrendingDown size={15} className="mr-1" />
                  )}
                  {priceInfo.changePct >= 0 ? "+" : ""}
                  {priceInfo.changePct.toFixed(2)}%
                </span>
              </div>

              <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
                <span>Low: <b className="text-slate-200">{priceInfo.low > 0 && priceInfo.low !== Infinity ? priceInfo.low.toFixed(priceInfo.low < 10 ? 2 : 1) : "-"}</b></span>
                <span>High: <b className="text-slate-200">{priceInfo.high > 0 ? priceInfo.high.toFixed(priceInfo.high < 10 ? 2 : 1) : "-"}</b></span>
                <span className={`px-2.5 py-1 rounded-xl text-xs font-bold ${priceInfo.isUp ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-rose-500/20 text-rose-400 border border-rose-500/30"}`}>
                  {priceInfo.isUp ? "UPWARD FLOW" : "DOWNWARD FLOW"}
                </span>
              </div>
            </div>

            {/* Full Screen Interactive Lightweight Chart Canvas */}
            <AgentFullChart
              wsBase={wsBase}
              symbol={activeAgent.symbol}
              tf={globalTf}
              onPriceUpdate={handlePriceUpdate}
            />

            {/* Live Setup Banner & Screenshot Trigger */}
            <div className="mt-3">
              {activeSetup ? (
                <button
                  onClick={() => setZoomScreenshot(true)}
                  className={`w-full flex items-center justify-between gap-3 p-3.5 rounded-2xl border text-xs font-mono transition cursor-pointer shadow-xl ${
                    activeSetup.ok
                      ? activeSetup.side === "BUY"
                        ? "bg-gradient-to-r from-emerald-950/90 via-emerald-900/50 to-[#071120] border-emerald-500/70 hover:border-emerald-400 text-emerald-200"
                        : "bg-gradient-to-r from-rose-950/90 via-rose-900/50 to-[#071120] border-rose-500/70 hover:border-rose-400 text-rose-200"
                      : "bg-gradient-to-r from-blue-950/90 via-blue-900/50 to-[#071120] border-blue-500/60 hover:border-blue-400 text-blue-200"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Camera size={18} className="text-emerald-400" />
                    <span className="font-extrabold text-white text-sm">{activeSetup.side} SETUP DETECTED</span>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${activeSetup.ok ? "bg-emerald-500 text-black font-extrabold" : "bg-blue-500/30 text-blue-200 border border-blue-500/40"}`}>
                      {activeSetup.ok ? "TAKE CONTRACT" : "WATCHING"}
                    </span>
                    <span className="text-slate-300 text-xs hidden md:inline truncate">{activeSetup.notes.join(" · ")}</span>
                  </div>

                  <span className="text-xs font-bold text-white underline flex items-center gap-1.5 shrink-0 bg-white/10 px-3.5 py-1.5 rounded-xl hover:bg-white/20 transition">
                    <span>View Real Screenshot</span> →
                  </span>
                </button>
              ) : (
                <div className="flex items-center justify-between p-3.5 bg-[#050914] border border-[#14203b] rounded-2xl text-xs font-mono">
                  <span className="text-slate-400">Agent Strategy Monitor:</span>
                  <span className="text-slate-300">Scanning Deriv live market tick flow...</span>
                </div>
              )}
            </div>

            {/* Modal Screenshot Overlay */}
            {zoomScreenshot && activeSetup && (
              <div className="fixed inset-0 z-[110] bg-black/95 backdrop-blur-md flex items-center justify-center p-3" onClick={() => setZoomScreenshot(false)}>
                <div className="relative max-w-5xl w-full bg-[#0a1020] border border-blue-500/40 rounded-3xl p-5 overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between pb-3 border-b border-[#1c2a4a] mb-3">
                    <div className="flex items-center gap-3">
                      <Camera size={22} className="text-emerald-400" />
                      <div>
                        <h3 className="text-base font-bold text-white font-mono">{activeAgent.name} · Real Market Screenshot</h3>
                        <p className="text-xs text-slate-400 font-mono">{activeAgent.marketName} ({activeAgent.symbol}) · Real Deriv Live Candles</p>
                      </div>
                    </div>
                    <button onClick={() => setZoomScreenshot(false)} className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition cursor-pointer">
                      Close ✕
                    </button>
                  </div>
                  <div className="w-full max-h-[75vh] flex items-center justify-center overflow-auto rounded-2xl bg-black/50 border border-[#14213d] p-3">
                    <img alt={`Live Deriv SVG screenshot for ${activeAgent.name}`} src={`${http}/api/sweep/image/${activeSetup.id}`} className="max-w-full max-h-[70vh] object-contain shadow-2xl rounded-lg" />
                  </div>
                  <div className="mt-4 pt-3 border-t border-[#1c2a4a] flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-slate-300">
                    <span>Signal Candle: {new Date(activeSetup.candle_time * 1000).toLocaleTimeString()} UTC</span>
                    <span className="text-emerald-400 font-bold">{activeSetup.notes.join(" · ") || "100% Real Deriv Live Data"}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Trade Execution Dock */}
          <div className="mt-4 pt-3 border-t border-[#162442]">
            {agentStates[activeAgent.symbol]?.lastTrade && (
              <div
                className={`text-xs font-mono px-3.5 py-2 rounded-xl mb-3 flex items-center justify-between ${
                  agentStates[activeAgent.symbol].lastTrade?.status === "won"
                    ? "bg-emerald-950/80 border border-emerald-500/50 text-emerald-300"
                    : agentStates[activeAgent.symbol].lastTrade?.status === "lost"
                    ? "bg-rose-950/80 border border-rose-500/50 text-rose-300"
                    : "bg-blue-950/80 border border-blue-500/50 text-blue-300 animate-pulse"
                }`}
              >
                <span>Contract #{agentStates[activeAgent.symbol].lastTrade?.id} ({agentStates[activeAgent.symbol].lastTrade?.side.toUpperCase()})</span>
                <span className="font-bold">
                  {agentStates[activeAgent.symbol].lastTrade?.status === "pending"
                    ? "Watching outcome..."
                    : agentStates[activeAgent.symbol].lastTrade?.status === "won"
                    ? `WON +$${(agentStates[activeAgent.symbol].lastTrade?.profit ?? 0).toFixed(2)}`
                    : "LOSS"}
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3.5">
              <button
                onClick={() => placeManualTrade(activeAgent, "buy")}
                disabled={!!tradingBusy[activeAgent.symbol]}
                className="flex items-center justify-center gap-2 py-3.5 px-4 bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 hover:from-emerald-500 hover:to-teal-400 active:scale-98 disabled:opacity-50 text-white font-extrabold text-sm md:text-base rounded-2xl shadow-xl shadow-emerald-500/20 transition-all cursor-pointer"
              >
                <ArrowUpRight size={20} strokeWidth={3} />
                <span>{tradingBusy[activeAgent.symbol] ? "PLACING..." : "EXECUTE RISE (CALL)"}</span>
              </button>

              <button
                onClick={() => placeManualTrade(activeAgent, "sell")}
                disabled={!!tradingBusy[activeAgent.symbol]}
                className="flex items-center justify-center gap-2 py-3.5 px-4 bg-gradient-to-r from-rose-600 via-rose-500 to-pink-500 hover:from-rose-500 hover:to-pink-400 active:scale-98 disabled:opacity-50 text-white font-extrabold text-sm md:text-base rounded-2xl shadow-xl shadow-rose-500/20 transition-all cursor-pointer"
              >
                <ArrowDownRight size={20} strokeWidth={3} />
                <span>{tradingBusy[activeAgent.symbol] ? "PLACING..." : "EXECUTE FALL (PUT)"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
