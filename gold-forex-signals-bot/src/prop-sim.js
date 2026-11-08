// هل كان نظامنا سينجح في اختبار شركة تمويل (Prop Firm)؟ npm run prop-sim
// تحليل فقط: لا يغيّر شيئاً في البوت. نفس الإعدادات السبعة المفعّلة في البوت (بدون الفضة 1h Pullback)،
// على سنتين من بيانات Yahoo، بعد خصم السبريد.
//
// قواعد الاختبار المعتادة (مرحلتان):
//   المرحلة 1: ربح 8%، المرحلة 2: ربح 5%. ممنوع خسارة 5% في يوم واحد أو 10% من الرصيد الابتدائي.
// نبدأ الاختبار في كل أسبوع من الفترة، ونحسب كم مرة كان سينجح وكم يوماً كان سيحتاج.
// تقريب: الخسارة اليومية تُحسب من الصفقات المغلقة في ذلك اليوم (الشركات تحسب أيضاً الصفقات المفتوحة).
const { backtest } = require('./backtest');
const { analyze } = require('./strategy');
const { analyzePullback } = require('./pullback');
const { fetchYahooHistory, groupCandles, formatTime } = require('./yahoo');

const RULES = { phase1: 8, phase2: 5, dailyLoss: 5, maxLoss: 10 };

const SETUPS = [
  ['XAU/USD', '1h', 'EMA + MACD'],
  ['XAU/USD', '1h', 'Pullback'],
  ['XAU/USD', '4h', 'EMA + MACD'],
  ['XAU/USD', '4h', 'Pullback'],
  ['XAG/USD', '1h', 'EMA + MACD'],
  ['XAG/USD', '4h', 'EMA + MACD'],
  ['XAG/USD', '4h', 'Pullback'],
];

// صفقة واحدة فقط في نفس الاتجاه على نفس الرمز (قاعدة البوت): نتخطى الإشارة إذا كانت أخرى مفتوحة
function onePerSide(trades) {
  const taken = [];
  for (const t of [...trades].sort((a, b) => (a.time < b.time ? -1 : 1))) {
    const busy = taken.some((x) => x.symbol === t.symbol && x.side === t.side && x.time <= t.time && t.time < x.closedAt);
    if (!busy) taken.push(t);
  }
  return taken;
}

// مرحلة واحدة من الاختبار ابتداءً من الوقت start. الصفقات مرتبة بوقت الإغلاق، والنتائج بالنسبة المئوية من الرصيد الابتدائي
function runPhase(trades, start, target, riskPct, rules = RULES) {
  let equity = 0;
  let day = null;
  let dayPnl = 0;
  for (const t of trades) {
    if (t.time < start) continue;
    const d = t.closedAt.slice(0, 10);
    if (d !== day) [day, dayPnl] = [d, 0];
    const pnl = t.r * riskPct;
    equity += pnl;
    dayPnl += pnl;
    if (dayPnl <= -rules.dailyLoss) return { result: 'fail', reason: 'daily', end: t.closedAt, equity };
    if (equity <= -rules.maxLoss) return { result: 'fail', reason: 'max', end: t.closedAt, equity };
    if (equity >= target) return { result: 'pass', end: t.closedAt, equity };
  }
  return { result: 'open', equity };
}

const daysBetween = (a, b) => Math.round((Date.parse(b.replace(' ', 'T') + 'Z') - Date.parse(a.replace(' ', 'T') + 'Z')) / 86400000);

// نبدأ الاختبار كل 7 أيام، ونتجاهل البدايات التي لم تنته بيانات مرحلتيها
function simulate(trades, riskPct, rules = RULES) {
  const sorted = [...trades].sort((a, b) => (a.closedAt < b.closedAt ? -1 : 1));
  if (!sorted.length) return { runs: [] };
  const first = Date.parse(sorted[0].time.replace(' ', 'T') + 'Z');
  const last = Date.parse(sorted.at(-1).closedAt.replace(' ', 'T') + 'Z');
  const runs = [];
  for (let s = first; s < last; s += 7 * 86400000) {
    const start = new Date(s).toISOString().slice(0, 19).replace('T', ' ');
    const p1 = runPhase(sorted, start, rules.phase1, riskPct, rules);
    if (p1.result === 'open') continue;
    if (p1.result === 'fail') {
      runs.push({ start, result: 'fail', phase: 1, reason: p1.reason });
      continue;
    }
    const p2 = runPhase(sorted, p1.end, rules.phase2, riskPct, rules);
    if (p2.result === 'open') continue;
    runs.push(p2.result === 'pass' ? { start, result: 'pass', days: daysBetween(start, p2.end), p1Days: daysBetween(start, p1.end) } : { start, result: 'fail', phase: 2, reason: p2.reason });
  }
  return { runs };
}

function summarize(runs) {
  const passed = runs.filter((r) => r.result === 'pass');
  const days = passed.map((r) => r.days).sort((a, b) => a - b);
  const fails = runs.filter((r) => r.result === 'fail');
  return {
    total: runs.length,
    passRate: runs.length ? (passed.length / runs.length) * 100 : 0,
    medianDays: days.length ? days[Math.floor(days.length / 2)] : null,
    slowDays: days.length ? days[Math.floor(days.length * 0.8)] : null,
    dailyFails: fails.filter((r) => r.reason === 'daily').length,
    maxFails: fails.filter((r) => r.reason === 'max').length,
  };
}

// أسوأ يوم وأكبر تراجع على الفترة كلها (بالنسبة المئوية)
function pathStats(trades, riskPct) {
  const sorted = [...trades].sort((a, b) => (a.closedAt < b.closedAt ? -1 : 1));
  const byDay = {};
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of sorted) {
    const pnl = t.r * riskPct;
    byDay[t.closedAt.slice(0, 10)] = (byDay[t.closedAt.slice(0, 10)] ?? 0) + pnl;
    equity += pnl;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  return { worstDay: Math.min(0, ...Object.values(byDay)), maxDd, total: equity };
}

module.exports = { onePerSide, runPhase, simulate, summarize, pathStats, RULES };

if (require.main === module) {
  const STRATS = { 'EMA + MACD': analyze, Pullback: analyzePullback };
  const MARKETS = { 'XAU/USD': { ticker: 'GC=F', spread: 0.35 }, 'XAG/USD': { ticker: 'SI=F', spread: 0.035 } };
  (async () => {
    const all = [];
    let span = null;
    for (const [symbol, m] of Object.entries(MARKETS)) {
      const hourly = await fetchYahooHistory(m.ticker, '60m', 729);
      span = `${formatTime(hourly[0].seconds).slice(0, 10)} → ${formatTime(hourly.at(-1).seconds).slice(0, 10)}`;
      for (const [tf, group] of [['1h', 1], ['4h', 4]]) {
        const candles = groupCandles(hourly, group).map(({ seconds, open, high, low, close }) => ({ time: formatTime(seconds), open, high, low, close }));
        for (const [s, i, name] of SETUPS) {
          if (s !== symbol || i !== tf) continue;
          const res = backtest(candles, STRATS[name], { spread: m.spread });
          all.push(...res.trades.map((t) => ({ ...t, symbol, setup: `${symbol} ${tf} ${name}` })));
        }
      }
    }
    const filtered = onePerSide(all);
    const months = 24;
    console.log(`اختبار Prop Firm على ${span} — ${SETUPS.length} إعدادات من البوت، بعد السبريد`);
    console.log(`القواعد: المرحلة 1 = +${RULES.phase1}%، المرحلة 2 = +${RULES.phase2}%، أقصى خسارة يومية ${RULES.dailyLoss}%، أقصى خسارة كلية ${RULES.maxLoss}%`);
    console.log(`الصفقات: ${all.length} إشارة، منها ${filtered.length} بعد قاعدة صفقة واحدة في كل اتجاه (~${Math.round(filtered.length / months)} في الشهر)\n`);
    for (const risk of [0.5, 1, 1.5]) {
      const sum = summarize(simulate(filtered, risk).runs);
      const p = pathStats(filtered, risk);
      console.log(`━━ المخاطرة ${risk}% في الصفقة`);
      console.log(`  من ${sum.total} بداية: نجح ${sum.passRate.toFixed(0)}% | فشل بالخسارة اليومية: ${sum.dailyFails} | بالخسارة الكلية: ${sum.maxFails}`);
      if (sum.medianDays !== null) console.log(`  مدة النجاح (المرحلتان): عادة ~${sum.medianDays} يوماً، وأحياناً ${sum.slowDays}+ يوماً`);
      console.log(`  على السنتين: ${p.total >= 0 ? '+' : ''}${p.total.toFixed(1)}% | أكبر تراجع ${p.maxDd.toFixed(1)}% | أسوأ يوم ${p.worstDay.toFixed(1)}%`);
      console.log(`  بعد التمويل: متوسط ~${(p.total / months).toFixed(1)}% في الشهر\n`);
    }
    console.log('تقريب: الخسارة اليومية من الصفقات المغلقة فقط. الشركات تحسب الصفقات المفتوحة أيضاً، فالواقع أصعب قليلاً.');
  })().catch((err) => {
    console.error('فشل:', err.message);
    process.exit(1);
  });
}
