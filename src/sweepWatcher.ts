// Live wiring: the agents' markets, Deriv data with the broker's clock, and the one watcher the server uses.
import { derivBridge } from './derivBridge';
import { SweepWatcherService, SweepAgent, WatcherDeps } from './sweepWatcherCore';

export type { SweepAlertData, SweepAgent, WatcherDeps } from './sweepWatcherCore';
export { SweepWatcherService } from './sweepWatcherCore';

export const SWEEP_AGENTS: SweepAgent[] = [
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

let clockOffset = 0, clockAt = 0;
const liveDeps: WatcherDeps = {
  fetchCandles: (symbol, tf, count) => derivBridge.getCandles(symbol, tf, count),
  now: async () => {
    const local = Date.now() / 1000;
    if (local - clockAt > 60) {
      try {
        const r = await derivBridge.requestPublic({ time: 1 }, 5000);
        if (r && Number(r.time) > 0) { clockOffset = Number(r.time) - local; clockAt = local; }
      } catch { /* keep the last offset */ }
    }
    return local + clockOffset;
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export const sweepWatcher = new SweepWatcherService({ agents: SWEEP_AGENTS, deps: liveDeps, autostart: true });
