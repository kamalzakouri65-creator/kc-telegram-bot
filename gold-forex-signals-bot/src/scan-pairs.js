// فحص أزواج جديدة بنفس الاستراتيجيتين قبل إضافتها للبوت: npm run scan-pairs [-- EUR/USD GBP/JPY]
// البيانات: آخر سنتين من شموع الساعة من Yahoo (مجاناً، ولا تستهلك حصة Twelve Data)، و4 ساعات مبنية منها.
// شروط النجاح محددة هنا قبل رؤية النتائج، ولا تُعدّل بعدها، والاستراتيجيتان بدون أي تعديل لكل زوج.
const { backtest } = require('./backtest');
const { analyze } = require('./strategy');
const { analyzePullback } = require('./pullback');
const { fetchYahooHistory, groupCandles, formatTime } = require('./yahoo');

// السبريد تقديري لحساب XM (بوحدة السعر)، ويُخصم من كل صفقة بنسبته إلى المخاطرة
const CANDIDATES = [
  { symbol: 'XAU/USD', ticker: 'GC=F', spread: 0.35, note: 'مرجع: في البوت الآن' },
  { symbol: 'XAG/USD', ticker: 'SI=F', spread: 0.035, note: 'مرجع: في البوت الآن' },
  { symbol: 'EUR/USD', ticker: 'EURUSD=X', spread: 0.00017, group: 'USD' },
  { symbol: 'GBP/USD', ticker: 'GBPUSD=X', spread: 0.00022, group: 'USD' },
  { symbol: 'AUD/USD', ticker: 'AUDUSD=X', spread: 0.00018, group: 'USD' },
  { symbol: 'USD/JPY', ticker: 'USDJPY=X', spread: 0.02, group: 'JPY' },
  { symbol: 'EUR/JPY', ticker: 'EURJPY=X', spread: 0.03, group: 'JPY' },
  { symbol: 'GBP/JPY', ticker: 'GBPJPY=X', spread: 0.04, group: 'JPY' },
  { symbol: 'XPT/USD', ticker: 'PL=F', spread: 3, note: 'البلاتين' },
  { symbol: 'WTI', ticker: 'CL=F', spread: 0.05, note: 'النفط' },
];

const STRATEGIES = { 'EMA + MACD': analyze, Pullback: analyzePullback };
const TIMEFRAMES = { '1h': 1, '4h': 4 };

// شروط النجاح (مسجلة قبل الاختبار، 2026-11-05)
const CRITERIA = { minTrades: 30, minProfitFactor: 1.2, oosShare: 0.3 };

// آخر 30% من الشموع لم تُستعمل في أي قرار: النتيجة فيها يجب أن تكون موجبة
function evaluate(candles, analyzeFn, spread, criteria = CRITERIA) {
  const all = backtest(candles, analyzeFn, { spread });
  const cutoff = candles[Math.floor(candles.length * (1 - criteria.oosShare))].time;
  const oos = all.trades.filter((t) => t.time >= cutoff);
  const oosR = oos.reduce((s, t) => s + t.r, 0);
  const reasons = [];
  if (all.count < criteria.minTrades) reasons.push(`صفقات أقل من ${criteria.minTrades}`);
  if (!(all.profitFactor >= criteria.minProfitFactor)) reasons.push(`معامل الربح أقل من ${criteria.minProfitFactor}`);
  if (!(oosR > 0)) reasons.push('الفترة الأخيرة غير رابحة');
  return { ...all, oosCount: oos.length, oosR, pass: reasons.length === 0, reasons };
}

const fmt = (x, d = 1) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;

function formatRow(symbol, tf, name, r) {
  const pf = r.count === 0 ? '—' : Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞';
  return [
    `${r.pass ? '✅' : '❌'} ${symbol} ${tf} ${name}`,
    `   ${r.count} صفقة | ربح ${(r.winRate * 100).toFixed(0)}% | PF ${pf} | ${fmt(r.totalR)}R`,
    `   تراجع ${r.maxDrawdownR.toFixed(1)}R | الفترة الأخيرة: ${r.oosCount} صفقة ${fmt(r.oosR)}R`,
    ...(r.pass ? [] : [`   السبب: ${r.reasons.join('، ')}`]),
  ].join('\n');
}

module.exports = { evaluate, formatRow, CANDIDATES, CRITERIA };

if (require.main === module) {
  const wanted = process.argv.slice(2);
  const list = wanted.length ? CANDIDATES.filter((c) => wanted.includes(c.symbol)) : CANDIDATES;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  (async () => {
    console.log(`الشروط: ${CRITERIA.minTrades} صفقة على الأقل، PF ≥ ${CRITERIA.minProfitFactor} بعد السبريد، وآخر ${CRITERIA.oosShare * 100}% من الفترة رابحة.\n`);
    const passed = [];
    for (const c of list) {
      let hourly;
      try {
        hourly = await fetchYahooHistory(c.ticker, '60m', 729);
      } catch (err) {
        console.log(`⚠️ ${c.symbol}: فشل جلب البيانات (${err.message})\n`);
        continue;
      }
      const from = formatTime(hourly[0].seconds).slice(0, 10);
      const to = formatTime(hourly.at(-1).seconds).slice(0, 10);
      console.log(`━━ ${c.symbol}${c.note ? ` (${c.note})` : ''} — من ${from} إلى ${to}، السبريد ${c.spread}`);
      for (const [tf, group] of Object.entries(TIMEFRAMES)) {
        const candles = groupCandles(hourly, group).map(({ seconds, open, high, low, close }) => ({ time: formatTime(seconds), open, high, low, close }));
        for (const [name, fn] of Object.entries(STRATEGIES)) {
          const r = evaluate(candles, fn, c.spread);
          console.log(formatRow(c.symbol, tf, name, r));
          if (r.pass) passed.push(`${c.symbol} ${tf} ${name}`);
        }
      }
      console.log('');
      await sleep(1500);
    }
    console.log('━━ الخلاصة');
    console.log(passed.length ? passed.map((p) => `✅ ${p}`).join('\n') : 'لا يوجد زوج اجتاز الشروط.');
    console.log('\nR = المبلغ الذي تخاطر به في الصفقة. النتائج بعد خصم السبريد التقديري.');
  })().catch((err) => {
    console.error('فشل الفحص:', err.message);
    process.exit(1);
  });
}
