// المقاييس والتقرير. كل الأرقام من الصفقات كما هي، بدون أي تعديل.
const { SPLITS, CRITERIA, COSTS, RISK, SESSIONS } = require('./rules');

function metrics(trades, key = 'r') {
  let eq = 0;
  let peak = 0;
  let dd = 0;
  let streak = 0;
  let worst = 0;
  for (const t of trades) {
    eq += t[key];
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
    streak = t[key] < 0 ? streak + 1 : 0;
    worst = Math.max(worst, streak);
  }
  const wins = trades.filter((t) => t[key] > 0);
  const losses = trades.filter((t) => t[key] < 0);
  const gw = wins.reduce((s, t) => s + t[key], 0);
  const gl = -losses.reduce((s, t) => s + t[key], 0);
  return {
    n: trades.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    pf: gl ? gw / gl : trades.length && gw > 0 ? Infinity : 0,
    net: eq,
    maxDd: dd,
    avgWin: wins.length ? gw / wins.length : 0,
    avgLoss: losses.length ? gl / losses.length : 0,
    expectancy: trades.length ? eq / trades.length : 0,
    worstStreak: worst,
  };
}

// تقسيم الصفقات حسب أيام البيانات (60/20/20)
function splitByDays(trades, days) {
  const out = [];
  let start = 0;
  for (const [name, share] of SPLITS) {
    const end = name === SPLITS.at(-1)[0] ? days.length : Math.round(start + days.length * share);
    const from = days[start];
    const to = days[end - 1];
    out.push({ name, from, to, trades: trades.filter((t) => t.date >= from && t.date <= to) });
    start = end;
  }
  return out;
}

// الحكم: كل الشروط معاً
function verdict(base, double, splits) {
  const reasons = [];
  const all = metrics(base);
  if (all.n < CRITERIA.minTrades) reasons.push(`عدد الصفقات ${all.n} أقل من ${CRITERIA.minTrades}`);
  for (const s of splits) {
    const m = metrics(s.trades);
    if (!(m.pf >= CRITERIA.minProfitFactor)) reasons.push(`${s.name}: PF ${fmtPf(m.pf)} أقل من ${CRITERIA.minProfitFactor}`);
    if (!(m.net > 0)) reasons.push(`${s.name}: غير رابح (${fmt(m.net)}R)`);
  }
  if (!(metrics(double).net > 0)) reasons.push(`بضعف السبريد: غير رابح (${fmt(metrics(double).net)}R)`);
  const byMonth = {};
  for (const t of base) byMonth[t.month] = (byMonth[t.month] ?? 0) + t.r;
  const bestMonth = Math.max(0, ...Object.values(byMonth));
  if (all.net > 0 && bestMonth / all.net > CRITERIA.maxMonthShare) reasons.push(`شهر واحد صنع ${((bestMonth / all.net) * 100).toFixed(0)}% من الربح (الحد 50%)`);
  return { pass: reasons.length === 0, reasons };
}

const fmt = (x, d = 1) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
const fmtPf = (pf) => (Number.isFinite(pf) ? pf.toFixed(2) : '∞');
const row = (label, m) =>
  `${label}: ${m.n} صفقة | ربح ${m.winRate.toFixed(0)}% | PF ${fmtPf(m.pf)} | ${fmt(m.net)}R | تراجع ${m.maxDd.toFixed(1)}R | Exp ${fmt(m.expectancy, 3)}R | متوسط الربح ${m.avgWin.toFixed(2)}R / الخسارة ${m.avgLoss.toFixed(2)}R | أطول خسائر ${m.worstStreak}`;

function buildReport({ base, double, usd, days, dataInfo, setupsCount }) {
  const t = base.trades;
  const splits = splitByDays(t, days);
  const v = verdict(t, double.trades, splits);
  const lines = [];
  lines.push('KC GOLD SCALPING V1 — Liquidity Sweep + Market Structure + FVG — اختبار تاريخي فقط');
  lines.push(`البيانات: XAU/USD M1 (Twelve Data، UTC) ${dataInfo} | الوسيط النظري: XAUUSDm`);
  lines.push(`التكاليف لكل صفقة: سبريد ${COSTS.spread}$ + انزلاق ${COSTS.slippage}$ + عمولة ${COSTS.commission}$ للأونصة. النتائج بالـ R بعد التكاليف.`);
  lines.push(`إعدادات وُجدت: ${setupsCount} | نُفذت: ${t.length}`);
  lines.push('أسباب التخطي: ' + (Object.entries(base.skipped).map(([k, n]) => `${k} ${n}`).join(' | ') || 'لا شيء'));
  lines.push('');
  lines.push('━━ النتيجة الإجمالية');
  lines.push(row('الكل', metrics(t)));
  lines.push(row('بضعف السبريد', metrics(double.trades)));
  lines.push('');
  lines.push('━━ التقسيم (60/20/20، بدون أي تحسين)');
  for (const s of splits) lines.push(row(`${s.name} (${s.from} → ${s.to})`, metrics(s.trades)));
  lines.push('');
  lines.push('━━ الشراء والبيع');
  for (const side of ['BUY', 'SELL']) lines.push(row(side, metrics(t.filter((x) => x.side === side))));
  lines.push('');
  lines.push('━━ الجلسات');
  for (const s of SESSIONS) lines.push(row(`${s.name} (${s.from}–${s.to} نيويورك)`, metrics(t.filter((x) => x.session === s.name))));
  lines.push('');
  lines.push('━━ نوع كسر البنية');
  for (const k of ['CHoCH', 'BOS']) lines.push(row(k, metrics(t.filter((x) => x.kind === k))));
  lines.push('');
  lines.push('━━ طريقة الخروج');
  const how = {};
  for (const x of t) how[x.how] = (how[x.how] ?? 0) + 1;
  lines.push(Object.entries(how).map(([k, n]) => `${k}: ${n}`).join(' | '));
  lines.push('');
  lines.push('━━ كل شهر');
  const months = [...new Set(t.map((x) => x.month))].sort();
  for (const m of months) lines.push(row(m, metrics(t.filter((x) => x.month === m))));
  lines.push('');
  lines.push(`━━ محاكاة حساب ${RISK.balance}$ (1% من الرصيد، الحجم بخطوات ${RISK.lotStep})`);
  lines.push(`⚠️ حجم العقد مفترض ${RISK.contractSize} أونصة للوت (غير مؤكد من MT5). هذا القسم فقط يعتمد عليه.`);
  const mu = metrics(usd.trades, 'usd');
  lines.push(`صفقات: ${mu.n} | الرصيد النهائي: ${usd.endBalance.toFixed(2)}$ | الصافي ${fmt(mu.net, 2)}$ | أكبر تراجع ${mu.maxDd.toFixed(2)}$ | PF ${fmtPf(mu.pf)}`);
  lines.push('أسباب التخطي: ' + (Object.entries(usd.skipped).map(([k, n]) => `${k} ${n}`).join(' | ') || 'لا شيء'));
  lines.push('');
  lines.push(`━━ الحكم: ${v.pass ? '✅ نجحت في كل الشروط' : '❌ فشلت'}`);
  for (const r of v.reasons) lines.push(`  • ${r}`);
  lines.push(`الشروط: PF ≥ ${CRITERIA.minProfitFactor} وربح في كل قسم، وربح بضعف السبريد، و ${CRITERIA.minTrades} صفقة على الأقل، ولا شهر يصنع أكثر من 50% من الربح.`);
  lines.push('R = المبلغ الذي تخاطر به في الصفقة. Exp = متوسط النتيجة لكل صفقة.');
  return { text: lines.join('\n'), verdict: v };
}

const tradesCsv = (trades) =>
  ['date,session,side,kind,entry_time,exit_time,entry,stop,target,exit,how,r', ...trades.map((x) => [x.date, x.session, x.side, x.kind, x.entryTime, x.exitTime, x.entry.toFixed(3), x.stop.toFixed(3), x.target.toFixed(3), x.exit.toFixed(3), x.how, x.r.toFixed(3)].join(','))].join('\n');

module.exports = { metrics, splitByDays, verdict, buildReport, tradesCsv };
