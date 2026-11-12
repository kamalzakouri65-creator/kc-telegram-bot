// اختبار السكالبينغ على الذهب: npm run scalp
// يستعمل بيانات الذهب 5 و 15 دقيقة الموجودة من قبل (npm run fetch-data)، بتوقيت نيويورك.
// استراتيجيتا البوت (EMA + MACD و Pullback) بدون تعديل، فقط في ساعات السيولة العالية:
//   جلسة لندن 03:00–06:00 وجلسة نيويورك 08:30–11:30 بتوقيت نيويورك (أعلى حركة وأقل سبريد).
// السبريد: سبريد حسابك الحقيقي في XM على GOLDmicro (0.57$). القواعد والشروط مسجلة قبل التشغيل (2026-11-12):
//   كل إعداد: 100 صفقة على الأقل، PF ≥ 1.2، والفترة الأولى (70%) والأخيرة (30%) رابحتان.
//   4 إعدادات = قد ينجح واحد بالصدفة، لذلك يُقبل السكالبينغ فقط إذا نجح إعدادان على الأقل.
const { backtest } = require('../../gold-forex-signals-bot/src/backtest');
const { analyze } = require('../../gold-forex-signals-bot/src/strategy');
const { analyzePullback } = require('../../gold-forex-signals-bot/src/pullback');
const data = require('./data');

const SPREAD = 0.57;
const SESSIONS = [
  ['03:00', '06:00'],
  ['08:30', '11:30'],
];
const CRITERIA = { minTrades: 100, minProfitFactor: 1.2, minPasses: 2 };
const STRATEGIES = { 'EMA + MACD': analyze, Pullback: analyzePullback };

const clock = (c) => c.time.slice(11, 16);
const inSession = (c) => SESSIONS.some(([a, b]) => clock(c) >= a && clock(c) < b);
// الإشارة تُقبل فقط إذا كانت الشمعة الأخيرة داخل الجلسة
const sessionOnly = (fn) => (cs) => (inSession(cs.at(-1)) ? fn(cs) : null);

function evaluate(candles, fn, spread = SPREAD) {
  const res = backtest(candles, sessionOnly(fn), { spread });
  const cut = candles[Math.floor(candles.length * 0.7)].time;
  const sum = (ts) => ts.reduce((s, t) => s + t.r, 0);
  const first = sum(res.trades.filter((t) => t.time < cut));
  const last = sum(res.trades.filter((t) => t.time >= cut));
  const reasons = [];
  if (res.count < CRITERIA.minTrades) reasons.push(`صفقات أقل من ${CRITERIA.minTrades}`);
  if (!(res.profitFactor >= CRITERIA.minProfitFactor)) reasons.push(`PF أقل من ${CRITERIA.minProfitFactor}`);
  if (!(first > 0)) reasons.push('الفترة الأولى خاسرة');
  if (!(last > 0)) reasons.push('الفترة الأخيرة خاسرة');
  return { ...res, first, last, pass: reasons.length === 0, reasons };
}

// السبريد الذي يجعل المجموع صفراً: المجموع(s) = G − s × Σ(1/المخاطرة)
function breakEvenSpread(candles, fn) {
  const g0 = backtest(candles, sessionOnly(fn), { spread: 0 }).totalR;
  const g1 = backtest(candles, sessionOnly(fn), { spread: 1 }).totalR;
  const perUnit = g0 - g1;
  return perUnit > 0 ? g0 / perUnit : 0;
}

module.exports = { evaluate, inSession, sessionOnly, breakEvenSpread, SPREAD, CRITERIA };

if (require.main === module) {
  const fmt = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
  const pf = (r) => (Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞');
  console.log(`سكالبينغ الذهب — جلسة لندن ونيويورك فقط — سبريد XM ${SPREAD}$`);
  console.log(`الشروط: ${CRITERIA.minTrades} صفقة، PF ≥ ${CRITERIA.minProfitFactor}، الفترتان رابحتان، ويجب أن ينجح ${CRITERIA.minPasses} إعدادات على الأقل من 4.\n`);
  let passes = 0;
  for (const tf of ['5min', '15min']) {
    const candles = data.load(`XAU-${tf}`);
    if (!candles) {
      console.log(`لا توجد بيانات ${tf}. شغّل أولاً: npm run fetch-data`);
      continue;
    }
    console.log(`━━ ${tf} — ${candles[0].time.slice(0, 10)} → ${candles.at(-1).time.slice(0, 10)}`);
    for (const [name, fn] of Object.entries(STRATEGIES)) {
      const r = evaluate(candles, fn);
      if (r.pass) passes++;
      console.log(`${r.pass ? '✅' : '❌'} ${tf} ${name}: ${r.count} صفقة | ربح ${(r.winRate * 100).toFixed(0)}% | PF ${pf(r)} | ${fmt(r.totalR)}R`);
      console.log(`   الفترة الأولى ${fmt(r.first)}R | الأخيرة ${fmt(r.last)}R | تراجع ${r.maxDrawdownR.toFixed(1)}R | سبريد التعادل ${breakEvenSpread(candles, fn).toFixed(2)}$`);
      if (!r.pass) console.log(`   السبب: ${r.reasons.join('، ')}`);
    }
    console.log('');
  }
  console.log(passes >= CRITERIA.minPasses ? `✅ نجح ${passes} من 4: السكالبينغ يستحق المتابعة` : `❌ نجح ${passes} فقط من 4: لا نعتمد السكالبينغ`);
  console.log('سبريد التعادل = أكبر سبريد تبقى عنده النتيجة رابحة. سبريدك في XM 0.57$.');
}
