// اختبار RSI(2) على مؤشرات جديدة — الشروط مسجلة قبل أي نتيجة (2026-11-16) ووافق عليها صاحب المشروع.
// القاعدة كما هي في البوت ومحرك kc-nasdaq-daily بدون أي تعديل. تشغيل مرة واحدة: النتيجة الأولى هي المعتمدة.
//   npm run new-indices -- fetch    تحميل البيانات من Yahoo
//   npm run new-indices -- run      التقرير (مرة واحدة)
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { metrics, flatShare } = require('./engine');
const { runRsi2 } = require('../../kc-nasdaq-daily/src/engine');
const yahoo = require('../../kc-nasdaq-daily/src/data');

const SPEC = {
  markets: [
    { name: 'Dow Jones', ticker: '^DJI', exness: 'US30' },
    { name: 'Russell 2000', ticker: '^RUT', exness: 'US2000' },
    { name: 'DAX', ticker: '^GDAXI', exness: 'GER40' },
    { name: 'FTSE 100', ticker: '^FTSE', exness: 'UK100' },
    { name: 'Nikkei 225', ticker: '^N225', exness: 'JP225' },
  ],
  dataFrom: '1960-01-01',
  periods: [
    { name: 'الفترة 1', from: '0000', to: '2004-12-31' },
    { name: 'الفترة 2', from: '2005-01-01', to: '2020-12-31' },
    { name: 'الفترة 3', from: '2021-01-01', to: '9999' },
  ],
  spreadPct: 0.02, // متحفظ (Swap 0.02% لكل ليلة من kc-nasdaq-daily)
  minProfitFactor: 1.2,
  minTradesPerPeriod: 20,
  maxFlatShare: 0.05,
};

const file = (n) => path.join(config.paths.data, `new-${n.replace(/\W/g, '')}.json`);
const save = (n, v) => (fs.mkdirSync(config.paths.data, { recursive: true }), fs.writeFileSync(file(n), JSON.stringify(v)));
const load = (n) => {
  try {
    return JSON.parse(fs.readFileSync(file(n), 'utf8'));
  } catch {
    return null;
  }
};

function judge(candles) {
  const trades = runRsi2(candles, { from: '0000', spreadPct: SPEC.spreadPct });
  const double = runRsi2(candles, { from: '0000', spreadPct: SPEC.spreadPct * 2 });
  const m = metrics(trades);
  const reasons = [];
  let noVerdict = false;
  const periods = SPEC.periods.map((p) => {
    const bars = candles.filter((c) => c.time >= p.from && c.time <= p.to);
    const t = trades.filter((x) => x.time >= p.from && x.time <= p.to);
    const pm = metrics(t);
    const flat = flatShare(bars);
    if (flat > SPEC.maxFlatShare) {
      noVerdict = true;
      reasons.push(`${p.name}: البيانات غير موثوقة (${(flat * 100).toFixed(1)}% شموع بلا مدى)`);
    }
    if (!(pm.net > 0)) reasons.push(`${p.name}: الصافي غير موجب`);
    if (pm.n < SPEC.minTradesPerPeriod) reasons.push(`${p.name}: ${pm.n} صفقة فقط (المطلوب ${SPEC.minTradesPerPeriod})`);
    return { ...p, from: bars[0]?.time, to: bars.at(-1)?.time, m: pm, flat };
  });
  if (!(m.pf >= SPEC.minProfitFactor)) reasons.push(`PF الكلي أقل من ${SPEC.minProfitFactor}`);
  const md = metrics(double);
  if (!(md.net > 0)) reasons.push('بضعف السبريد: الصافي غير موجب');
  return { m, md, periods, reasons, verdict: noVerdict ? 'لا حكم' : reasons.length ? 'فشل' : 'نجح' };
}

async function fetchAll() {
  for (const mk of SPEC.markets) {
    const c = await yahoo.fetchDaily(mk.ticker, SPEC.dataFrom);
    save(mk.ticker, c);
    console.log(`${mk.name}: ${c.length} يوم من ${c[0]?.time} إلى ${c.at(-1)?.time}`);
  }
  console.log('\nالخطوة التالية: npm run new-indices -- run');
}

function run() {
  const done = load('done');
  const L = ['KC NEW INDICES — RSI(2) كما هي في البوت على مؤشرات جديدة (تشغيل مرة واحدة)'];
  if (done) L.push(`⚠️ هذا الاختبار شُغّل من قبل (${done.at}). النتيجة الأولى هي المعتمدة؛ هذه إعادة عرض فقط.`);
  L.push(`التكاليف: سبريد ${SPEC.spreadPct}% + Swap 0.02% لكل ليلة. النجاح: كل فترة رابحة و ${SPEC.minTradesPerPeriod}+ صفقة فيها، PF الكلي ≥ ${SPEC.minProfitFactor}، ورابح بضعف السبريد.`, '');
  const pf = (m) => (m.n === 0 ? '—' : Number.isFinite(m.pf) ? m.pf.toFixed(2) : '∞');
  const sgn = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
  const row = (label, m) => `${label}: ${m.n} صفقة | ربح ${m.winRate.toFixed(0)}% | PF ${pf(m)} | ${sgn(m.net)}R | تراجع ${m.maxDd.toFixed(1)}R`;
  const summary = [];
  let missing = false;
  for (const mk of SPEC.markets) {
    const c = load(mk.ticker);
    if (!c?.length) {
      L.push(`⚠️ لا توجد بيانات ${mk.name}. شغّل أولاً: npm run new-indices -- fetch`);
      missing = true;
      continue;
    }
    const j = judge(c);
    L.push(`• ${mk.name} (${mk.exness})`, `   ${row('الكل', j.m)}`, `   ${row('بضعف السبريد', j.md)}`);
    for (const p of j.periods) L.push(`   ${row(`${p.name} ${p.from ?? '—'} → ${p.to ?? '—'}`, p.m)} | بلا مدى ${(p.flat * 100).toFixed(1)}%`);
    L.push('');
    summary.push(`• ${mk.name}: ${j.verdict === 'نجح' ? '✅ نجح' : j.verdict === 'فشل' ? '❌ لم ينجح' : '⚠️ لا حكم'}`, ...j.reasons.map((r) => `   - ${r}`));
  }
  L.push('━━ الأحكام', ...summary, '', 'R = المبلغ الذي تخاطر به في الصفقة. اختبار تاريخي فقط، لا تداول.');
  const text = L.join('\n');
  console.log(text);
  if (!missing && !done) {
    save('done', { at: new Date().toISOString() });
    fs.mkdirSync(config.paths.logs, { recursive: true });
    fs.writeFileSync(path.join(config.paths.logs, 'new-indices-report.txt'), text);
    console.log('\nالتقرير المعتمد محفوظ في logs/new-indices-report.txt');
  }
}

if (require.main === module) {
  const cmd = process.argv[2];
  Promise.resolve(cmd === 'fetch' ? fetchAll() : cmd === 'run' ? run() : console.log('الأوامر: fetch | run')).catch((e) => {
    console.error('فشل:', e.message);
    process.exit(1);
  });
}

module.exports = { SPEC, judge };
