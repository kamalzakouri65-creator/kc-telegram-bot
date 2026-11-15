// npm run fetch-oos   ذهب H1 من Twelve Data من 2019-06 حتى 2024-10 (حوالي 10 طلبات، طلب كل 15 ثانية، يكمل من حيث توقف)
// npm run audit       تقرير التدقيق: Out-of-Sample حقيقي + فحص الاتساق على بيانات سبوت حديثة + أثر نافذة EMA200
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const data = require('./data');
const { run, metrics } = require('./engine');
// القواعد من البوت كما هي (قراءة فقط)
const { analyze } = require('../../gold-forex-signals-bot/src/strategy');
const { analyzePullback } = require('../../gold-forex-signals-bot/src/pullback');

const STRATS = { 'EMA + MACD': analyze, Pullback: analyzePullback };
const fmt = (x, d = 1) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
const pf = (m) => (m.n === 0 ? '—' : Number.isFinite(m.pf) ? m.pf.toFixed(2) : '∞');
const row = (label, m) => `${label}: ${m.n} صفقة | ربح ${m.winRate.toFixed(0)}% | PF ${pf(m)} | ${fmt(m.net)}R | تراجع ${m.maxDd.toFixed(1)}R | Exp ${fmt(m.exp, 3)}R | أطول خسائر ${m.worst}`;

const real = { spread: config.costs.spread, slippage: config.costs.slippage, swapPctPerNight: config.costs.swapPctPerNight };
const VARIANTS = {
  'كما في الاختبار السابق (نافذة 500، سبريد 0.35، بدون انزلاق ولا Swap)': { window: config.windows.backtest, spread: config.legacy.spread },
  'واقعي (نافذة 500، سبريد 0.24 + انزلاق 0.10 + Swap)': { window: config.windows.backtest, ...real },
  'مثل البوت الحي (نافذة 300) + تكاليف واقعية': { window: config.windows.live, ...real },
  'ضعف السبريد + انزلاق + Swap (نافذة 500)': { window: config.windows.backtest, ...real, spread: real.spread * 2 },
};
const REAL_KEY = Object.keys(VARIANTS)[1];

function setsFor(h1) {
  return { '1h': h1, '4h': data.group(h1, 4) };
}

function section(title, frames, range) {
  const lines = [`━━ ${title}`];
  const results = {};
  for (const [variant, opts] of Object.entries(VARIANTS)) {
    lines.push(`• ${variant}`);
    const all = [];
    for (const [tf, bars] of Object.entries(frames)) {
      for (const [name, fn] of Object.entries(STRATS)) {
        const trades = run(bars, fn, { ...opts, ...range });
        all.push(...trades);
        const m = metrics(trades);
        results[`${variant}|${tf} ${name}`] = { m, trades };
        lines.push(`   ${row(`${tf} ${name}`, m)}`);
      }
    }
    all.sort((a, b) => (a.closedAt < b.closedAt ? -1 : 1));
    results[`${variant}|الكل`] = { m: metrics(all), trades: all };
    lines.push(`   ${row('المجموع', metrics(all))}`);
  }
  return { lines, results };
}

function signalDiff(bars, fn) {
  const times = (w) => {
    const s = new Set();
    for (let i = 210; i < bars.length; i++) {
      const sig = fn(bars.slice(Math.max(0, i + 1 - w), i + 1));
      if (sig) s.add(`${sig.time}|${sig.side}`);
    }
    return s;
  };
  const a = times(config.windows.backtest);
  const b = times(config.windows.live);
  const both = [...a].filter((x) => b.has(x)).length;
  return { backtest: a.size, live: b.size, both };
}

async function fetchOos() {
  console.log(`تحميل ذهب H1 من ${config.oos.warmupFrom} حتى ${config.oos.to} (طلب كل ${config.twelveData.pauseMs / 1000} ثانية حتى لا يتأثر البوت)...`);
  const { candles, reason } = await data.fetchOosH1({ onPage: (n, oldest) => console.log(`  ${n} شمعة، الأقدم: ${oldest}`) });
  console.log(`\nانتهى (${reason}): ${candles.length} شمعة من ${candles[0]?.time} إلى ${candles.at(-1)?.time}`);
  console.log('الخطوة التالية: npm run audit');
}

function audit() {
  const lines = ['KC TREND AUDIT — استراتيجية الترند H1/H4 على الذهب (القواعد من البوت كما هي، بدون أي تعديل)', ''];
  // 1) Out-of-Sample حقيقي
  const rawOos = data.load('xau-h1-oos');
  let verdict = null;
  if (!rawOos?.length) lines.push('⚠️ لا توجد بيانات Out-of-Sample. شغّل أولاً: npm run fetch-oos', '');
  else {
    const h1 = data.cleanH1(rawOos);
    lines.push(`بيانات Out-of-Sample: ذهب سبوت H1 (Twelve Data) ${h1[0].time} → ${h1.at(-1).time} | ${h1.length} شمعة بعد حذف أوقات الإغلاق (${rawOos.length - h1.length} شمعة محذوفة)`);
    lines.push(`الصفقات تُحسب من ${config.oos.from} فقط (ما قبله لتسخين المؤشرات).`, '');
    const { lines: l, results } = section(`Out-of-Sample حقيقي (${config.oos.from} → ${config.oos.to})`, setsFor(h1), { from: config.oos.from, to: `${config.oos.to} 23:59:59` });
    lines.push(...l, '');
    // كل سنة بالتكاليف الواقعية
    const all = results[`${REAL_KEY}|الكل`].trades;
    const years = [...new Set(all.map((t) => t.year))].sort();
    lines.push('━━ كل سنة (المجموع، تكاليف واقعية)');
    for (const y of years) lines.push(`   ${row(y, metrics(all.filter((t) => t.year === y)))}`);
    lines.push('');
    // الحكم المسجل مسبقاً
    const reasons = [];
    for (const tf of ['1h', '4h'])
      for (const name of Object.keys(STRATS)) {
        const m = results[`${REAL_KEY}|${tf} ${name}`].m;
        if (!(m.pf >= config.criteria.minProfitFactor && m.net > 0)) reasons.push(`${tf} ${name}: PF ${pf(m)}، ${fmt(m.net)}R`);
      }
    const tot = metrics(all);
    const posYears = years.filter((y) => metrics(all.filter((t) => t.year === y)).net > 0).length;
    const totalOk = tot.pf >= config.criteria.minProfitFactor && tot.net > 0 && posYears >= config.criteria.minPositiveYears;
    verdict = { reasons, totalOk, posYears, years: years.length, tot };
  }
  // 2) فحص الاتساق على بيانات سبوت حديثة (نفس مصدر البوت)
  let rawM1 = null;
  try {
    rawM1 = JSON.parse(fs.readFileSync(config.recentM1File, 'utf8'));
  } catch {
    lines.push('⚠️ لا توجد بيانات M1 الحديثة (kc-gold-scalping-v1/data/xau-m1.json)، فتم تخطي فحص الاتساق.', '');
  }
  let recentH1 = null;
  if (rawM1) {
    recentH1 = data.h1FromM1(rawM1);
    lines.push(`فحص الاتساق (ليس Out-of-Sample: هذه الفترة داخل فترة الاختيار): ذهب سبوت H1 من M1، ${recentH1[0].time} → ${recentH1.at(-1).time} (${recentH1.length} شمعة)`);
    const { lines: l } = section('بيانات سبوت حديثة (نفس مصدر البوت الحي)', setsFor(recentH1), {});
    lines.push(...l, '');
  }
  // 3) أثر نافذة EMA200: كم إشارة تختلف بين 500 شمعة (الاختبار) و 300 (البوت الحي)
  lines.push('━━ أثر نافذة الحساب على الإشارات (نفس البيانات، نفس القواعد)');
  const diffData = recentH1 ?? (rawOos?.length ? data.cleanH1(rawOos) : null);
  if (diffData) {
    for (const [tf, bars] of Object.entries(setsFor(diffData)))
      for (const [name, fn] of Object.entries(STRATS)) {
        const d = signalDiff(bars, fn);
        lines.push(`   ${tf} ${name}: نافذة 500 = ${d.backtest} إشارة | نافذة 300 = ${d.live} | مشتركة ${d.both} (${d.backtest ? ((d.both / d.backtest) * 100).toFixed(0) : 0}%)`);
      }
  }
  lines.push('');
  // الحكم
  if (verdict) {
    lines.push(`━━ الحكم على Out-of-Sample (التكاليف الواقعية، نافذة 500): ${verdict.reasons.length === 0 && verdict.totalOk ? '✅ نجح' : '❌ لم ينجح'}`);
    lines.push(`   المجموع: PF ${pf(verdict.tot)}، ${fmt(verdict.tot.net)}R، سنوات رابحة ${verdict.posYears} من ${verdict.years} ${verdict.totalOk ? '✅' : '❌'}`);
    if (verdict.reasons.length) lines.push('   إعدادات لم تحقق PF ≥ 1.2 وربحاً موجباً:', ...verdict.reasons.map((r) => `     • ${r}`));
    else lines.push('   كل الإعدادات الأربعة حققت PF ≥ 1.2 وربحاً موجباً.');
  }
  lines.push('', '⚠️ Swap تقديري (0.02% من السعر لكل ليلة) وغير مؤكد من الوسيط. الفضة غير مختبرة: لا توجد بيانات سبوت مستقلة لها في الخطة المجانية.');
  lines.push('R = المبلغ الذي تخاطر به في الصفقة. Exp = متوسط النتيجة لكل صفقة.');
  const text = lines.join('\n');
  console.log(text);
  fs.mkdirSync(config.paths.logs, { recursive: true });
  fs.writeFileSync(path.join(config.paths.logs, 'audit-report.txt'), text);
  console.log('\nالتقرير محفوظ في logs/audit-report.txt');
}

const cmd = process.argv[2];
Promise.resolve(cmd === 'fetch-oos' ? fetchOos() : cmd === 'audit' ? audit() : console.log('الأوامر: fetch-oos | audit')).catch((e) => {
  console.error('فشل:', e.message);
  console.error('إذا انقطع التحميل، أعد نفس الأمر وسيكمل من حيث توقف.');
  process.exit(1);
});
