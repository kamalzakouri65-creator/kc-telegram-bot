// npm run fetch     ذهب 15 دقيقة من Twelve Data (طلب كل 15 ثانية، يكمل من حيث توقف)
// npm run dev       قسم التطوير (حتى 2023-12-31) — النتيجة الأولى هي المعتمدة
// npm run confirm   قسم التأكيد (2024 → اليوم) — مرة واحدة فقط، وفقط إذا نجح التطوير
const { config } = require('./config');
const data = require('./data');
const { signals } = require('./strategy');
const { simulate, metrics } = require('./backtest');
const report = require('./report');

function judge(bars, inSection) {
  const run = (rule, opts) => simulate(bars, signals(bars, rule), opts).filter((t) => inSection(t.day));
  const trades = run(config.rule);
  const m = metrics(trades);
  const md = metrics(run(config.rule, { spreadMult: 2 }));
  const years = [...new Set(trades.map((t) => t.year))].sort().map((year) => ({ year, m: metrics(trades.filter((t) => t.year === year)) }));
  const grid = [];
  for (const rr of config.grid.rr) for (const stopFrac of config.grid.stopFrac) grid.push({ rr, stopFrac, m: metrics(run({ ...config.rule, rr, stopFrac })) });
  const positive = grid.filter((g) => g.m.net > 0).length;
  const how = {};
  for (const t of trades) how[t.how] = (how[t.how] ?? 0) + 1;
  const C = config.criteria;
  const reasons = [];
  if (!(m.pf >= C.minPf)) reasons.push(`PF ${Number.isFinite(m.pf) ? m.pf.toFixed(2) : '∞'} أقل من ${C.minPf}`);
  for (const y of years) if (!(y.m.net > 0)) reasons.push(`سنة ${y.year}: الصافي غير موجب`);
  if (!(md.net > 0)) reasons.push('بضعف السبريد: الصافي غير موجب');
  if (positive < C.minPositive) reasons.push(`المتانة: ${positive} من 9 فقط (المطلوب ${C.minPositive})`);
  if (m.n < C.minTrades) reasons.push(`${m.n} صفقة فقط (المطلوب ${C.minTrades})`);
  return { m, md, buy: metrics(trades.filter((t) => t.dir === 1)), sell: metrics(trades.filter((t) => t.dir === -1)), years, grid, positive, how, reasons, pass: reasons.length === 0 };
}

async function fetchAll() {
  console.log(`تحميل ذهب 15 دقيقة من Twelve Data (طلب كل ${config.twelveData.pauseMs / 1000} ثانية حتى لا يتأثر البوت)...`);
  const { candles, reason } = await data.fetchM15({ onPage: (n, oldest) => console.log(`  ${n} شمعة، الأقدم: ${oldest}`) });
  console.log(`\nانتهى (${reason}): ${candles.length} شمعة من ${candles[0]?.time} إلى ${candles.at(-1)?.time}`);
  console.log('الخطوة التالية: npm run dev');
}

function section(kind) {
  const raw = data.load('xau-m15');
  if (!raw?.length) return console.log('⚠️ لا توجد بيانات. شغّل أولاً: npm run fetch');
  const bars = data.clean(raw);
  const dev = kind === 'dev';
  if (!dev) {
    const d = data.load('dev-done');
    if (!d) return console.log('⚠️ شغّل التطوير أولاً: npm run dev');
    if (!d.pass) return console.log('⛔ التطوير لم ينجح، فلا تأكيد لهذه الفكرة (حسب البرنامج المسجل).');
  }
  const marker = dev ? 'dev-done' : 'confirm-done';
  const done = data.load(marker);
  const j = judge(bars, dev ? (d) => d <= config.split.devTo : (d) => d >= config.split.confirmFrom);
  const info = `البيانات: ${bars[0].time} → ${bars.at(-1).time} (${bars.length} شمعة بعد حذف أوقات الإغلاق)${done ? `\n⚠️ شُغّل من قبل (${done.at}). النتيجة الأولى هي المعتمدة؛ هذه إعادة عرض.` : ''}`;
  const text = report.write(dev ? 'التطوير' : 'التأكيد', j, info);
  console.log(text);
  if (!done) data.save(marker, { at: new Date().toISOString(), pass: j.pass });
  console.log(`\nالتقارير في مجلد reports/ (${dev ? 'dev' : 'confirm'}-report.txt و CSV و HTML)`);
}

if (require.main === module) {
  const cmd = process.argv[2];
  Promise.resolve(cmd === 'fetch' ? fetchAll() : cmd === 'dev' || cmd === 'confirm' ? section(cmd) : console.log('الأوامر: fetch | dev | confirm')).catch((e) => {
    console.error('فشل:', e.message);
    console.error('إذا انقطع التحميل، أعد نفس الأمر وسيكمل من حيث توقف.');
    process.exit(1);
  });
}

module.exports = { judge };
