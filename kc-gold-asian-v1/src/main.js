// الأوامر:
//   npm run quality    فحص الجودة وحدود الأقسام وأثر حد 25$ (قبل أي نتيجة)
//   npm run backtest   التشغيل الوحيد (يتطلب فحص الجودة على نفس البصمة)
//   npm run report     عرض التقرير المحفوظ
// لا تداول، ولا اتصال بأي وسيط، ولا Telegram. الملف الأصلي يُقرأ فقط.
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const data = require('./data');
const { signals } = require('./strategy');
const { periodOf, runAll } = require('./run');
const { buildReport } = require('./report');
const { fmt } = require('./time');

const P = (n) => path.join(config.paths.data, n);
const REPORT = 'GOLD_ASIAN_RANGE_BREAKOUT_V1_FINAL_REPORT.md';
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
const write = (f, s) => (fs.mkdirSync(path.dirname(f), { recursive: true }), fs.writeFileSync(f, s));

function prepare() {
  const src = data.loadSource();
  const q = data.quality(src.bars);
  const { bars, removed } = data.clean(src.bars);
  return { src, q, bars, removed };
}

function qualityCmd() {
  const { src, q, bars, removed } = prepare();
  const bounds = periodOf(bars, config);
  const { log } = signals(bars, config.rule);
  const L = ['GOLD ASIAN RANGE BREAKOUT V1 — فحص جودة البيانات (قبل أي نتيجة)', ''];
  L.push(`الملف (قراءة فقط): kc-gold-lab/data/xau-m15.json | البصمة ${src.hash.slice(0, 16)}…`);
  L.push(`الشموع الخام: ${src.raw} | ${fmt(q.first)} → ${fmt(q.last)}`);
  L.push(`مكرر: ${src.duplicates} | غير مرتب: ${src.unsorted} | خارج شبكة 15 دقيقة: ${q.offGrid} | في أوقات الإغلاق: ${q.closed} | غير صالح: ${q.invalid} | مسطح: ${q.flat}`);
  L.push(`الشموع المفقودة في ساعات السوق: ${q.missingOpen} من ${q.expectedOpen} (${((q.missingOpen / Math.max(1, q.expectedOpen)) * 100).toFixed(2)}%)`);
  L.push(`أكبر الفجوات: ${q.gaps.slice(0, 8).map((g) => `${fmt(g.after)} (${g.missing} شمعة)`).join('، ') || 'لا يوجد'}`);
  const openJumps = q.jumps.filter((j) => !j.closed);
  L.push(`قفزات > 0.5% بين شمعتين: ${q.jumps.length} (منها ${openJumps.length} في ساعات السوق)${openJumps.length ? ' — ' + openJumps.slice(0, 8).map((j) => `${fmt(j.time)} ${j.pct.toFixed(2)}%`).join('، ') : ''}`);
  L.push(`بعد التنظيف: ${bars.t.length} شمعة (حُذف ${removed.closed} في أوقات الإغلاق و ${removed.invalid} غير صالحة)`);
  L.push('', 'حدود الأقسام (حسب الوقت، من أول يوم فيه SMA20):');
  L.push(`  Development: ${fmt(bounds.start)} → ${fmt(bounds.devEnd)}`);
  L.push(`  Validation: ${fmt(bounds.devEnd)} → ${fmt(bounds.valEnd)}`);
  L.push(`  Historical Holdout: ${fmt(bounds.valEnd)} → ${fmt(bounds.end)}`);
  L.push('', 'أثر حد النطاق 3–25$ (أيام لندن، بدون أي نتيجة تداول):');
  for (const [y, s] of Object.entries(log.byYear).sort()) L.push(`  ${y}: ${s.days} يوم | نطاق > 25$: ${s.tooBig} | نطاق < 3$: ${s.tooSmall} | بدون نطاق آسيا كافٍ: ${s.noRange}`);
  L.push('', 'الشموع في كل شهر:');
  const months = Object.entries(q.months).sort();
  for (let i = 0; i < months.length; i += 4) L.push('  ' + months.slice(i, i + 4).map(([m, n]) => `${m}: ${n}`).join(' | '));
  const text = L.join('\n');
  console.log(text);
  write(path.join(config.paths.reports, 'quality-report.txt'), text);
  write(P('quality-done.json'), JSON.stringify({ at: new Date().toISOString(), hash: src.hash }));
  console.log('\nمحفوظ في reports/quality-report.txt. أرسل لي هذا التقرير قبل تشغيل الاختبار.');
}

function backtestCmd() {
  const done = readJson(P('backtest-done.json'));
  if (done) {
    console.log(`⛔ الاختبار تم تشغيله مرة واحدة بتاريخ ${done.at}. لا إعادة تشغيل. لعرض التقرير: npm run report`);
    return;
  }
  const { src, q, bars, removed } = prepare();
  const qd = readJson(P('quality-done.json'));
  if (!qd || qd.hash !== src.hash) throw new Error('شغّل أولاً فحص الجودة على نفس البيانات: npm run quality');
  const R = runAll(bars, config);
  const text = buildReport({ R, cfg: config, q, hash: src.hash, removed, bars });
  write(path.join(config.paths.reports, REPORT), text);
  write(path.join(config.paths.docs, REPORT), text);
  const csv = ['day,split,side,entryTime,exitTime,entry,stop,tp,exit,dist,range,costPct,how,r,pnl,equityAfter'];
  for (const t of R.base.res.trades) csv.push([t.day, t.split, t.side > 0 ? 'buy' : 'sell', fmt(t.entryTime), fmt(t.exitTime), t.entry.toFixed(3), t.stop.toFixed(3), t.tp.toFixed(3), t.exit.toFixed(3), t.dist.toFixed(3), t.range.toFixed(2), t.costPct.toFixed(2), t.how, t.r.toFixed(4), t.pnl.toFixed(4), t.equityAfter.toFixed(2)].join(','));
  write(path.join(config.paths.reports, 'trades-base.csv'), csv.join('\n'));
  write(P('backtest-done.json'), JSON.stringify({ at: new Date().toISOString(), hash: src.hash, verdict: R.v.verdict }));
  console.log(text);
  console.log(`\nمحفوظ في reports/${REPORT}`);
}

function reportCmd() {
  try {
    console.log(fs.readFileSync(path.join(config.paths.reports, REPORT), 'utf8'));
  } catch {
    console.log('لا يوجد تقرير بعد. شغّل: npm run backtest');
  }
}

const cmds = { quality: qualityCmd, backtest: backtestCmd, report: reportCmd };
const cmd = cmds[process.argv[2]];
if (!cmd) console.log('الأوامر: quality | backtest | report');
else
  try {
    cmd();
  } catch (e) {
    console.error('فشل:', e.message);
    process.exit(1);
  }
