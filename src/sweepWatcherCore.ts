// Watches every agent's market (the logic; sweepWatcher.ts plugs in the live Deriv data). When a candle CLOSES, the three engines (src/sweepEngines.ts) look at it; every real setup gets a
// screenshot (src/sweepChart.ts) that the Menu and the agent cards show. Nothing else is ever posted: no filler "snapshot" charts.
import { C, EngineName, Verdict, detectAll, isFlat } from './sweepEngines';
import { renderAlertSvg } from './sweepChart';

export interface SweepAlertData {
  id: number;
  symbol: string;
  name: string;
  market: string;
  tf: number;
  candle_time: number;          // open time of the last closed candle of the pattern
  engine: EngineName;           // sweep | continuation | momentum
  side: 'BUY' | 'SELL';
  ok: boolean;                  // TAKE (true) or SKIP (false)
  block: string | null;
  notes: string[];
  entry: number;
  swept_level: number;
  trade_at_next_open: boolean;  // continuation + momentum: the trade opens on the next candle
  conflict: boolean;            // another engine fired the opposite side on the same candle (both alerts are flagged)
  trace: string[];              // continuation + momentum: the exact arithmetic of every check that qualified the setup
  created: number;
  live: boolean;                // false = found while loading recent history
  svg: string;
}

export interface SweepAgent { symbol: string; name: string; market: string }



const PATTERN_LEN: Record<EngineName, number> = { sweep: 2, momentum: 3, continuation: 4 };
const FETCH = 70;            // candles read per market and check
const WINDOW = 45;           // candles an engine gets to look at
const KEEP = 300;            // alerts kept in memory
const DELAY_SEC = 2.5;       // wait after a candle boundary so the broker has published the closed candle
const CONCURRENCY = 6;

export interface WatcherDeps {
  fetchCandles: (symbol: string, tf: number, count: number) => Promise<C[]>;
  now: () => Promise<number>;          // BROKER clock in seconds: candle times follow it, so closed/forming is decided with it
  sleep: (ms: number) => Promise<void>;
}

export class SweepWatcherService {
  private alerts: SweepAlertData[] = [];
  private seenKeys = new Set<string>();
  private nextId = 1;
  private token = 0;                    // changes on every start/stop so an old loop ends itself
  private running = false;
  private tf = 60;
  private lastRun = 0;
  private status = new Map<string, { lastCandle: number; error: string }>();

  constructor(private opts: { agents: SweepAgent[]; deps: WatcherDeps; autostart?: boolean }) {
    this.agents.forEach((a) => this.status.set(a.symbol, { lastCandle: 0, error: '' }));
    if (opts.autostart) this.start(60, 60);
  }

  private get agents(): SweepAgent[] { return this.opts.agents; }
  private get deps(): WatcherDeps { return this.opts.deps; }

  /** backfill = also look through that many recent closed candles (shown as "earlier", never as live). */
  public start(tf = 60, backfill = 0) {
    this.stop();
    this.tf = [30, 60, 120, 180, 300].includes(tf) ? tf : 60;
    this.running = true;
    const token = ++this.token;
    console.log(`[SweepWatcher] watching ${this.agents.length} markets on ${this.tf}s candles`);
    this.loop(token, Math.max(0, Math.min(Math.floor(backfill), 300))).catch((e) => console.warn('[SweepWatcher] loop stopped:', e));
  }

  public stop() {
    this.token++;
    this.running = false;
  }

  public clear() {
    this.alerts = [];                   // seenKeys stays on purpose: cleared setups do not come back
  }

  private async loop(token: number, backfill: number) {
    await this.runPass(backfill);
    while (token === this.token) {
      const now = await this.deps.now();
      const wait = (Math.floor(now / this.tf) + 1) * this.tf + DELAY_SEC - now;
      await this.deps.sleep(Math.max(500, wait * 1000));
      if (token !== this.token) return;
      await this.runPass(0);
    }
  }

  public getAlerts(since = 0, limit = 60) {
    const list = this.alerts.filter((a) => a.id > since);
    list.sort((a, b) => b.candle_time - a.candle_time || b.id - a.id);
    return list.slice(0, Math.max(1, Math.min(300, limit))).map(({ svg: _svg, ...rest }) => rest);
  }

  public getAlertSvg(id: number): string | null {
    return this.alerts.find((a) => a.id === id)?.svg ?? null;
  }

  public getState() {
    const failed = this.agents.filter((a) => this.status.get(a.symbol)?.error).map((a) => a.symbol);
    return {
      running: this.running,
      tf: this.tf,
      agents: this.agents.length,
      last_run: this.lastRun,
      last_id: this.alerts.length ? Math.max(...this.alerts.map((a) => a.id)) : 0,
      total: this.alerts.length,
      now: Math.floor(Date.now() / 1000),
      failed,
      markets: this.agents.map((a) => ({ symbol: a.symbol, name: a.name, last_candle: this.status.get(a.symbol)?.lastCandle ?? 0, error: this.status.get(a.symbol)?.error ?? '' })),
    };
  }

  /** One check of all markets. Public so the tests can drive it. */
  public async runPass(backfill: number) {
    this.lastRun = Math.floor(await this.deps.now());
    const tf = this.tf;
    const queue = [...this.agents];
    const worker = async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        try { await this.checkAgent(a, tf, backfill); }
        catch (e) { const s = this.status.get(a.symbol)!; s.error = (e instanceof Error ? e.message : String(e)).slice(0, 120) || 'error'; }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  private async checkAgent(a: SweepAgent, tf: number, backfill: number) {
    let closed: C[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {         // the broker can publish the closed candle a moment late
      const now = await this.deps.now();
      const want = Math.floor(now / tf) * tf - tf;           // open time of the candle that should have just closed
      const raw = await this.deps.fetchCandles(a.symbol, tf, FETCH + backfill);
      closed = raw.filter((c) => c.time + tf <= now).sort((x, y) => x.time - y.time);   // closed candles only
      if (closed.length && closed[closed.length - 1].time >= want) break;
      if (attempt < 3) await this.deps.sleep(2000);
    }
    if (closed.length < 15) throw new Error(closed.length ? 'not enough candles' : 'no candles');
    const st = this.status.get(a.symbol)!;
    st.lastCandle = closed[closed.length - 1].time;
    st.error = '';

    const start = backfill > 0 ? Math.max(12, closed.length - backfill) : closed.length - 1;
    for (let i = start; i < closed.length; i++) {
      const win = closed.slice(Math.max(0, i - WINDOW + 1), i + 1);
      if (win.slice(-8).some(isFlat)) continue;               // broker filler candles are not price action
      const found = detectAll(win, win.length - 1);
      const conflict = new Set(found.filter((v) => v.ok).map((v) => v.side)).size > 1;   // BUY and SELL from different engines on one candle
      for (const v of found) this.emit(a, tf, win, v, backfill === 0, conflict);
    }
  }

  private emit(a: SweepAgent, tf: number, win: C[], v: Verdict, live: boolean, conflict = false) {
    const sig = win[win.length - 1];
    const key = `${a.symbol}|${tf}|${v.engine}|${sig.time}`;
    if (this.seenKeys.has(key)) return;
    this.seenKeys.add(key);
    if (this.seenKeys.size > 20000) this.seenKeys.delete(this.seenKeys.values().next().value as string);
    const svg = renderAlertSvg(win, {
      engine: v.engine, side: v.side, ok: v.ok, swept_level: v.sweptLevel, tf, market: a.market, symbol: a.symbol,
      block: v.block, notes: v.notes, patternLen: PATTERN_LEN[v.engine],
    });
    this.alerts.push({
      id: this.nextId++, symbol: a.symbol, name: a.name, market: a.market, tf, candle_time: sig.time, engine: v.engine, side: v.side,
      ok: v.ok, block: v.block, notes: v.notes, entry: v.entry, swept_level: v.sweptLevel, trade_at_next_open: v.tradeAtNextOpen,
      conflict, trace: v.trace ?? [],
      created: Math.floor(Date.now() / 1000), live, svg,
    });
    if (this.alerts.length > KEEP) this.alerts.shift();
  }
}

