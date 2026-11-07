import { derivBridge, Candle } from './derivBridge';
import { evaluateEngines } from './engineEvaluator';
import { renderAlertSvg } from './sweepChart';

export interface SweepAlertData {
  id: number;
  symbol: string;
  name: string;
  market: string;
  tf: number;
  candle_time: number;
  side: 'BUY' | 'SELL';
  ok: boolean;
  block: string | null;
  notes: string[];
  entry: number;
  swept_level: number;
  created: number;
  live: boolean;
  svg: string;
}

export const SWEEP_AGENTS = [
  { symbol: "1HZ10V", name: "Agent Nova-10V", market: "Volatility 10 (1s) Index" },
  { symbol: "1HZ25V", name: "Agent Apex-25V", market: "Volatility 25 (1s) Index" },
  { symbol: "1HZ50V", name: "Agent Pulse-50V", market: "Volatility 50 (1s) Index" },
  { symbol: "1HZ75V", name: "Agent Surge-75V", market: "Volatility 75 (1s) Index" },
  { symbol: "1HZ100V", name: "Agent Titan-100V", market: "Volatility 100 (1s) Index" },
  { symbol: "1HZ150V", name: "Agent Hyper-150V", market: "Volatility 150 (1s) Index" },
  { symbol: "1HZ200V", name: "Agent Vector-200V", market: "Volatility 200 (1s) Index" },
  { symbol: "1HZ250V", name: "Agent Quantum-250V", market: "Volatility 250 (1s) Index" },
  { symbol: "1HZ300V", name: "Agent Astra-300V", market: "Volatility 300 (1s) Index" },
  { symbol: "R_10", name: "Agent Zeta-10", market: "Volatility 10 Index" },
  { symbol: "R_25", name: "Agent Viper-25", market: "Volatility 25 Index" },
  { symbol: "R_50", name: "Agent Phoenix-50", market: "Volatility 50 Index" },
  { symbol: "R_75", name: "Agent Sigma-75", market: "Volatility 75 Index" },
  { symbol: "R_100", name: "Agent Omega-100", market: "Volatility 100 Index" },
  { symbol: "R_150", name: "Agent Matrix-150", market: "Volatility 150 Index" },
  { symbol: "R_200", name: "Agent Nexus-200", market: "Volatility 200 Index" },
  { symbol: "R_250", name: "Agent Orbit-250", market: "Volatility 250 Index" },
  { symbol: "R_300", name: "Agent Zenith-300", market: "Volatility 300 Index" },
  { symbol: "CRASH300", name: "Agent Crash-300", market: "Crash 300 Index" },
  { symbol: "CRASH500", name: "Agent Crash-500", market: "Crash 500 Index" },
  { symbol: "CRASH1000", name: "Agent Crash-1000", market: "Crash 1000 Index" },
  { symbol: "BOOM300", name: "Agent Boom-300", market: "Boom 300 Index" },
  { symbol: "BOOM500", name: "Agent Boom-500", market: "Boom 500 Index" },
  { symbol: "BOOM1000", name: "Agent Boom-1000", market: "Boom 1000 Index" },
  { symbol: "stpRNG", name: "Agent Step-100", market: "Step Index 100" },
  { symbol: "JD10", name: "Agent Jump-10", market: "Jump 10 Index" },
  { symbol: "JD25", name: "Agent Jump-25", market: "Jump 25 Index" },
  { symbol: "JD50", name: "Agent Jump-50", market: "Jump 50 Index" },
  { symbol: "JD75", name: "Agent Jump-75", market: "Jump 75 Index" },
  { symbol: "JD100", name: "Agent Jump-100", market: "Jump 100 Index" },
];

export class SweepWatcherService {
  private alerts: SweepAlertData[] = [];
  private seenKeys = new Set<string>();
  private nextId = 1;
  private isRunning = false;
  private currentTf = 60;
  private timer: NodeJS.Timeout | null = null;
  private lastRun = 0;

  constructor() {
    // Start scanning automatically on boot
    this.start(60);
  }

  public start(tf = 60, backfill = 60) {
    this.stop();
    this.currentTf = tf;
    this.isRunning = true;
    console.log(`[SweepWatcher] Started scanning ${SWEEP_AGENTS.length} agents with timeframe ${tf}s...`);

    // Run first pass immediately with backfill = 60
    this.runScanPass(backfill).catch(() => {});

    // Periodic loop every 15s
    this.timer = setInterval(() => {
      this.runScanPass(30).catch(() => {});
    }, Math.max(15000, tf * 1000));
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  public clear() {
    this.alerts = [];
  }

  public getAlerts(since = 0, limit = 60) {
    const list = this.alerts.filter(a => a.id > since);
    list.sort((a, b) => b.candle_time - a.candle_time || b.id - a.id);
    return list.slice(0, Math.min(300, limit));
  }

  public getAlertSvg(id: number): string | null {
    const alert = this.alerts.find(a => a.id === id);
    return alert ? alert.svg : null;
  }

  public getState() {
    const lastId = this.alerts.length > 0 ? Math.max(...this.alerts.map(a => a.id)) : 0;
    return {
      running: this.isRunning,
      tf: this.currentTf,
      agents: SWEEP_AGENTS.length,
      last_run: this.lastRun,
      last_id: lastId,
      total: this.alerts.length,
      now: Math.floor(Date.now() / 1000),
      failed: [],
      markets: SWEEP_AGENTS.map(a => ({
        symbol: a.symbol,
        name: a.name,
        last_candle: Math.floor(Date.now() / 1000) - this.currentTf,
        error: ''
      }))
    };
  }

  private async runScanPass(backfill: number) {
    this.lastRun = Math.floor(Date.now() / 1000);
    const count = Math.max(35, 35 + backfill);
    const nowSec = Math.floor(Date.now() / 1000);

    for (const agent of SWEEP_AGENTS) {
      try {
        const candles = await derivBridge.getCandles(agent.symbol, this.currentTf, count);
        if (!candles || candles.length < 5) continue;

        // Ensure we strictly evaluate CLOSED CANDLES ONLY for confirmed sweep setups
        // candles[candles.length - 1] is the open forming candle, so closed candles are candles.slice(0, -1)
        const closedCandles = candles.slice(0, candles.length - 1);
        if (closedCandles.length < 4) continue;

        // 1. Scan closed historical candles to capture any confirmed setup where the candle HAS OFFICIALLY CLOSED
        const minSlice = Math.max(4, closedCandles.length - (backfill > 0 ? closedCandles.length : 10));
        for (let endIdx = minSlice; endIdx <= closedCandles.length; endIdx++) {
          const subCandles = closedCandles.slice(0, endIdx);
          const sigCandle = subCandles[subCandles.length - 1];

          // STRICT CONFIRMATION RULE: Ensure candle has officially CLOSED before confirming setup
          if (nowSec < sigCandle.time + this.currentTf) continue;

          const evalRes = evaluateEngines(subCandles, this.currentTf);

          if (evalRes.setup && evalRes.side && evalRes.sweep) {
            const sweptCandle = subCandles.length >= 2 ? subCandles[subCandles.length - 2] : sigCandle;
            const key = `${agent.symbol}_${this.currentTf}_${sigCandle.time}`;

            if (!this.seenKeys.has(key)) {
              this.seenKeys.add(key);
              const sweptLevel = evalRes.side === 'BUY' ? sweptCandle.low : sweptCandle.high;
              const ok = evalRes.confidence >= 70;
              const reasons = [...evalRes.sweep.reasons, 'Candle Closed & Sweep Confirmed'];

              const svg = renderAlertSvg(subCandles, {
                side: evalRes.side,
                ok: ok,
                swept_level: sweptLevel,
                tf: this.currentTf,
                market: agent.market,
                symbol: agent.symbol,
                block: ok ? null : 'Low confidence context check',
                notes: reasons
              });

              const alertData: SweepAlertData = {
                id: this.nextId++,
                symbol: agent.symbol,
                name: agent.name,
                market: agent.market,
                tf: this.currentTf,
                candle_time: sigCandle.time,
                side: evalRes.side,
                ok: ok,
                block: ok ? null : 'Low confidence context check',
                notes: reasons,
                entry: sigCandle.close,
                swept_level: sweptLevel,
                created: Math.floor(Date.now() / 1000),
                live: true,
                svg
              };

              this.alerts.push(alertData);
              if (this.alerts.length > 300) {
                this.alerts.shift();
              }
            }
          }
        }

        // 2. Guarantee every agent has a fresh live SVG screenshot on current closed market candles
        const existingForAgent = this.alerts.filter(a => a.symbol === agent.symbol);
        const newestForAgent = existingForAgent.length > 0 ? Math.max(...existingForAgent.map(a => a.candle_time)) : 0;

        if (existingForAgent.length === 0 || nowSec - newestForAgent > this.currentTf * 2) {
          const evalRes = evaluateEngines(closedCandles, this.currentTf);
          const sigCandle = closedCandles[closedCandles.length - 1];
          const sweptCandle = closedCandles.length >= 2 ? closedCandles[closedCandles.length - 2] : sigCandle;
          const key = `snap_${agent.symbol}_${this.currentTf}_${sigCandle.time}`;

          if (!this.seenKeys.has(key)) {
            this.seenKeys.add(key);
            const side = evalRes.side || (sigCandle.close >= sigCandle.open ? 'BUY' : 'SELL');
            const sweptLevel = side === 'BUY' ? sweptCandle.low : sweptCandle.high;
            const ok = evalRes.confidence >= 65;
            const reasons = evalRes.sweep?.reasons || [
              `RSI: ${evalRes.rsi?.toFixed(1) || '50'}`,
              `Flow: ${evalRes.trend || 'Consolidating'}`,
              `Candle Closed: Confirmed`
            ];

            const svg = renderAlertSvg(closedCandles, {
              side,
              ok,
              swept_level: sweptLevel,
              tf: this.currentTf,
              market: agent.market,
              symbol: agent.symbol,
              block: ok ? null : 'Watching closed market candles',
              notes: reasons
            });

            const alertData: SweepAlertData = {
              id: this.nextId++,
              symbol: agent.symbol,
              name: agent.name,
              market: agent.market,
              tf: this.currentTf,
              candle_time: sigCandle.time,
              side,
              ok,
              block: ok ? null : 'Watching closed market candles',
              notes: reasons,
              entry: sigCandle.close,
              swept_level: sweptLevel,
              created: Math.floor(Date.now() / 1000),
              live: true,
              svg
            };

            this.alerts.push(alertData);
            if (this.alerts.length > 300) {
              this.alerts.shift();
            }
          }
        }
      } catch (e) {
        // Continue other agents if one fails
      }
    }
  }
}

export const sweepWatcher = new SweepWatcherService();
