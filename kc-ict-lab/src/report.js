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

// أول 70% من الأيام وآخر 30%: الاثنتان يجب أن تكونا موجبتين
function evaluate(trades, days, criteria = config.criteria) {
  const cutoff = days[Math.floor(days.length * (1 - criteria.oosShare))];
  const all = metrics(trades);
  const first = metrics(trades.filter((t) => t.date < cutoff));
  const last = metrics(trades.filter((t) => t.date >= cutoff));
  const reasons = [];
  if (all.count < criteria.minTrades) reasons.push(`صفقات أقل من ${criteria.minTrades}`);
  if (!(all.profitFactor >= criteria.minProfitFactor)) reasons.push(`معامل الربح أقل من ${criteria.minProfitFactor}`);
  if (!(first.totalR > 0)) reasons.push('الفترة الأولى غير رابحة');
  if (!(last.totalR > 0)) reasons.push('الفترة الأخيرة غير رابحة');
  return { all, first, last, cutoff, pass: reasons.length === 0, reasons };
}

const fmt = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
const pf = (m) => (m.count === 0 ? '—' : Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞');
const line = (label, m) => `${label}: ${m.count} صفقة | ربح ${m.winRate.toFixed(0)}% | PF ${pf(m)} | ${fmt(m.totalR)}R | تراجع ${m.maxDd.toFixed(1)}R`;

function section(title, trades, days, groupBy) {
  const ev = evaluate(trades, days);
  const outcomes = ['target', 'stop', 'time'].map((o) => `${{ target: 'الهدف', stop: 'الوقف', time: 'انتهاء الوقت' }[o]}: ${trades.filter((t) => t.outcome === o).length}`);
  const groups = {};
  for (const t of trades) (groups[groupBy(t)] ??= []).push(t);
  return [
    `━━ ${title} — ${days[0]} → ${days.at(-1)}`,
    line('الكل', ev.all),
    line('شراء', metrics(trades.filter((t) => t.side === 'BUY'))),
    line('بيع', metrics(trades.filter((t) => t.side === 'SELL'))),
    ...Object.entries(groups).map(([g, xs]) => line(g, metrics(xs))),
    line(`الفترة الأولى (قبل ${ev.cutoff})`, ev.first),
    line('الفترة الأخيرة', ev.last),
    `أطول سلسلة خسائر: ${ev.all.worstStreak} | ${outcomes.join(' | ')}`,
    ev.pass ? '✅ نجحت في الشروط.' : `❌ فشلت — ${ev.reasons.join('، ')}.`,
  ].join('\n');
}

function buildReport({ sb, pd }) {
  return [
    'KC ICT Lab V1 — الذهب XAU/USD — اختبار تاريخي فقط',
    `الشروط: ${config.criteria.minTrades} صفقة على الأقل، PF ≥ ${config.criteria.minProfitFactor} بعد السبريد ${config.spread}، والفترتان الأولى والأخيرة رابحتان.`,
    '',
    section('Silver Bullet (5 دقائق)', sb.trades, sb.days, (t) => `نافذة ${t.window}`),
    '',
    section('Previous Day High/Low (15 دقيقة)', pd.trades, pd.days, (t) => t.date.slice(0, 4)),
    '',
    'قرارات التفسير:',
    ...DECISIONS,
    '',
    'R = المبلغ الذي تخاطر به في الصفقة. النتائج بعد خصم السبريد التقديري.',
  ].join('\n');
}

const tradesCsv = (trades) => {
  const cols = ['date', 'side', 'window', 'entryTime', 'entry', 'stopLoss', 'target', 'exitTime', 'exit', 'outcome', 'r'];
  return [cols.join(','), ...trades.map((t) => cols.map((c) => (typeof t[c] === 'number' ? +t[c].toFixed(3) : t[c] ?? '')).join(','))].join('\n');
};

module.exports = { metrics, evaluate, buildReport, tradesCsv };
