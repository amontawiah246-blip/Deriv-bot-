// Command line for the Engine 5 / 6 backtester.
//
//   Real data (CSV with a header: time,open,high,low,close; time = epoch seconds, epoch milliseconds or an ISO date):
//     npx tsx src/engineBacktestCli.ts --csv EURUSD_5m.csv --csv GBPUSD_5m.csv --tf 300 --expiry 300,600,900 --payout 0.92 --out report.json
//   Synthetic data (plumbing check only, NOT market data):
//     npx tsx src/engineBacktestCli.ts --synthetic --instruments 5 --n 30000 --seed 1 --persistence 0
//
//   Options: --tf 300  --expiry 300,600,900  --payout 0.92  --cost 0  --split 0.6,0.2  --out report.json  --trace trace.jsonl  --trace-limit 5000
import { readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { basename } from 'node:path';
import { Candle } from './candleMath';
import { Dataset, renderReport, runBacktest } from './engineBacktest';
import { synthCandles } from './syntheticData';

function arg(name: string): string[] {
  const out: string[] = [];
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) if (a[i] === `--${name}` && a[i + 1] !== undefined) out.push(a[i + 1]);
  return out;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

export function parseCsv(text: string): Candle[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const [it, io, ih, il, ic] = [col('time', 'epoch', 'timestamp', 'date', 'datetime'), col('open', 'o'), col('high', 'h'), col('low', 'l'), col('close', 'c')];
  if ([it, io, ih, il, ic].some((x) => x < 0)) throw new Error(`CSV needs the columns time,open,high,low,close (found: ${head.join(',')})`);
  return lines.slice(1).map((l) => {
    const p = l.split(',');
    const raw = p[it].trim();
    let t = Number(raw);
    if (!Number.isFinite(t)) t = Date.parse(raw) / 1000; else if (t > 1e11) t = Math.floor(t / 1000);
    return { time: t, open: Number(p[io]), high: Number(p[ih]), low: Number(p[il]), close: Number(p[ic]) };
  });
}

function main() {
  const tf = Number(arg('tf')[0] ?? 300);
  const expiries = (arg('expiry')[0] ?? `${tf},${tf * 2},${tf * 3}`).split(',').map(Number);
  const payout = Number(arg('payout')[0] ?? 0.92), costPerTrade = Number(arg('cost')[0] ?? 0);
  const [tr, va] = (arg('split')[0] ?? '0.6,0.2').split(',').map(Number);
  const data: Dataset[] = [];
  for (const f of arg('csv')) data.push({ symbol: basename(f).replace(/\.[^.]+$/, ''), candles: parseCsv(readFileSync(f, 'utf8')) });
  if (flag('synthetic')) {
    const k = Number(arg('instruments')[0] ?? 5), n = Number(arg('n')[0] ?? 30000), seed = Number(arg('seed')[0] ?? 1), persistence = Number(arg('persistence')[0] ?? 0);
    for (let j = 0; j < k; j++) data.push({ symbol: `SYNTH${j + 1}${persistence ? `_ar${persistence}` : ''}`, candles: synthCandles({ n, seed: seed * 1000 + j, tf, persistence }) });
    console.log('*** SYNTHETIC DATA: this checks the machinery only. It says nothing about any real market. ***\n');
  }
  if (!data.length) { console.error('give --csv file(s) or --synthetic'); process.exit(1); }

  const limit = Number(arg('trace-limit')[0] ?? 5000);
  const tracePath = arg('trace')[0];
  const stream = tracePath ? createWriteStream(tracePath) : null;
  let written = 0;
  const { report } = runBacktest(data, {
    tf, expiries, payout, costPerTrade, split: { train: tr, validation: va },
    traceSink: stream ? (rec) => { if (written++ < limit) stream.write(JSON.stringify({ ...rec, iso: new Date(rec.time * 1000).toISOString() }) + '\n'); } : undefined,
  });
  stream?.end();
  console.log(renderReport(report));
  const out = arg('out')[0];
  if (out) { writeFileSync(out, JSON.stringify(report, null, 2)); console.log(`\nreport written to ${out}`); }
  if (tracePath) console.log(`trace: ${Math.min(written, limit)} of ${written} records written to ${tracePath}`);
}

if (process.argv[1] && /engineBacktestCli\.[tj]s$/.test(process.argv[1])) main();
