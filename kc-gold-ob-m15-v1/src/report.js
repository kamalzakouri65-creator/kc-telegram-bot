// تشغيل الـ Baseline بالتكاليف الثلاث، والتقرير الكامل، والحكم.
const { backtest } = require('./backtest');
const { metrics, splitBounds, splitOf, verdict, fmtPf, quantiles } = require('./stats');
const { fmt } = require('./time');

const sgn = (x, d = 2) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
const SPLITS = [
  ['dev', 'Development (60%)'],
  ['val', 'Validation (20%)'],
  ['oos', 'Out-of-Sample (20%)'],
];
function row(label, m) {
  if (!m.n) return `${label}: 0 صفقة`;
  return `${label}: ${m.n} صفقة | ربح ${m.winRate.toFixed(0)}% | PF ${fmtPf(m.pf)} | ${sgn(m.net, 1)}R | Exp ${sgn(m.exp, 3)}R | تراجع ${m.maxDd.toFixed(1)}R (${m.ddPct.toFixed(1)}%) | أطول خسائر ${m.worst} | متوسط الربح ${sgn(m.avgWin)}R | متوسط الخسارة ${sgn(m.avgLoss)}R`;
}

function runAll(m1, cfg) {
  const out = {};
  for (const [key, costs] of Object.entries(cfg.costs)) out[key] = backtest(m1, { rules: cfg.rules, risk: cfg.risk, costs, costFilterPct: cfg.costFilterPct });
  return out;
}

function evaluate(runs, bounds, cfg) {
  const by = {};
  for (const [key, res] of Object.entries(runs)) {
    for (const t of res.trades) t.split = splitOf(t.entryTime, bounds);
    by[key] = { total: metrics(res.trades) };
    for (const [s] of SPLITS) by[key][s] = metrics(res.trades.filter((t) => t.split === s));
  }
  const v = verdict(by.base, by.doubled.total, cfg.verdict);
  return { by, v };
}

function buildReport({ runs, bounds, win, cfg, quality, dataHash, removed }) {
  const { by, v } = evaluate(runs, bounds, cfg);
  const base = runs.base;
  const T = base.trades;
  const L = [];
  L.push('GOLD ORDER BLOCK M15 V1 — تقرير Baseline (تشغيل وحيد، بدون أي Optimization)', '');
  L.push(`البيانات: ذهب M1 من Twelve Data (UTC)، ${fmt(win.start)} → ${fmt(win.end)} = ${win.months.toFixed(1)} شهراً${win.full ? '' : ` ⚠️ أقل من ${cfg.months} شهراً المطلوبة: هذه كل البيانات المتاحة`}`);
  L.push(`شموع M1 في الاختبار: ${quality.count} | محذوفة: ${removed.closed} في أوقات الإغلاق، ${removed.invalid} غير صالحة | M15: ${base.m15Count} | H1: ${base.h1Count}`);
  L.push(`بصمة ملف البيانات (SHA-256): ${dataHash.slice(0, 16)}…`);
  L.push('');
  L.push('الفرضيات:');
  L.push('  • أسعار Twelve Data تُعامل كـ Mid. Ask = Mid + السبريد ÷ 2، و Bid = Mid − السبريد ÷ 2.');
  L.push('  • الشراء يدخل على Ask ويخرج على Bid، والبيع يدخل على Bid ويخرج على Ask. السبريد داخل الأسعار ولا يُخصم مرة ثانية.');
  L.push('  • الانزلاق والعمولة يُخصمان مرة واحدة لكل صفقة. Swap = 0.02% من سعر الدخول لكل عبور 21:00 UTC، على الشراء والبيع (فرضية محافظة).');
  L.push('  • داخل دقيقة M1: الوقف أولاً ثم الهدف. التعادل عند +1R يبدأ من الدقيقة التالية. الفجوة خلف الوقف تُغلق بسعر الافتتاح، والهدف بسعره.');
  L.push(`  • المخاطرة ${cfg.risk.riskPct}% من الرصيد الحالي (البداية ${cfg.risk.startEquity}$)، والحجم مستمر بدون تقريب للوت.`);
  L.push('');
  L.push('التقسيم الزمني (الصفقة تُنسب لوقت دخولها):');
  L.push(`  Development: ${fmt(bounds.start)} → ${fmt(bounds.devEnd)}`);
  L.push(`  Validation:  ${fmt(bounds.devEnd)} → ${fmt(bounds.valEnd)}`);
  L.push(`  Out-of-Sample: ${fmt(bounds.valEnd)} → ${fmt(bounds.end)}`);
  L.push('');
  L.push('قمع الإشارات (التكاليف الأساسية):');
  const s = base.structure;
  const f = base.funnel;
  L.push(`  BOS: ${s.bos} | بدون Displacement: ${s.bosNoDisplacement} | بدون شمعة OB: ${s.bosNoOb} | OB صالحة: ${s.obs}`);
  L.push(`  OB منتهية العمر: ${s.expired} | ملغاة بالإغلاق خلفها: ${s.invalidated} | انتهت لمستاها: ${s.touchesUsed}`);
  L.push(`  إشارات تأكيد مع الاتجاه: ${f.signals} | مرفوضة: صفقة مفتوحة ${f.position}، خارج الجلسات ${f.session}، حد الخسائر اليومي ${f.dailyLimit}، فجوة ${f.gap}، الافتتاح خلف الوقف ${f.beyondStop}، فلتر التكلفة ${f.cost} | صفقات: ${f.taken}`);
  L.push('');
  for (const [key, res] of Object.entries(runs)) {
    L.push(`━━ ${cfg.costs[key].name}`);
    L.push(`   ${row('المجموع', by[key].total)}`);
    for (const [sp, name] of SPLITS) L.push(`   ${row(name, by[key][sp])}`);
    L.push(`   الرصيد: ${cfg.risk.startEquity}$ → ${res.equity.toFixed(2)}$ (${sgn(by[key].total.usd)}$)`);
    L.push('');
  }
  L.push('━━ تفاصيل التكاليف الأساسية');
  L.push(`   ${row('شراء', metrics(T.filter((t) => t.side > 0)))}`);
  L.push(`   ${row('بيع', metrics(T.filter((t) => t.side < 0)))}`);
  L.push(`   ${row('لندن فقط', metrics(T.filter((t) => t.session === 'london')))}`);
  L.push(`   ${row('نيويورك فقط', metrics(T.filter((t) => t.session === 'ny')))}`);
  L.push(`   ${row('التداخل (لندن + نيويورك)', metrics(T.filter((t) => t.session === 'overlap')))}`);
  L.push(`   ${row('ابتلاعية', metrics(T.filter((t) => t.pattern === 'engulfing')))}`);
  L.push(`   ${row('Pin bar', metrics(T.filter((t) => t.pattern === 'pinbar')))}`);
  L.push(`   ${row('اللمسة 1', metrics(T.filter((t) => t.touch === 1)))}`);
  L.push(`   ${row('اللمسة 2', metrics(T.filter((t) => t.touch === 2)))}`);
  const oc = (o) => T.filter((t) => t.outcome === o).length;
  L.push(`   النتائج: الهدف ${oc('TP')} | الوقف ${oc('SL')} | التعادل ${oc('BE')} | نهاية البيانات ${oc('END')} | صفقات عبرت 21:00 UTC: ${T.filter((t) => t.nights > 0).length} (Swap ${T.reduce((a, t) => a + t.swapUsd, 0).toFixed(2)}$)`);
  L.push('');
  L.push('━━ نسبة التكلفة إلى المخاطرة (0.62$ ÷ مسافة الوقف)');
  const cp = T.map((t) => t.costPct);
  const [mn, q1, med, q3, mx] = quantiles(cp, [0, 0.25, 0.5, 0.75, 1]);
  if (cp.length) L.push(`   الصفقات المنفذة: أدنى ${mn.toFixed(1)}% | الربع الأول ${q1.toFixed(1)}% | الوسيط ${med.toFixed(1)}% | الربع الثالث ${q3.toFixed(1)}% | أعلى ${mx.toFixed(1)}%`);
  const bucket = (a, b) => cp.filter((x) => x >= a && x < b).length;
  L.push(`   أقل من 2%: ${bucket(0, 2)} | 2–5%: ${bucket(2, 5)} | 5–10%: ${bucket(5, 10.0000001)} | مرفوضة فوق 10%: ${base.rejectedCostPct.length}`);
  const dist = T.map((t) => t.dist);
  if (dist.length) L.push(`   مسافة الوقف بالدولار: الوسيط ${quantiles(dist, [0.5])[0].toFixed(2)} | أدنى ${Math.min(...dist).toFixed(2)} | أعلى ${Math.max(...dist).toFixed(2)}`);
  L.push('');
  L.push('━━ كل شهر (التكاليف الأساسية، حسب شهر الدخول UTC)');
  const months = [...new Set(T.map((t) => fmt(t.entryTime).slice(0, 7)))].sort();
  for (const mo of months) {
    const m = metrics(T.filter((t) => fmt(t.entryTime).slice(0, 7) === mo));
    L.push(`   ${mo}: ${m.n} صفقة | ربح ${m.winRate.toFixed(0)}% | ${sgn(m.net, 1)}R`);
  }
  L.push(`   أشهر رابحة: ${months.filter((mo) => metrics(T.filter((t) => fmt(t.entryTime).slice(0, 7) === mo)).net > 0).length} من ${months.length}`);
  L.push('');
  L.push(`━━ الحكم: ${v.verdict}`);
  if (v.reasons.length) for (const r of v.reasons) L.push(`   • ${r}`);
  else L.push('   PF ≥ 1.2 في الأقسام الثلاثة، وضعف السبريد: صافي موجب و PF > 1.00.');
  L.push('');
  L.push('⚠️ حتى مع 30 صفقة أو أكثر في Out-of-Sample، العدد وحده ليس دليلاً كافياً على الربحية.');
  L.push('⚠️ هذا اختبار تاريخي فقط. لا تداول حي، ولا اتصال بأي وسيط. لا Optimization قبل مراجعة هذا التقرير.');
  L.push('R = المبلغ المخاطر به في الصفقة. Exp = متوسط النتيجة لكل صفقة. PF = مجموع الأرباح ÷ مجموع الخسائر.');
  return { text: L.join('\n'), verdict: v, by };
}

module.exports = { runAll, evaluate, buildReport, row };
