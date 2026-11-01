// اختبار تاريخي لاستراتيجيات السكالب (اختراق افتتاح جلسة لندن ونيويورك).
// التشغيل: npm run backtest-scalp [-- XAU/USD 5min 0.35 4]
//   الرقم الأخير = عدد الدفعات، كل دفعة 5000 شمعة أقدم (كل دفعة تستهلك طلباً واحداً من Twelve Data)
require('dotenv').config();
const { fetchCandles } = require('./market');
const { backtest } = require('./backtest');
const { londonBreakout, newYorkBreakout } = require('./scalp');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHistory(symbol, interval, apiKey, pages) {
  let candles = await fetchCandles(symbol, interval, apiKey, 5000, { timezone: 'UTC' });
  for (let p = 1; p < pages; p++) {
    await sleep(8000);
    const older = await fetchCandles(symbol, interval, apiKey, 5000, { timezone: 'UTC', endDate: candles[0].time });
    const fresh = older.filter((c) => c.time < candles[0].time);
    if (fresh.length === 0) break;
    candles = [...fresh, ...candles];
  }
  return candles;
}

const [symbol = 'XAU/USD', interval = '5min', spreadArg = '0.35', pagesArg = '4'] = process.argv.slice(2);
const spread = Number(spreadArg);
const strategies = { 'london-breakout': londonBreakout, 'newyork-breakout': newYorkBreakout };

(async () => {
  const candles = await fetchHistory(symbol, interval, process.env.TWELVE_DATA_API_KEY, Number(pagesArg));
  console.log(`${symbol} ${interval} (UTC): ${candles.length} شمعة من ${candles[0].time} إلى ${candles.at(-1).time}`);
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
