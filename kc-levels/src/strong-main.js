// npm run strong   المستويات القوية على الذهب والفضة، 1h و 4h، سنتان من Yahoo، سبريد XM الحقيقي
// النجاح (مسجل قبل التشغيل): لكل معدن على نفس الإطار: 20 صفقة على الأقل، PF ≥ 1.2، والفترة الأخيرة (30%) رابحة،
// ويجب أن ينجح الذهب والفضة معاً على نفس الإطار.
const { fetchYahooHistory, groupCandles, formatTime } = require('../../gold-forex-signals-bot/src/yahoo');
const { strongLevels } = require('./strong');

const MARKETS = [
  { symbol: 'GOLD', ticker: 'GC=F', spread: 0.57 },
  { symbol: 'SILVER', ticker: 'SI=F', spread: 0.07 },
];
const C = { minTrades: 20, minProfitFactor: 1.2 };

function judge(trades, candles) {
  const cut = candles[Math.floor(candles.length * 0.7)].time;
  const sum = (ts) => ts.reduce((s, t) => s + t.r, 0);
  const gw = sum(trades.filter((t) => t.r > 0));
  const gl = -sum(trades.filter((t) => t.r < 0));
  const r = { n: trades.length, win: trades.length ? (trades.filter((t) => t.r > 0).length / trades.length) * 100 : 0, total: sum(trades), pf: gl ? gw / gl : trades.length ? Infinity : 0, last: sum(trades.filter((t) => t.time >= cut)) };
  const reasons = [];
  if (r.n < C.minTrades) reasons.push(`صفقات أقل من ${C.minTrades}`);
  if (!(r.pf >= C.minProfitFactor)) reasons.push(`PF أقل من ${C.minProfitFactor}`);
  if (!(r.last > 0)) reasons.push('الفترة الأخيرة خاسرة');
  return { ...r, pass: !reasons.length, reasons };
}

module.exports = { judge };

if (require.main === module) {
  const fmt = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
  (async () => {
    console.log('المستويات القوية (لمستان على الأقل) — شراء عند الدعم وبيع عند المقاومة — الوقف 1 ATR والهدف 2 ATR');
    console.log(`الشروط: ${C.minTrades} صفقة، PF ≥ ${C.minProfitFactor}، الفترة الأخيرة رابحة، والنجاح على الذهب والفضة معاً.\n`);
    const pass = {};
    for (const m of MARKETS) {
      const hourly = await fetchYahooHistory(m.ticker, '60m', 729);
      console.log(`━━ ${m.symbol} — ${formatTime(hourly[0].seconds).slice(0, 10)} → ${formatTime(hourly.at(-1).seconds).slice(0, 10)}`);
      for (const [tf, g] of [['1h', 1], ['4h', 4]]) {
        const cs = groupCandles(hourly, g).map(({ seconds, open, high, low, close }) => ({ time: formatTime(seconds), open, high, low, close }));
        const trades = strongLevels(cs, m.spread);
        const r = judge(trades, cs);
        const side = (s) => judge(trades.filter((t) => t.side === s), cs);
        (pass[tf] ??= []).push(r.pass);
        console.log(`${r.pass ? '✅' : '❌'} ${m.symbol} ${tf}: ${r.n} صفقة | ربح ${r.win.toFixed(0)}% | PF ${Number.isFinite(r.pf) ? r.pf.toFixed(2) : '∞'} | ${fmt(r.total)}R | الأخيرة ${fmt(r.last)}R`);
        console.log(`   شراء ${side('BUY').n} (${fmt(side('BUY').total)}R) | بيع ${side('SELL').n} (${fmt(side('SELL').total)}R)${r.pass ? '' : ` | السبب: ${r.reasons.join('، ')}`}`);
      }
      console.log('');
    }
    const ok = Object.entries(pass).filter(([, v]) => v.length === 2 && v.every(Boolean)).map(([tf]) => tf);
    console.log(ok.length ? `✅ نجحت على الذهب والفضة معاً: ${ok.join(' و ')}` : '❌ لم تنجح على الذهب والفضة معاً: لا نعتمدها');
    console.log('نسبة الربح اللازمة للتعادل قبل السبريد: ~33% (الهدف ضعف الوقف).');
  })().catch((e) => {
    console.error('فشل:', e.message);
    process.exit(1);
  });
}
