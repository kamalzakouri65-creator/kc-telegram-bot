// npm run fetch      EUR/USD ساعة من Twelve Data (طلب كل 15 ثانية، يكمل من حيث توقف)
// npm run run-test   التقرير — تشغيل مرة واحدة، النتيجة الأولى هي المعتمدة
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const data = require('./data');
const { trades } = require('./strategy');

function metrics(list) {
  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const t of list) {
    eq += t.r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  const wins = list.filter((t) => t.r > 0);
  const gw = wins.reduce((s, t) => s + t.r, 0);
  const gl = -list.filter((t) => t.r < 0).reduce((s, t) => s + t.r, 0);
  return { n: list.length, winRate: list.length ? (wins.length / list.length) * 100 : 0, pf: gl ? gw / gl : list.length && gw > 0 ? Infinity : 0, net: eq, maxDd: dd };
}

// الفترات المسجلة، أو 3 فترات متساوية إذا بدأت البيانات بعد 2010-03-01
function periodsFor(c) {
  if (c[0].time.slice(0, 10) <= config.fallbackIfStartAfter) return { periods: config.periods, fallback: false };
  const start = c[Math.min(200, c.length - 1)].ms;
  const end = c.at(-1).ms;
  const cut = (k) => new Date(start + ((end - start) * k) / 3).toISOString().slice(0, 19).replace('T', ' ');
  return { periods: [['الثلث 1', cut(0), cut(1)], ['الثلث 2', cut(1), cut(2)], ['الثلث 3', cut(2), '9999']], fallback: true };
}

function judge(c) {
  const { periods, fallback } = periodsFor(c);
  const from = periods[0][1];
  const all = trades(c, { from });
  const m = metrics(all);
  const md = metrics(trades(c, { from, spreadPips: config.costs.spreadPips * 2 }));
  const reasons = [];
  // كل فترة من بدايتها حتى بداية الفترة التالية (حتى لا يضيع آخر يوم)
  const per = periods.map(([name, a], k) => {
    const b = periods[k + 1]?.[1] ?? '9999';
    const pm = metrics(all.filter((t) => t.time >= a && t.time < b));
    if (!(pm.net > 0)) reasons.push(`${name}: الصافي غير موجب`);
    if (pm.n < config.criteria.minTradesPerPeriod) reasons.push(`${name}: ${pm.n} صفقة فقط (المطلوب ${config.criteria.minTradesPerPeriod})`);
    return { name, a, b, m: pm };
  });
  if (!(m.pf >= config.criteria.minProfitFactor)) reasons.push(`PF الكلي أقل من ${config.criteria.minProfitFactor}`);
  if (!(md.net > 0)) reasons.push('بضعف السبريد: الصافي غير موجب');
  const grid = [];
  for (const pivot of config.grid.pivot) for (const rr of config.grid.rr) grid.push({ pivot, rr, m: metrics(trades(c, { from, pivot, rr })) });
  const positive = grid.filter((g) => g.m.net > 0).length;
  if (positive < config.grid.minPositive) reasons.push(`المتانة: ${positive} من 9 رابحة فقط (المطلوب ${config.grid.minPositive})`);
  return { all, m, md, per, grid, positive, fallback, reasons, pass: reasons.length === 0 };
}

async function fetchAll() {
  console.log(`تحميل ${config.symbol} ساعة من Twelve Data (طلب كل ${config.twelveData.pauseMs / 1000} ثانية)...`);
  const { candles, reason } = await data.fetchH1({ onPage: (n, oldest) => console.log(`  ${n} شمعة، الأقدم: ${oldest}`) });
  console.log(`\nانتهى (${reason}): ${candles.length} شمعة من ${candles[0]?.time} إلى ${candles.at(-1)?.time}`);
  console.log('الخطوة التالية: npm run run-test');
}

const sgn = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
const pf = (m) => (m.n === 0 ? '—' : Number.isFinite(m.pf) ? m.pf.toFixed(2) : '∞');
const row = (label, m) => `${label}: ${m.n} صفقة | ربح ${m.winRate.toFixed(0)}% | PF ${pf(m)} | ${sgn(m.net)}R | تراجع ${m.maxDd.toFixed(1)}R`;

function run() {
  const raw = data.load('eurusd-h1');
  if (!raw?.length) return console.log('⚠️ لا توجد بيانات. شغّل أولاً: npm run fetch');
  const c = data.clean(raw);
  const done = data.load('done');
  const j = judge(c);
  const L = [`KC FOREX BOS — كسر الهيكل على ${config.symbol} ساعة، هدف ${config.rule.rr}R (تشغيل مرة واحدة)`];
  if (done) L.push(`⚠️ شُغّل من قبل (${done.at}). النتيجة الأولى هي المعتمدة؛ هذه إعادة عرض.`);
  L.push(`البيانات: ${c[0].time} → ${c.at(-1).time} | ${c.length} شمعة بعد حذف أوقات الإغلاق (${raw.length - c.length} محذوفة)`);
  if (j.fallback) L.push('⚠️ البيانات تبدأ بعد 2010، فقُسمت إلى 3 فترات متساوية زمنياً (كما سُجّل مسبقاً).');
  L.push(`التكاليف: سبريد ${config.costs.spreadPips} + انزلاق ${config.costs.slippagePips} + Swap ${config.costs.swapPipsPerNight} نقطة لكل ليلة. أقل وقف ${config.rule.minStopPips} نقاط.`, '');
  L.push(row('الكل', j.m), row('بضعف السبريد', j.md));
  L.push(`   شراء: ${row('', metrics(j.all.filter((t) => t.dir === 1))).slice(2)}`, `   بيع: ${row('', metrics(j.all.filter((t) => t.dir === -1))).slice(2)}`);
  for (const p of j.per) L.push(row(`${p.name} (من ${p.a.slice(0, 10)})`, p.m));
  L.push('', `المتانة: ${j.positive} من 9 رابحة`);
  for (const pv of config.grid.pivot) L.push(`   قمم بـ ${pv} شموع: ${j.grid.filter((g) => g.pivot === pv).map((g) => `هدف ${g.rr}R PF ${pf(g.m)} ${sgn(g.m.net)}R (${g.m.n})`).join(' | ')}`);
  L.push('', `━━ الحكم: ${j.pass ? '✅ نجح' : '❌ لم ينجح'}`, ...j.reasons.map((r) => `   - ${r}`));
  L.push('', 'R = المبلغ الذي تخاطر به في الصفقة. اختبار تاريخي فقط، لا تداول.');
  const text = L.join('\n');
  console.log(text);
  if (!done) {
    data.save('done', { at: new Date().toISOString(), pass: j.pass });
    fs.mkdirSync(config.paths.logs, { recursive: true });
    fs.writeFileSync(path.join(config.paths.logs, 'report.txt'), text);
    console.log('\nالتقرير المعتمد محفوظ في logs/report.txt');
  }
}

if (require.main === module) {
  const cmd = process.argv[2];
  Promise.resolve(cmd === 'fetch' ? fetchAll() : cmd === 'run' ? run() : console.log('الأوامر: fetch | run')).catch((e) => {
    console.error('فشل:', e.message);
    console.error('إذا انقطع التحميل، أعد نفس الأمر وسيكمل من حيث توقف.');
    process.exit(1);
  });
}

module.exports = { judge, metrics, periodsFor };
