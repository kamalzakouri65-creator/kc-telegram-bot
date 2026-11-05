const { config, DECISIONS } = require('./config');

function metrics(trades) {
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  let streak = 0;
  let worst = 0;
  for (const t of trades) {
    equity += t.r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
    streak = t.r < 0 ? streak + 1 : 0;
    worst = Math.max(worst, streak);
  }
  const wins = trades.filter((t) => t.r > 0);
  const grossWin = wins.reduce((s, t) => s + t.r, 0);
  const grossLoss = -trades.filter((t) => t.r < 0).reduce((s, t) => s + t.r, 0);
  return {
    count: trades.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    totalR: equity,
    profitFactor: grossLoss ? grossWin / grossLoss : trades.length ? Infinity : 0,
    maxDd,
    worstStreak: worst,
  };
}

// آخر 30% من الأيام = الفترة الأخيرة
function evaluate(result, criteria = config.criteria) {
  const cutoff = result.days[Math.floor(result.days.length * (1 - criteria.oosShare))];
  const oos = result.trades.filter((t) => t.date >= cutoff);
  const all = metrics(result.trades);
  const oosM = metrics(oos);
  const reasons = [];
  if (all.count < criteria.minTrades) reasons.push(`صفقات أقل من ${criteria.minTrades}`);
  if (!(all.profitFactor >= criteria.minProfitFactor)) reasons.push(`معامل الربح أقل من ${criteria.minProfitFactor}`);
  if (!(oosM.totalR > 0)) reasons.push('الفترة الأخيرة غير رابحة');
  return { all, oos: oosM, cutoff, pass: reasons.length === 0, reasons };
}

const fmt = (x, d = 1) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
const pf = (m) => (m.count === 0 ? '—' : Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞');
const line = (label, m) => `${label}: ${m.count} صفقة | ربح ${m.winRate.toFixed(0)}% | PF ${pf(m)} | ${fmt(m.totalR)}R | تراجع ${m.maxDd.toFixed(1)}R`;

function buildReport(result, meta = {}) {
  const ev = evaluate(result);
  const t = result.trades;
  const byYear = {};
  for (const x of t) (byYear[x.date.slice(0, 4)] ??= []).push(x);
  const outcomes = ['target', 'stop', 'close'].map((o) => `${o === 'target' ? 'الهدف' : o === 'stop' ? 'الوقف' : 'إغلاق اليوم'}: ${t.filter((x) => x.outcome === o).length}`);
  return [
    'KC Nasdaq ORB V1 — اختبار تاريخي فقط',
    `${config.symbol} ${config.interval} | ${result.days[0]} → ${result.days.at(-1)} | ${result.days.length} يوم تداول${meta.fetchedAt ? ` | البيانات: ${meta.fetchedAt.slice(0, 10)}` : ''}`,
    `أيام متخطاة: ${result.skipped.length} | أيام بدون اختراق: ${result.days.length - t.length - result.skipped.length}`,
    '',
    line('الكل', ev.all),
    line('شراء', metrics(t.filter((x) => x.side === 'BUY'))),
    line('بيع', metrics(t.filter((x) => x.side === 'SELL'))),
    `أطول سلسلة خسائر: ${ev.all.worstStreak} | ${outcomes.join(' | ')}`,
    '',
    ...Object.entries(byYear).map(([y, xs]) => line(y, metrics(xs))),
    line(`الفترة الأخيرة (من ${ev.cutoff})`, ev.oos),
    '',
    `الشروط: ${config.criteria.minTrades} صفقة على الأقل، PF ≥ ${config.criteria.minProfitFactor} بعد السبريد، والفترة الأخيرة رابحة.`,
    ev.pass ? '✅ النتيجة: نجحت الاستراتيجية في الشروط.' : `❌ النتيجة: فشلت — ${ev.reasons.join('، ')}.`,
    '',
    'قرارات التفسير:',
    ...DECISIONS,
    '',
    'R = المبلغ الذي تخاطر به في الصفقة. النتائج بعد خصم السبريد التقديري.',
  ].join('\n');
}

const tradesCsv = (trades) =>
  ['date,side,entry_time,entry,stop,target,exit_time,exit,outcome,r', ...trades.map((t) => [t.date, t.side, t.entryTime, t.entry, t.stopLoss.toFixed(4), t.target.toFixed(4), t.exitTime, t.exit.toFixed(4), t.outcome, t.r.toFixed(3)].join(','))].join('\n');

module.exports = { metrics, evaluate, buildReport, tradesCsv };
