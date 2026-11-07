import { WebSocket } from 'ws';
import fs from 'fs';
import https from 'https';

const SESSION_FILE = '/tmp/deriv_token.txt';
const REST_BASE = 'https://api.derivws.com';

const WS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Origin': 'https://app.deriv.com',
  'Accept-Language': 'en-US,en;q=0.9'
};

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface DerivAsset {
  symbol: string;
  name: string;
  payout: number;
  active: boolean;
}

const DEFAULT_SYNTHETICS: DerivAsset[] = [
  { symbol: "1HZ10V", name: "Volatility 10 (1s) Index", payout: 95, active: true },
  { symbol: "1HZ25V", name: "Volatility 25 (1s) Index", payout: 95, active: true },
  { symbol: "1HZ50V", name: "Volatility 50 (1s) Index", payout: 95, active: true },
  { symbol: "1HZ75V", name: "Volatility 75 (1s) Index", payout: 95, active: true },
  { symbol: "1HZ100V", name: "Volatility 100 (1s) Index", payout: 95, active: true },
  { symbol: "1HZ150V", name: "Volatility 150 (1s) Index", payout: 95, active: true },
  { symbol: "1HZ200V", name: "Volatility 200 (1s) Index", payout: 95, active: true },
  { symbol: "1HZ250V", name: "Volatility 250 (1s) Index", payout: 95, active: true },
  { symbol: "1HZ300V", name: "Volatility 300 (1s) Index", payout: 95, active: true },
  { symbol: "R_10", name: "Volatility 10 Index", payout: 95, active: true },
  { symbol: "R_25", name: "Volatility 25 Index", payout: 95, active: true },
  { symbol: "R_50", name: "Volatility 50 Index", payout: 95, active: true },
  { symbol: "R_75", name: "Volatility 75 Index", payout: 95, active: true },
  { symbol: "R_100", name: "Volatility 100 Index", payout: 95, active: true },
  { symbol: "R_150", name: "Volatility 150 Index", payout: 95, active: true },
  { symbol: "R_200", name: "Volatility 200 Index", payout: 95, active: true },
  { symbol: "R_250", name: "Volatility 250 Index", payout: 95, active: true },
  { symbol: "R_300", name: "Volatility 300 Index", payout: 95, active: true },
  { symbol: "BOOM300", name: "Boom 300 Index", payout: 95, active: true },
  { symbol: "BOOM500", name: "Boom 500 Index", payout: 95, active: true },
  { symbol: "BOOM1000", name: "Boom 1000 Index", payout: 95, active: true },
  { symbol: "CRASH300", name: "Crash 300 Index", payout: 95, active: true },
  { symbol: "CRASH500", name: "Crash 500 Index", payout: 95, active: true },
  { symbol: "CRASH1000", name: "Crash 1000 Index", payout: 95, active: true },
  { symbol: "stpRNG", name: "Step Index 100", payout: 95, active: true },
  { symbol: "STEP", name: "Step Index", payout: 95, active: true },
  { symbol: "JD10", name: "Jump 10 Index", payout: 95, active: true },
  { symbol: "JD25", name: "Jump 25 Index", payout: 95, active: true },
  { symbol: "JD50", name: "Jump 50 Index", payout: 95, active: true },
  { symbol: "JD75", name: "Jump 75 Index", payout: 95, active: true },
  { symbol: "JD100", name: "Jump 100 Index", payout: 95, active: true },
];

export class DerivBridge {
  public token: string = '';
  public appId: string = '34QcI4Rf8S5tCkL6PMOcI';
  public accountId: string = '';
  public ready: boolean = false;
  public error: string = '';
  public authError: string = '';
  public balance: number | null = null;
  public currency: string = 'USD';
  public isDemo: boolean = true;
  public assets: DerivAsset[] = [...DEFAULT_SYNTHETICS];
  public accountList: Array<{ loginid: string; is_virtual: number; account_type?: string }> = [];

  private publicWs: WebSocket | null = null;
  private authWs: WebSocket | null = null;
  private pendingPublicRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private pendingAuthRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private reqId = 1;
  private authReqId = 1000;
  private tickSubscribers = new Map<string, Set<(price: number, epoch: number) => void>>();
  private tickSubIds = new Map<string, string>();
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.loadToken();
    this.connectPublicWs();
    this.initAuth();
  }

  private loadToken() {
    let rawToken = process.env.DERIV_TOKEN || process.env.DERIV_API_KEY || '';
    if (!rawToken && fs.existsSync(SESSION_FILE)) {
      try {
        rawToken = fs.readFileSync(SESSION_FILE, 'utf-8').trim();
      } catch {}
    }
    if (!rawToken) {
      rawToken = 'pat_12430e9f3555e6dd3a2ad5bb86555b0a530667adbd0b8efd1f97b3abdcdaf106';
    }
    this.parseTokenString(rawToken);
  }

  public parseTokenString(raw: string) {
    const parts = raw.split('|').map(p => p.trim());
    if (parts[0]) this.token = parts[0];
    if (parts[1]) this.appId = parts[1];
    if (parts[2]) this.accountId = parts[2];
  }

  public setCredentials(raw: string) {
    this.parseTokenString(raw);
    try {
      fs.writeFileSync(SESSION_FILE, raw);
    } catch {}
    this.authError = '';
    this.balance = null;
    this.initAuth();
  }

  // --- 1. Public Market Data Connection ---
  private connectPublicWs() {
    const primaryUrl = 'wss://api.derivws.com/trading/v1/options/ws/public';
    console.log(`[DerivBridge] Connecting public market stream to ${primaryUrl}...`);

    try {
      this.publicWs = new WebSocket(primaryUrl, { headers: WS_HEADERS });

      this.publicWs.on('open', () => {
        console.log(`[DerivBridge] Public Market Data Connected`);
        this.ready = true;
        this.error = '';

        // Load active symbols
        this.requestPublic({ active_symbols: 'brief', product_type: 'basic' }).then((res) => {
          if (res && Array.isArray(res.active_symbols)) {
            const parsed = res.active_symbols
              .filter((s: any) => {
                const sym = (s.symbol || '').toUpperCase();
                return sym.startsWith('R_') || sym.startsWith('1HZ') || sym.startsWith('BOOM') ||
                  sym.startsWith('CRASH') || sym.startsWith('STEP') || sym.startsWith('JD');
              })
              .map((s: any) => ({
                symbol: s.symbol,
                name: s.display_name || s.symbol,
                payout: 95,
                active: !s.is_trading_suspended && (s.exchange_is_open === 1 || s.exchange_is_open === undefined)
              }));
            if (parsed.length > 0) {
              this.assets = parsed;
            }
          }
        }).catch(() => {});
      });

      this.publicWs.on('message', (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.req_id && this.pendingPublicRequests.has(msg.req_id)) {
            const { resolve } = this.pendingPublicRequests.get(msg.req_id)!;
            this.pendingPublicRequests.delete(msg.req_id);
            resolve(msg);
          }

          if (msg.msg_type === 'tick' && msg.tick) {
            const sym = msg.tick.symbol;
            const price = Number(msg.tick.quote);
            const epoch = Number(msg.tick.epoch);
            if (msg.subscription && msg.subscription.id && sym) {
              this.tickSubIds.set(sym, msg.subscription.id);
            }
            if (sym && this.tickSubscribers.has(sym)) {
              for (const cb of this.tickSubscribers.get(sym)!) {
                cb(price, epoch);
              }
            }
          }
        } catch {}
      });

      this.publicWs.on('error', (err) => {
        console.warn(`[DerivBridge] Public WS Warning: ${err.message}`);
        this.ready = false;
      });

      this.publicWs.on('close', () => {
        this.ready = false;
        setTimeout(() => this.connectPublicWs(), 4000);
      });
    } catch (err: any) {
      this.error = `Failed to connect public market WS: ${err.message}`;
    }
  }

  // --- 2. Authenticated Account Connection via REST OTP ---
  public async initAuth() {
    if (!this.token || this.token.startsWith('MY_')) {
      this.authError = 'No Deriv API Token configured. Enter your PAT on the API screen.';
      return;
    }

    try {
      // Step A: Fetch accounts list
      const accountsRes = await this.httpApiGet('/trading/v1/options/accounts');
      if (!accountsRes || !Array.isArray(accountsRes.data) || accountsRes.data.length === 0) {
        this.authError = 'No Deriv accounts found on this token';
        return;
      }

      const accList = accountsRes.data;
      this.accountList = accList.map((a: any) => ({
        loginid: a.account_id,
        is_virtual: a.account_type === 'demo' ? 1 : 0,
        account_type: a.account_type
      }));

      // Find matching account (demo vs real)
      let selectedAcc = accList.find((a: any) => (a.account_type === 'demo') === this.isDemo);
      if (!selectedAcc) selectedAcc = accList[0];

      this.accountId = selectedAcc.account_id;
      this.balance = Number(selectedAcc.balance || 0);
      this.currency = selectedAcc.currency || 'USD';
      this.isDemo = selectedAcc.account_type === 'demo';

      console.log(`[DerivBridge] Deriv Account Identified: ${this.accountId} (${this.isDemo ? 'DEMO' : 'REAL'}). Balance: ${this.balance} ${this.currency}`);

      // Step B: Fetch OTP WebSocket URL
      const otpRes = await this.httpApiPost(`/trading/v1/options/accounts/${this.accountId}/otp`);
      if (!otpRes || !otpRes.data || !otpRes.data.url) {
        this.authError = 'Failed to obtain Deriv OTP session';
        return;
      }

      const otpUrl = otpRes.data.url;
      this.connectAuthWs(otpUrl);
    } catch (err: any) {
      this.authError = `Deriv Login Exception: ${err.message}`;
      console.warn(`[DerivBridge] Auth initialization error: ${err.message}`);
    }
  }

  private connectAuthWs(otpUrl: string) {
    if (this.authWs) {
      try { this.authWs.close(); } catch {}
      this.authWs = null;
    }

    try {
      this.authWs = new WebSocket(otpUrl, { headers: WS_HEADERS });

      this.authWs.on('open', () => {
        console.log(`[DerivBridge] Authenticated Deriv Session Opened (${this.accountId})`);
        this.authError = '';
        // Subscribe to live balance updates
        this.requestAuth({ balance: 1, subscribe: 1 }).catch(() => {});
      });

      this.authWs.on('message', (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.req_id && this.pendingAuthRequests.has(msg.req_id)) {
            const { resolve } = this.pendingAuthRequests.get(msg.req_id)!;
            this.pendingAuthRequests.delete(msg.req_id);
            resolve(msg);
          }

          if (msg.msg_type === 'balance' && msg.balance) {
            this.balance = Number(msg.balance.balance);
            this.currency = msg.balance.currency || this.currency;
          }
        } catch {}
      });

      this.authWs.on('error', (err) => {
        console.warn(`[DerivBridge] Auth WS warning: ${err.message}`);
      });

      this.authWs.on('close', () => {
        console.log(`[DerivBridge] Auth WS closed. Will refresh OTP in 10s...`);
        setTimeout(() => this.initAuth(), 10000);
      });
    } catch (err: any) {
      this.authError = `Auth WS Error: ${err.message}`;
    }
  }

  // --- HTTP Helpers ---
  private httpApiGet(endpoint: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.derivws.com',
        path: endpoint,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Deriv-App-ID': this.appId || '34QcI4Rf8S5tCkL6PMOcI',
          'User-Agent': WS_HEADERS['User-Agent']
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  private httpApiPost(endpoint: string, bodyObj = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(bodyObj);
      const options = {
        hostname: 'api.derivws.com',
        path: endpoint,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Deriv-App-ID': this.appId || '34QcI4Rf8S5tCkL6PMOcI',
          'User-Agent': WS_HEADERS['User-Agent'],
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  // --- Request Wrappers ---
  public requestPublic(payload: any, timeoutMs = 15000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.publicWs || this.publicWs.readyState !== WebSocket.OPEN) {
        return reject(new Error('Deriv Public WS not connected'));
      }
      const id = ++this.reqId;
      const timer = setTimeout(() => {
        if (this.pendingPublicRequests.has(id)) {
          this.pendingPublicRequests.delete(id);
          reject(new Error('Deriv Public Request Timeout'));
        }
      }, timeoutMs);

      this.pendingPublicRequests.set(id, {
        resolve: (res) => { clearTimeout(timer); resolve(res); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });

      this.publicWs.send(JSON.stringify({ ...payload, req_id: id }));
    });
  }

  public requestAuth(payload: any, timeoutMs = 15000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.authWs || this.authWs.readyState !== WebSocket.OPEN) {
        return reject(new Error('Deriv Auth WS not connected'));
      }
      const id = ++this.authReqId;
      const timer = setTimeout(() => {
        if (this.pendingAuthRequests.has(id)) {
          this.pendingAuthRequests.delete(id);
          reject(new Error('Deriv Auth Request Timeout'));
        }
      }, timeoutMs);

      this.pendingAuthRequests.set(id, {
        resolve: (res) => { clearTimeout(timer); resolve(res); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });

      this.authWs.send(JSON.stringify({ ...payload, req_id: id }));
    });
  }

  private getSymbolAliases(symbol: string): string[] {
    const list = [symbol];
    if (symbol === 'stpRNG') list.push('STEP', 'STPRNG');
    else if (symbol === 'STEP') list.push('stpRNG', 'STPRNG');
    else if (symbol === 'JD100') list.push('JD10', 'JD100V');
    else if (symbol === 'JD10') list.push('JD100', 'JD10V');
    else if (symbol === 'BOOM1000') list.push('BOOM100');
    else if (symbol === 'CRASH1000') list.push('CRASH100');
    else if (symbol.startsWith('1HZ') && symbol.endsWith('V')) list.push(symbol.slice(0, -1));
    return list;
  }

  // --- Gapless Candle Stitching ---
  public async getCandles(symbol: string, tf: number, count: number): Promise<Candle[]> {
    tf = Number(tf) || 60;
    count = Math.max(10, Math.min(1000, Number(count) || 60));

    const symbolsToTry = this.getSymbolAliases(symbol);

    for (const sym of symbolsToTry) {
      try {
        const res = await this.requestPublic({
          ticks_history: sym,
          adjust_start_time: 1,
          count: count,
          end: 'latest',
          granularity: tf,
          style: 'candles'
        });

        let rawCandles: Candle[] = [];
        if (res && Array.isArray(res.candles) && res.candles.length > 0) {
          rawCandles = res.candles.map((c: any) => ({
            time: Number(c.epoch),
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close)
          }));
        }

        if (rawCandles.length > 0) {
          return this.stitchCandleGaps(rawCandles, tf);
        }
      } catch (err) {
        console.warn(`[DerivBridge] getCandles error for ${sym}:`, err);
      }
    }

    return [];
  }

  public stitchCandleGaps(raw: Candle[], tf: number): Candle[] {
    if (raw.length === 0) return [];
    raw.sort((a, b) => a.time - b.time);

    const map = new Map<number, Candle>();
    for (const c of raw) {
      const b = Math.floor(c.time / tf) * tf;
      map.set(b, { ...c, time: b });
    }

    const tMin = Math.floor(raw[0].time / tf) * tf;
    const tMax = Math.floor(raw[raw.length - 1].time / tf) * tf;
    const result: Candle[] = [];

    let prevClose = raw[0].open;
    for (let t = tMin; t <= tMax; t += tf) {
      if (map.has(t)) {
        const cand = map.get(t)!;
        prevClose = cand.close;
        result.push(cand);
      } else {
        result.push({
          time: t,
          open: prevClose,
          high: prevClose,
          low: prevClose,
          close: prevClose
        });
      }
    }
    return result;
  }

  // --- Subscriptions ---
  public subscribeTicks(symbol: string, callback: (price: number, epoch: number) => void) {
    if (!this.tickSubscribers.has(symbol)) {
      this.tickSubscribers.set(symbol, new Set());
      if (this.publicWs && this.publicWs.readyState === WebSocket.OPEN) {
        this.requestPublic({ ticks: symbol, subscribe: 1 }).catch(() => {});
      }
    }
    this.tickSubscribers.get(symbol)!.add(callback);
  }

  public unsubscribeTicks(symbol: string, callback: (price: number, epoch: number) => void) {
    const subs = this.tickSubscribers.get(symbol);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) {
        this.tickSubscribers.delete(symbol);
        const subId = this.tickSubIds.get(symbol);
        if (subId && this.publicWs && this.publicWs.readyState === WebSocket.OPEN) {
          this.requestPublic({ forget: subId }).catch(() => {});
          this.tickSubIds.delete(symbol);
        }
      }
    }
  }

  // --- Account & Trade Operations ---
  public async setAccount(demo: boolean): Promise<{ ok: boolean; msg: string }> {
    this.isDemo = demo;
    await this.initAuth();
    return { ok: true, msg: `Switched to ${demo ? 'Demo' : 'Real'} account (${this.accountId})` };
  }

  public async placeTrade(asset: string, side: 'buy' | 'sell', amount: number, seconds: number): Promise<any> {
    if (!this.authWs || this.authWs.readyState !== WebSocket.OPEN) {
      throw new Error('Deriv account not connected. Please enter your Deriv PAT Token on the API screen.');
    }

    const contractType = side.toLowerCase() === 'buy' ? 'CALL' : 'PUT';

    // Step 1: Proposal (try underlying_symbol first as required by Deriv API, then symbol as fallback)
    let propRes: any = null;
    const baseProposal = {
      proposal: 1,
      amount: Number(amount),
      basis: 'stake',
      currency: this.currency,
      contract_type: contractType,
      duration: Math.max(15, Number(seconds)),
      duration_unit: 's'
    };

    try {
      propRes = await this.requestAuth({
        ...baseProposal,
        underlying_symbol: asset
      });
    } catch {
      propRes = null;
    }

    if (!propRes || propRes.error) {
      if (propRes?.error?.code !== 'InputValidationFailed') {
        // Retry with symbol if underlying_symbol is not recognized
        propRes = await this.requestAuth({
          ...baseProposal,
          symbol: asset
        });
      }
    }

    if (propRes && propRes.error) {
      throw new Error(propRes.error.message || 'Proposal failed');
    }

    const prop = propRes?.proposal;
    if (!prop || !prop.id) {
      throw new Error('Invalid proposal response from Deriv');
    }

    // Step 2: Buy
    const buyRes = await this.requestAuth({
      buy: prop.id,
      price: prop.ask_price
    });

    if (buyRes && buyRes.error) {
      throw new Error(buyRes.error.message || 'Buy order failed');
    }

    const buy = buyRes.buy;
    return {
      status: 'ok',
      id: String(buy.contract_id),
      stake: Number(buy.buy_price),
      payout: Number(buy.payout),
      msg: 'Trade placed successfully'
    };
  }

  public async getTradeResult(contractId: string, timeoutSec = 90): Promise<any> {
    const end = Date.now() + (timeoutSec * 1000);
    while (Date.now() < end) {
      try {
        const res = await this.requestAuth({
          proposal_open_contract: 1,
          contract_id: Number(contractId)
        });
        if (res.proposal_open_contract) {
          const c = res.proposal_open_contract;
          if (c.is_sold || ['won', 'lost'].includes(c.status)) {
            const result = c.status === 'won' ? 'win' : c.status === 'lost' ? 'loss' : 'draw';
            return {
              status: 'ok',
              result,
              profit: Number(c.profit || 0)
            };
          }
        }
      } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }
    return { status: 'error', msg: 'Trade result timeout' };
  }
}

export const derivBridge = new DerivBridge();
