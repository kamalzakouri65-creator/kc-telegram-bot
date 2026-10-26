// اختبار استراتيجية على شموع تاريخية. النتائج بوحدة R (المخاطرة):
// كل صفقة تُقسم نصفين، نصف عند الهدف 1 ونصف عند الهدف 2، وكلاهما بنفس الوقف.
// إذا لمست الشمعة الوقف والهدف معاً نعتبر الوقف هو الذي ضُرب (تقدير متحفظ).
// spread (بوحدة السعر، مثلاً 0.35 للذهب) يُخصم من كل صفقة بنسبته إلى المخاطرة،
// وهو مهم جداً في الإطارات الصغيرة حيث الوقف قريب. العمولة غير محسوبة.

const WINDOW = 500;

function backtest(candles, analyzeFn, { spread = 0 } = {}) {
  const trades = [];
  let open = null;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (open) {
      const dir = open.side === 'BUY' ? 1 : -1;
      const risk = dir * (open.entry - open.stopLoss);
      const stopHit = dir === 1 ? c.low <= open.stopLoss : c.high >= open.stopLoss;
      for (const half of open.halves) {
        if (half.result !== null) continue;
        const targetHit = dir === 1 ? c.high >= half.target : c.low <= half.target;
        if (stopHit) half.result = -1;
        else if (targetHit) half.result = (dir * (half.target - open.entry)) / risk;
      }
      if (open.halves.every((h) => h.result !== null)) {
        const r = open.halves.reduce((sum, h) => sum + h.result, 0) / open.halves.length - spread / risk;
        trades.push({ side: open.side, time: open.time, closedAt: c.time, r });
        open = null;
      }
      continue;
    }

    const signal = analyzeFn(candles.slice(Math.max(0, i + 1 - WINDOW), i + 1));
    if (signal) {
      open = {
        ...signal,
        halves: [
          { target: signal.takeProfit1, result: null },
          { target: signal.takeProfit2, result: null },
        ],
      };
    }
  }
  return summarize(trades);
}

function summarize(trades) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let streak = 0;
  let worstStreak = 0;
  for (const t of trades) {
    equity += t.r;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    streak = t.r < 0 ? streak + 1 : 0;
    worstStreak = Math.max(worstStreak, streak);
  }
  const wins = trades.filter((t) => t.r > 0);
  const losses = trades.filter((t) => t.r < 0);
  const grossWin = wins.reduce((s, t) => s + t.r, 0);
  const grossLoss = -losses.reduce((s, t) => s + t.r, 0);
  return {
    trades,
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    totalR: equity,
    profitFactor: grossLoss ? grossWin / grossLoss : Infinity,
    maxDrawdownR: maxDrawdown,
    worstLosingStreak: worstStreak,
  };
}

module.exports = { backtest };

// التشغيل من سطر الأوامر: npm run backtest [-- XAU/USD 1h 0.35]
if (require.main === module) {
  require('dotenv').config();
  const { fetchCandles } = require('./market');
  const { analyze } = require('./strategy');
  const { analyzeOrderBlock } = require('./orderblock');

  const [symbol = 'XAU/USD', interval = process.env.INTERVAL || '1h', spreadArg = '0'] = process.argv.slice(2);
  const spread = Number(spreadArg);
  const strategies = { 'ema-macd': analyze, 'order-block': analyzeOrderBlock };

  (async () => {
    const candles = await fetchCandles(symbol, interval, process.env.TWELVE_DATA_API_KEY, 5000);
    console.log(`${symbol} ${interval}: ${candles.length} شمعة من ${candles[0].time} إلى ${candles.at(-1).time}`);
    console.log(`السبريد المحسوب: ${spread}\n`);
    for (const [name, fn] of Object.entries(strategies)) {
      const s = backtest(candles, fn, { spread });
      console.log(`== ${name} ==`);
      console.log(`الصفقات: ${s.count} | ربح: ${s.wins} | خسارة: ${s.losses} | نسبة الربح: ${(s.winRate * 100).toFixed(1)}%`);
      console.log(`المجموع: ${s.totalR.toFixed(1)}R | معامل الربح: ${s.profitFactor.toFixed(2)}`);
      console.log(`أكبر تراجع: ${s.maxDrawdownR.toFixed(1)}R | أطول سلسلة خسائر: ${s.worstLosingStreak}\n`);
    }
    console.log('R = المبلغ الذي تخاطر به في الصفقة. مثلاً لو تخاطر بـ 10$ فإن 5R = 50$.');
  })().catch((err) => {
    console.error('فشل الاختبار:', err.message);
    process.exit(1);
  });
}
