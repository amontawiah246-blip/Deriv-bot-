# Engines 5 and 6: architecture, rules, backtesting

## Modules (all pure TypeScript, no indicators, no network)
| File | Role |
|---|---|
| `src/candleMath.ts` | body, range, wicks, ratios (zero-range safe), median, OHLC validation, contiguity, `Tracer` (records every check with its arithmetic) |
| `src/sweepPatterns.ts` | Pattern 1 (bearish high sweep) and Pattern 2 (bullish low sweep) as written in the spec. Used as "Candle A" by Engine 5 |
| `src/continuationEngine.ts` | **Engine 5**: P, A (sweeper), B, C. State machine NO_SWEEP, AWAITING_B, AWAITING_C, CONFIRMED, INVALIDATED |
| `src/momentumEngine.ts` | **Engine 6**: body-dominance momentum. Imports nothing about sweeps (a test enforces it) |
| `src/sweepEngines.ts` | existing wick-sweep engine untouched; `detectContinuation` / `detectMomentum` are now thin adapters to Engines 5 / 6 |
| `src/sweepWatcherCore.ts` | alerts now carry `trace` (exact arithmetic) and `conflict` (opposite engines on one candle); duplicates were already blocked per symbol, timeframe, engine and candle |
| `src/engineBacktest.ts`, `src/engineBacktestCli.ts`, `src/syntheticData.ts` | backtester, CLI, seeded synthetic candles |

## Engine 5 (sweep continuation)
SELL: P bullish; A bearish with `A.high > P.high` (strict), `A.close` inside P's real body, and A not opening beyond P.high (wick-only sweep, on by default, `requireWickOnlySweep`); B closes bearish; C closes bearish; all closed and consecutive. Signal exists only after C closes, for the next candle. BUY is the mirror. A bullish/doji B or C invalidates the sequence for good. Optional `minConfirmBodyRatio` (default 0 = off).

## Engine 6 (body dominance)
Candle is STRONG when body/range >= 0.65, wick/range <= 0.35, and body >= 1.2 x median body of the 20 candles before the sequence. Sequence qualifies when 3 candles close one way, at least 2 are strong, each other one has body/range >= 0.30 (not a doji or tiny-body candle), and the sum of the three bodies >= 3.0 x that median. Signal after the third candle closes. Body ratio + wick ratio always equals 1, so 0.65 / 0.35 is one test; both are logged. Every number is a field of `MomentumParams`.

My assumptions (your spec gave no number): weak-candle minimum 0.30, combined-body minimum 3.0 x median, baseline measured before the sequence (`baseline: 'beforeEachCandle'` is available), sum of bodies as "combined body" (net move also recorded).

## Backtesting
```
npm run backtest -- --csv EURUSD_5m.csv --csv GBPUSD_5m.csv --tf 300 --expiry 300,600,900 --payout 0.92 --out report.json --trace trace.jsonl
npm run backtest -- --synthetic --instruments 5 --n 30000 --seed 1 --persistence 0
```
Entry = next candle open; settlement = close of the candle ending at entry + expiry; expiry is independent of the chart timeframe (multiple of it). One open trade per strategy/instrument/expiry. Per strategy: signals, win/loss rate, expectancy, max drawdown, by instrument, by UTC session, by expiry, train/validation/test (chronological, boundary trades embargoed), 95% Wilson interval vs break-even. Comparisons: Engine 5 vs entering right after the sweep (0 and 1 confirmation baselines), Engine 5 vs Engine 6, all-3-strong vs 2-strong+1 vs a plain 3-colour-streak control, a 9-cell threshold grid with selection on validation only.

`docs/backtests/` holds two SYNTHETIC runs: no edge (every strategy sits at 50%, negative expectancy, nothing "above breakeven") and a planted edge (the harness finds it). They validate the machinery only.

## Limits
- No real market data was available here: nothing in this repo says whether Engines 5 or 6 have an edge. Run the CLI on exported 5-minute candles.
- No latency, slippage or real payout model. Flat payout/cost.
- The Python bridge has no continuation/momentum engines, so there is nothing to keep in sync; Patterns 3 and 4 (equal-level sweeps) are not in this repo and were not part of this task.
- Two pre-existing failures in `src/signal.test.ts` (AI signal module) are unrelated and unchanged.
