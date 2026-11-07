import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { registerAutoRoutes } from './autoServer';
import { registerSignalRoutes } from './signalServer';
import { registerScanRoutes } from './scanServer';
import { derivBridge, Candle } from './src/derivBridge';
import { evaluateEngines } from './src/engineEvaluator';
import { sweepWatcher } from './src/sweepWatcher';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const BRIDGE_PORT = 8765;

// Built-in High-Performance Internal Bridge for Deriv Real Account & Gapless Market Feeds
function startInternalBridge() {
  const bridgeApp = express();
  bridgeApp.use(express.json());

  const bridgeServer = http.createServer(bridgeApp);
  const bridgeWss = new WebSocketServer({ noServer: true });

  bridgeApp.get('/api/status', (_req, res) => {
    res.json({
      broker: 'deriv',
      ready: derivBridge.ready,
      error: derivBridge.error || derivBridge.authError,
      balance: derivBridge.balance,
      demo: derivBridge.isDemo,
      currency: derivBridge.currency,
      assets: derivBridge.assets.length,
      configured: true,
    });
  });

  bridgeApp.get('/api/assets', (_req, res) => {
    res.json(derivBridge.assets);
  });

  bridgeApp.get('/api/deriv/synthetic-candles', async (req, res) => {
    const symbol = String(req.query.symbol || '1HZ100V');
    const tf = Number(req.query.tf || 60);
    const count = Number(req.query.count || 60);

    try {
      const candles = await derivBridge.getCandles(symbol, tf, count);
      res.json({ symbol, tf, candles });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  bridgeApp.post('/api/set-credentials', (req, res) => {
    const raw = String(req.body?.ssid || req.body?.email || req.body?.password || '').trim();
    if (!raw) {
      return res.status(400).json({ status: 'error', msg: 'Please provide a valid Deriv API token (pat_...)' });
    }
    derivBridge.setCredentials(raw);
    res.json({ status: 'ok', msg: 'Deriv API Credentials saved. Connecting & authenticating...' });
  });

  bridgeApp.post('/api/set-ssid', (req, res) => {
    const raw = String(req.body?.ssid || '').trim();
    if (!raw) {
      return res.status(400).json({ status: 'error', msg: 'Empty token' });
    }
    derivBridge.setCredentials(raw);
    res.json({ status: 'ok', msg: 'Deriv token updated' });
  });

  bridgeApp.post('/api/account', async (req, res) => {
    const demo = Boolean(req.body?.demo);
    const result = await derivBridge.setAccount(demo);
    res.json({ status: 'ok', demo: derivBridge.isDemo, balance: derivBridge.balance, msg: result.msg });
  });

  bridgeApp.post('/api/trade', async (req, res) => {
    const { asset, side, amount, seconds } = req.body;
    try {
      const result = await derivBridge.placeTrade(asset, side, Number(amount), Number(seconds));
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ status: 'error', msg: err.message || 'Failed to place trade' });
    }
  });

  bridgeApp.get('/api/trade-result', async (req, res) => {
    const id = String(req.query.id || '');
    const seconds = Number(req.query.seconds || 60);
    try {
      const result = await derivBridge.getTradeResult(id, seconds);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ status: 'error', msg: err.message || 'Failed to query trade result' });
    }
  });

  bridgeApp.post('/api/engines', (req, res) => {
    const candles = Array.isArray(req.body?.candles) ? req.body.candles : [];
    const tf = Number(req.body?.tf || 60);
    const minInd = Number(req.body?.minInd || 1);
    const result = evaluateEngines(candles, tf, minInd);
    res.json(result);
  });

  // --- Wick Sweep Watcher Routes ---
  bridgeApp.get('/api/sweep/alerts', (req, res) => {
    const since = Number(req.query.since || 0);
    const limit = Number(req.query.limit || 60);
    res.json({
      alerts: sweepWatcher.getAlerts(since, limit),
      state: sweepWatcher.getState()
    });
  });

  bridgeApp.get('/api/sweep/state', (_req, res) => {
    res.json(sweepWatcher.getState());
  });

  bridgeApp.post('/api/sweep/start', (req, res) => {
    const tf = Number(req.body?.tf || 60);
    const backfill = Number(req.body?.backfill || 0);
    sweepWatcher.start(tf, backfill);
    res.json({ status: 'ok', ...sweepWatcher.getState() });
  });

  bridgeApp.post('/api/sweep/stop', (_req, res) => {
    sweepWatcher.stop();
    res.json({ status: 'ok', ...sweepWatcher.getState() });
  });

  bridgeApp.post('/api/sweep/clear', (_req, res) => {
    sweepWatcher.clear();
    res.json({ status: 'ok', ...sweepWatcher.getState() });
  });

  bridgeApp.get('/api/sweep/image/:id', (req, res) => {
    const alertId = Number(req.params.id);
    const svg = sweepWatcher.getAlertSvg(alertId);
    if (!svg) {
      return res.status(404).send('Alert SVG not found');
    }
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  });

  bridgeApp.get('/api/diag', (_req, res) => {
    res.json({
      status: 'ok',
      broker: 'deriv',
      ready: derivBridge.ready,
      balance: derivBridge.balance,
      isDemo: derivBridge.isDemo,
      currency: derivBridge.currency,
      authError: derivBridge.authError
    });
  });

  // WebSocket Server for Bridge
  bridgeServer.on('upgrade', (request, socket, head) => {
    bridgeWss.handleUpgrade(request, socket, head, (ws) => {
      bridgeWss.emit('connection', ws, request);
    });
  });

  bridgeWss.on('connection', async (ws: WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const asset = url.searchParams.get('asset') || '1HZ100V';
    const tf = Number(url.searchParams.get('tf') || 60);

    let activeHistory: Candle[] = [];
    try {
      activeHistory = await derivBridge.getCandles(asset, tf, 150);
    } catch {
      activeHistory = [];
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'history', resync: false, candles: activeHistory }));
    }

    let lastCandle = activeHistory.length > 0 ? activeHistory[activeHistory.length - 1] : null;

    const onTick = (price: number, epoch: number) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      const currentBucket = Math.floor(epoch / tf) * tf;

      if (!lastCandle) {
        lastCandle = { time: currentBucket, open: price, high: price, low: price, close: price };
        activeHistory.push(lastCandle);
      } else if (lastCandle.time === currentBucket) {
        // Update forming candle
        lastCandle.high = Math.max(lastCandle.high, price);
        lastCandle.low = Math.min(lastCandle.low, price);
        lastCandle.close = price;
      } else if (currentBucket > lastCandle.time) {
        // Stitch intermediate missing buckets if epoch jumped
        let stepTime = lastCandle.time + tf;
        while (stepTime < currentBucket) {
          const stitched = {
            time: stepTime,
            open: lastCandle.close,
            high: lastCandle.close,
            low: lastCandle.close,
            close: lastCandle.close
          };
          activeHistory.push(stitched);
          stepTime += tf;
        }

        // New forming candle
        const openPrice = lastCandle.close;
        lastCandle = {
          time: currentBucket,
          open: openPrice,
          high: Math.max(openPrice, price),
          low: Math.min(openPrice, price),
          close: price
        };
        activeHistory.push(lastCandle);
      }

      // Maintain max 300 candles in memory buffer
      if (activeHistory.length > 300) {
        activeHistory.shift();
      }

      ws.send(JSON.stringify({
        type: 'tick',
        price,
        ts: epoch,
        candle: lastCandle
      }));
    };

    derivBridge.subscribeTicks(asset, onTick);

    ws.on('close', () => {
      derivBridge.unsubscribeTicks(asset, onTick);
    });

    ws.on('error', () => {
      derivBridge.unsubscribeTicks(asset, onTick);
    });
  });

  bridgeServer.listen(BRIDGE_PORT, '127.0.0.1', () => {
    console.log(`[Internal Bridge] Deriv Live Service active on http://127.0.0.1:${BRIDGE_PORT}`);
  });
}

async function main() {
  startInternalBridge();

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  registerAutoRoutes(app, BRIDGE_PORT);
  registerSignalRoutes(app, BRIDGE_PORT);
  registerScanRoutes(app, BRIDGE_PORT);

  // Sweep API route proxy
  app.use('/api/sweep', async (req, res) => {
    try {
      const init: RequestInit = { method: req.method, signal: AbortSignal.timeout(20000) };
      if (req.method === 'POST') {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(req.body ?? {});
      }
      const r = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/sweep${req.url}`, init);
      res.status(r.status).type(r.headers.get('content-type') || 'application/json');
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (e: any) {
      res.status(502).json({ status: 'error', msg: `Bridge not reachable: ${e.message}` });
    }
  });

  // Direct Proxy Endpoints to internal bridge
  app.get('/api/status', async (_req, res) => {
    try {
      const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/status`);
      if (response.ok) return res.json(await response.json());
    } catch {}
    res.json({
      broker: 'deriv',
      ready: derivBridge.ready,
      error: derivBridge.error || derivBridge.authError,
      balance: derivBridge.balance,
      demo: derivBridge.isDemo,
      currency: derivBridge.currency,
      assets: derivBridge.assets.length,
      configured: true,
    });
  });

  app.get('/api/assets', async (_req, res) => {
    try {
      const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/assets`);
      if (response.ok) return res.json(await response.json());
    } catch {}
    res.json(derivBridge.assets);
  });

  app.post('/api/set-ssid', async (req, res) => {
    try {
      const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/set-ssid`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body),
      });
      res.json(await response.json());
    } catch (e: any) {
      res.status(500).json({ status: 'error', msg: e.message });
    }
  });

  app.post('/api/set-credentials', async (req, res) => {
    try {
      const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/set-credentials`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body),
      });
      res.json(await response.json());
    } catch (e: any) {
      res.status(500).json({ status: 'error', msg: e.message });
    }
  });

  app.post('/api/account', async (req, res) => {
    try {
      const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/account`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body),
      });
      res.json(await response.json());
    } catch (e: any) {
      res.status(500).json({ status: 'error', msg: e.message });
    }
  });

  app.post('/api/trade', async (req, res) => {
    try {
      const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/trade`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body),
      });
      res.json(await response.json());
    } catch (e: any) {
      res.status(500).json({ status: 'error', msg: e.message });
    }
  });

  app.get('/api/trade-result', async (req, res) => {
    try {
      const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
      const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/trade-result${query}`);
      res.json(await response.json());
    } catch (e: any) {
      res.status(500).json({ status: 'error', msg: e.message });
    }
  });

  app.get('/api/deriv/synthetic-candles', async (req, res) => {
    try {
      const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
      const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/deriv/synthetic-candles${query}`);
      res.json(await response.json());
    } catch (e: any) {
      res.status(500).json({ status: 'error', msg: e.message });
    }
  });

  app.get('/api/diag', async (_req, res) => {
    res.json({
      status: 'ok',
      broker: 'deriv',
      ready: derivBridge.ready,
      balance: derivBridge.balance,
      isDemo: derivBridge.isDemo,
      currency: derivBridge.currency,
      authError: derivBridge.authError
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    if (url.pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (clientWs) => {
        wss.emit('connection', clientWs, request);
      });
    }
  });

  wss.on('connection', (clientWs: WebSocket, request: http.IncomingMessage) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const upstreamUrl = `ws://127.0.0.1:${BRIDGE_PORT}/ws${url.search}`;

    let upstreamWs: WebSocket | null = null;
    let isClientClosed = false;

    try {
      upstreamWs = new WebSocket(upstreamUrl);

      upstreamWs.on('message', (data, isBinary) => {
        if (!isClientClosed && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data, { binary: isBinary });
        }
      });

      upstreamWs.on('error', () => {});
      upstreamWs.on('close', () => {
        if (!isClientClosed && clientWs.readyState === WebSocket.OPEN) clientWs.close();
      });

      clientWs.on('message', (data, isBinary) => {
        if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
          upstreamWs.send(data, { binary: isBinary });
        }
      });

      clientWs.on('close', () => {
        isClientClosed = true;
        if (upstreamWs) upstreamWs.close();
      });

      clientWs.on('error', () => {
        isClientClosed = true;
        if (upstreamWs) upstreamWs.close();
      });
    } catch {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'error', msg: 'Unable to connect to bridge' }));
      }
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Running at http://0.0.0.0:${PORT}`);
  });
}

main().catch((err) => {
  console.error('[Server Fatal]', err);
  process.exit(1);
});
