NEW: WICK SWEEP ALERTS (Menu tab)
- The 16 agents' markets are watched by the wick sweep engine on CLOSED candles. The moment a setup forms, a chart screenshot
  (same look as your Valid Buy / Valid Sell Setup images) appears in Menu, with a badge on the Menu button and a toast.
- TAKE = sweep + context check passed. SKIP = sweep seen but the context check said no (shown so you can judge the filter too).
- Each of the 16 agent cards in Signal Package also shows its wick sweep verdict (tap it for the screenshot).
- Under each screenshot: "Engine is right" / "Engine is wrong" to keep a tally while you verify.
- bridge/sweep_watch.py (watcher), bridge/sweep_chart.py (screenshot), bridge/engines/wick_sweep_engine.py (your engine, unchanged),
  src/SweepAlerts.tsx (Menu screen), /api/sweep proxy in server.ts. Starts by itself with the bridge; set SWEEP_WATCH=0 to turn that off.
- Test:  cd bridge && python3 -m unittest test_sweep_watch

Upload this project AS IS. Tell Gemini / AI Studio: replace the project files with the ones in this zip exactly; do not redesign, rewrite or improve any file.

NEW IN THIS VERSION
- bridge/engines/  your three engines + combine.py (sweep = boss, 2+ indicator strategies confirm, candle pattern counts only if indicators agree)
- signalServer.ts  AI check (Gemini approves or vetoes each setup) and /api/signal. Needs GEMINI_API_KEY in the server environment.
- autoServer.ts    AI Trading runs on the server (keeps going with the phone locked). Works on Pocket, Quotex, IQ Option, Deriv (Rise/Fall).
- Demo / Real switch on Home and in the AI Trading window.
- The chart is untouched: everything runs in the background.

Tests:  npx tsx --test src/*.test.ts      and      cd bridge && python3 -m unittest test_engines
