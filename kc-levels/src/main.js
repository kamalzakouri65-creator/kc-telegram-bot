// npm run bounce   (أ) الارتداد من الدعم والمقاومة على الذهب والفضة، 1h و 4h، سنتان من Yahoo
// النجاح (مسجل قبل التشغيل): الإعداد يجتاز الشروط المعتادة (30 صفقة، PF ≥ 1.2، الفترة الأخيرة رابحة)،
// والاستراتيجية تُقبل فقط إذا نجحت على الذهب والفضة معاً على نفس الإطار.
const { evaluate, formatRow } = require('../../gold-forex-signals-bot/src/scan-pairs');
const { fetchYahooHistory, groupCandles, formatTime } = require('../../gold-forex-signals-bot/src/yahoo');
const { analyzeBounce } = require('./bounce');

// سبريد حساب XM Micro الحقيقي
const MARKETS = [
  { symbol: 'GOLD', ticker: 'GC=F', spread: 0.57 },
  { symbol: 'SILVER', ticker: 'SI=F', spread: 0.07 },
];
const STRATEGIES = { bounce: { name: 'ارتداد دعم/مقاومة', fn: analyzeBounce } };

(async () => {
  const key = process.argv[2];
  const s = STRATEGIES[key];
  if (!s) return console.log(`الأوامر: ${Object.keys(STRATEGIES).join(' | ')}`);
  console.log(`${s.name} — الذهب والفضة، سبريد XM الحقيقي`);
  console.log('الشروط: 30 صفقة، PF ≥ 1.2، الفترة الأخيرة رابحة، والنجاح على الذهب والفضة معاً على نفس الإطار.\n');
  const pass = {};
  for (const m of MARKETS) {
    const hourly = await fetchYahooHistory(m.ticker, '60m', 729);
    console.log(`━━ ${m.symbol} — ${formatTime(hourly[0].seconds).slice(0, 10)} → ${formatTime(hourly.at(-1).seconds).slice(0, 10)}، السبريد ${m.spread}`);
    for (const [tf, g] of [['1h', 1], ['4h', 4]]) {
      const candles = groupCandles(hourly, g).map(({ seconds, open, high, low, close }) => ({ time: formatTime(seconds), open, high, low, close }));
      const r = evaluate(candles, s.fn, m.spread);
      console.log(formatRow(m.symbol, tf, s.name, r));
      (pass[tf] ??= []).push(r.pass);
    }
    console.log('');
  }
  const ok = Object.entries(pass).filter(([, v]) => v.length === 2 && v.every(Boolean)).map(([tf]) => tf);
  console.log(ok.length ? `✅ نجحت على الذهب والفضة معاً: ${ok.join(' و ')}` : '❌ لم تنجح على الذهب والفضة معاً على أي إطار: لا نعتمدها');
  console.log('R = المبلغ الذي تخاطر به في الصفقة. النتائج بعد خصم السبريد.');
})().catch((e) => {
  console.error('فشل:', e.message);
  process.exit(1);
});
