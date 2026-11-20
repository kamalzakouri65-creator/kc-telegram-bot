// الأوامر:
//   npm run fetch     نسخ الملف الأصلي (قراءة فقط) ثم إكماله من Twelve Data حتى 24 شهراً (يكمل من حيث توقف)
//   npm run quality   فحص جودة البيانات (قبل أي نتيجة)
//   npm run baseline  الاختبار الأساسي — تشغيل وحيد
//   npm run report    عرض تقرير الـ Baseline المحفوظ
// لا تداول، ولا اتصال بأي وسيط: هذا المشروع يقرأ بيانات سوق فقط.
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const data = require('./data');
const { sliceM1 } = require('./bars');
const { splitBounds } = require('./stats');
const { runAll, buildReport } = require('./report');
const { fmt } = require('./time');

const P = (n) => path.join(config.paths.data, n);
const R = (n) => path.join(config.paths.reports, n);
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
const write = (f, s) => (fs.mkdirSync(path.dirname(f), { recursive: true }), fs.writeFileSync(f, s));

async function fetchCmd() {
  if (readJson(P('baseline-done.json'))) throw new Error('الـ Baseline تم تشغيله مسبقاً. لا تحميل جديد حتى لا تتغير البيانات بعد النتيجة.');
  console.log(`تحميل ذهب M1 (طلب كل ${config.twelveData.pauseMs / 1000} ثانية). إذا انقطع، أعد نفس الأمر وسيكمل من حيث توقف.`);
  const r = await data.fetchAll();
  const months = (r.last - r.first) / (30.4375 * 86400000);
  console.log(`\nانتهى (${r.reason}): ${r.count} شمعة، ${fmt(r.first)} → ${fmt(r.last)} = ${months.toFixed(1)} شهراً، ${r.pages} طلباً.`);
  console.log('الخطوة التالية: npm run quality');
}

function qualityCmd() {
  if (!data.exists()) throw new Error('لا توجد بيانات. شغّل أولاً: npm run fetch');
  const hash = data.sha256File(data.FILE());
  const raw = data.loadM1();
  const q = data.quality(raw);
  const { m1, removed } = data.clean(raw);
  const win = data.windowOf(m1, config.months);
  const L = ['GOLD ORDER BLOCK M15 V1 — فحص جودة البيانات (قبل أي اختبار)', ''];
  L.push(`الملف: data/xau-m1.json | البصمة ${hash.slice(0, 16)}…`);
  L.push(`الشموع: ${q.count} | ${fmt(q.first)} → ${fmt(q.last)}`);
  L.push(`فترة الاختبار: ${fmt(win.start)} → ${fmt(win.end)} = ${win.months.toFixed(1)} شهراً ${win.full ? `✅ ${config.months} شهراً متوفرة` : `⚠️ أقل من ${config.months} شهراً: سنستعمل كل المتاح`}`);
  L.push(`مكرر: ${q.duplicates} | غير مرتب: ${q.unsorted} | في أوقات الإغلاق: ${q.closed} | غير صالح (OHLC): ${q.invalid} | مسطح (O=H=L=C): ${q.flat}`);
  L.push(`الدقائق المفقودة في ساعات السوق: ${q.missingOpen} من ${q.expectedOpen} (${((q.missingOpen / Math.max(1, q.expectedOpen)) * 100).toFixed(2)}%)`);
  L.push(`أكبر الفجوات في ساعات السوق: ${q.gaps.slice(0, 10).map((g) => `${fmt(g.after)} (${g.missing} د)`).join('، ') || 'لا يوجد'}`);
  L.push(`قفزات > 0.5% خلال 5 دقائق: ${q.jumps.length}${q.jumps.length ? ' — ' + q.jumps.slice(0, 10).map((j) => `${fmt(j.time)} ${j.pct.toFixed(2)}%`).join('، ') : ''}`);
  L.push(`بعد التنظيف: ${m1.t.length} شمعة (حُذف ${removed.closed} في أوقات الإغلاق و ${removed.invalid} غير صالحة)`);
  L.push('', 'الشموع في كل شهر:');
  for (const [mo, n] of Object.entries(q.months).sort()) L.push(`  ${mo}: ${n}`);
  const text = L.join('\n');
  console.log(text);
  write(R('quality-report.txt'), text);
  write(P('quality-done.json'), JSON.stringify({ at: new Date().toISOString(), hash }));
  console.log('\nمحفوظ في reports/quality-report.txt. أرسل لي هذا التقرير قبل تشغيل الـ Baseline.');
}

function baselineCmd() {
  const done = readJson(P('baseline-done.json'));
  if (done) {
    console.log(`⛔ الـ Baseline تم تشغيله مرة واحدة بتاريخ ${done.at}. لا إعادة تشغيل. لعرض التقرير: npm run report`);
    return;
  }
  if (!data.exists()) throw new Error('لا توجد بيانات. شغّل أولاً: npm run fetch');
  const hash = data.sha256File(data.FILE());
  const q = readJson(P('quality-done.json'));
  if (!q || q.hash !== hash) throw new Error('شغّل أولاً فحص الجودة على نفس البيانات: npm run quality');
  const { m1: all, removed } = data.clean(data.loadM1());
  const win = data.windowOf(all, config.months);
  const m1 = sliceM1(all, win.start, win.end);
  console.log(`تشغيل الـ Baseline على ${m1.t.length} شمعة M1 (${win.months.toFixed(1)} شهراً)... قد يأخذ بضع دقائق.`);
  const runs = runAll(m1, config);
  const bounds = splitBounds(win.start, win.end, config.split);
  const { text, verdict } = buildReport({ runs, bounds, win, cfg: config, quality: { count: m1.t.length }, dataHash: hash, removed });
  console.log('\n' + text);
  write(R('baseline-report.txt'), text);
  const csv = ['entryTime,exitTime,split,side,session,pattern,touch,entry,stop,tp,exit,dist,units,costPct,nights,swapUsd,pnl,r,outcome,equityAfter'];
  for (const t of runs.base.trades) csv.push([fmt(t.entryTime), fmt(t.exitTime), t.split, t.side > 0 ? 'buy' : 'sell', t.session, t.pattern, t.touch, t.entry.toFixed(3), t.stop.toFixed(3), t.tp.toFixed(3), t.exit.toFixed(3), t.dist.toFixed(3), t.units.toFixed(4), t.costPct.toFixed(2), t.nights, t.swapUsd.toFixed(4), t.pnl.toFixed(4), t.r.toFixed(4), t.outcome, t.equityAfter.toFixed(2)].join(','));
  write(R('baseline-trades.csv'), csv.join('\n'));
  write(P('baseline-done.json'), JSON.stringify({ at: new Date().toISOString(), hash, window: [fmt(win.start), fmt(win.end)], verdict: verdict.verdict }));
  console.log('\nمحفوظ في reports/baseline-report.txt و reports/baseline-trades.csv');
}

function reportCmd() {
  try {
    console.log(fs.readFileSync(R('baseline-report.txt'), 'utf8'));
  } catch {
    console.log('لا يوجد تقرير بعد. شغّل: npm run baseline');
  }
}

const cmds = { fetch: fetchCmd, quality: qualityCmd, baseline: baselineCmd, report: reportCmd };
const cmd = cmds[process.argv[2]];
if (!cmd) console.log('الأوامر: fetch | quality | baseline | report');
else
  Promise.resolve()
    .then(cmd)
    .catch((e) => {
      console.error('فشل:', e.message);
      if (/credits|limit/i.test(e.message)) console.error('انتهى الرصيد اليومي أو الدقيقي لـ Twelve Data. أعد نفس الأمر لاحقاً (أو غداً) وسيكمل من حيث توقف.');
      process.exit(1);
    });
