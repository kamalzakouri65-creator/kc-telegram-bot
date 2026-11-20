// npm run fetch     ذهب 15 دقيقة من Twelve Data (طلب كل 15 ثانية، يكمل من حيث توقف)
// npm run dev       قسم التطوير (حتى 2023-12-31) — النتيجة الأولى هي المعتمدة
// npm run confirm   قسم التأكيد (2024 → اليوم) — مرة واحدة فقط، وفقط إذا نجح التطوير
const { config } = require('./config');
const data = require('./data');
const { signals } = require('./strategy');
const { simulate, metrics } = require('./backtest');
const report = require('./report');
const { RULE3, GRID3, idea3Trades } = require('./idea3');
const { RULE4, GRID4, EXNESS_ZERO_COST, toH1, idea4Trades } = require('./idea4');
const { RULE5, GRID5, idea5Trades, idea5Diagnose } = require('./idea5');

function judge(bars, inSection, { fade = false } = {}) {
  const run = (rule, opts) => simulate(bars, signals(bars, rule, { fade }), opts).filter((t) => inSection(t.day));
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

// الفكرة 3: الحكم بنفس الشروط، والتطوير ثم التأكيد مرة واحدة
function judge3(bars, inSection) {
  const run = (rule, opts) => idea3Trades(bars, rule, opts).filter((t) => inSection(t.day));
  const trades = run(RULE3);
  const m = metrics(trades);
  const md = metrics(run(RULE3, { spreadMult: 2 }));
  const years = [...new Set(trades.map((t) => t.year))].sort().map((year) => ({ year, m: metrics(trades.filter((t) => t.year === year)) }));
  const grid = [];
  for (const rr of GRID3.rsiBelow) for (const stopFrac of GRID3.exitSma) grid.push({ rr, stopFrac, m: metrics(run({ ...RULE3, rsiBelow: rr, exitSma: stopFrac })) });
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
  const days = new Set(trades.map((t) => t.day)).size;
  return { m, md, buy: metrics(trades.filter((t) => t.dir === 1)), sell: metrics(trades.filter((t) => t.dir === -1)), years, grid, positive, how, reasons, pass: reasons.length === 0, perDay: days ? trades.length / days : 0 };
}

function idea3(kind) {
  const raw = data.load('xau-m15');
  if (!raw?.length) return console.log('⚠️ لا توجد بيانات. شغّل أولاً: npm run fetch');
  const bars = data.clean(raw);
  const dev = kind === 'dev';
  if (!dev) {
    const d = data.load('idea3-dev-done');
    if (!d) return console.log('⚠️ شغّل التطوير أولاً: npm run idea3');
    if (!d.pass) return console.log('⛔ تطوير الفكرة 3 لم ينجح، فلا تأكيد (حسب البرنامج المسجل).');
  }
  const marker = dev ? 'idea3-dev-done' : 'idea3-confirm-done';
  const done = data.load(marker);
  const j = judge3(bars, dev ? (d) => d <= config.split.devTo : (d) => d >= config.split.confirmFrom);
  const info = `البيانات: ${bars[0].time} → ${bars.at(-1).time} | متوسط الصفقات في يوم التداول: ${j.perDay.toFixed(2)}${done ? `\n⚠️ شُغّل من قبل (${done.at}). النتيجة الأولى هي المعتمدة؛ هذه إعادة عرض.` : ''}`;
  const text = report.write(dev ? 'التطوير' : 'التأكيد', j, info, dev ? 'idea3-dev' : 'idea3-confirm');
  console.log(text);
  if (!done) data.save(marker, { at: new Date().toISOString(), pass: j.pass });
}

// الفكرة 4: فيبوناتشي 61.8% مع شمعة تأكيد على الساعة
function judge4(h1, inSection) {
  const run = (rule, opts) => idea4Trades(h1, rule, opts).filter((t) => inSection(t.day));
  const trades = run(RULE4);
  const m = metrics(trades);
  const md = metrics(run(RULE4, { spreadMult: 2 }));
  const mz = metrics(run(RULE4, { cost: EXNESS_ZERO_COST }));
  const years = [...new Set(trades.map((t) => t.year))].sort().map((year) => ({ year, m: metrics(trades.filter((t) => t.year === year)) }));
  const grid = [];
  for (const rr of GRID4.level) for (const stopFrac of GRID4.pivot) grid.push({ rr, stopFrac, m: metrics(run({ ...RULE4, level: rr, pivot: stopFrac })) });
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
  const avgRr = trades.length ? trades.reduce((s, t) => s + t.rr, 0) / trades.length : 0;
  return { m, md, mz, avgRr, buy: metrics(trades.filter((t) => t.dir === 1)), sell: metrics(trades.filter((t) => t.dir === -1)), years, grid, positive, how, reasons, pass: reasons.length === 0 };
}

function idea4(kind) {
  const raw = data.load('xau-m15');
  if (!raw?.length) return console.log('⚠️ لا توجد بيانات. شغّل أولاً: npm run fetch');
  const h1 = toH1(data.clean(raw));
  const dev = kind === 'dev';
  if (!dev) {
    const d = data.load('idea4-dev-done');
    if (!d) return console.log('⚠️ شغّل التطوير أولاً: npm run idea4');
    if (!d.pass) return console.log('⛔ تطوير الفكرة 4 لم ينجح، فلا تأكيد (حسب البرنامج المسجل).');
  }
  const marker = dev ? 'idea4-dev-done' : 'idea4-confirm-done';
  const done = data.load(marker);
  const j = judge4(h1, dev ? (d) => d <= config.split.devTo : (d) => d >= config.split.confirmFrom);
  const sg = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
  const info = `البيانات: ${h1.length} شمعة ساعة (${h1[0].time} → ${h1.at(-1).time}) | متوسط الهدف ${j.avgRr.toFixed(2)}R\nللمعلومة فقط (ليس شرطاً): بتكلفة Exness Zero (~${EXNESS_ZERO_COST.toFixed(2)}$) = ${j.mz.n} صفقة، PF ${Number.isFinite(j.mz.pf) ? j.mz.pf.toFixed(2) : '∞'}، ${sg(j.mz.net)}R${done ? `\n⚠️ شُغّل من قبل (${done.at}). النتيجة الأولى هي المعتمدة؛ هذه إعادة عرض.` : ''}`;
  const text = report.write(dev ? 'التطوير' : 'التأكيد', j, info, dev ? 'idea4-dev' : 'idea4-confirm');
  console.log(text);
  if (!done) data.save(marker, { at: new Date().toISOString(), pass: j.pass });
}

// الفكرة 5: SMC متعدد الأطر
function judge5(m15, inSection) {
  const run = (rule, opts) => idea5Trades(m15, rule, opts).filter((t) => inSection(t.day));
  const trades = run(RULE5);
  const m = metrics(trades);
  const md = metrics(run(RULE5, { spreadMult: 2 }));
  const mz = metrics(run(RULE5, { cost: EXNESS_ZERO_COST }));
  const years = [...new Set(trades.map((t) => t.year))].sort().map((year) => ({ year, m: metrics(trades.filter((t) => t.year === year)) }));
  const grid = [];
  for (const rr of GRID5.h1Pivot) for (const stopFrac of GRID5.m15Pivot) grid.push({ rr, stopFrac, m: metrics(run({ ...RULE5, h1Pivot: rr, m15Pivot: stopFrac })) });
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
  return { m, md, mz, buy: metrics(trades.filter((t) => t.dir === 1)), sell: metrics(trades.filter((t) => t.dir === -1)), years, grid, positive, how, reasons, pass: reasons.length === 0 };
}

function idea5(kind) {
  const raw = data.load('xau-m15');
  if (!raw?.length) return console.log('⚠️ لا توجد بيانات. شغّل أولاً: npm run fetch');
  const m15 = data.clean(raw);
  const dev = kind === 'dev';
  if (!dev) {
    const d = data.load('idea5-dev-done');
    if (!d) return console.log('⚠️ شغّل التطوير أولاً: npm run idea5');
    if (!d.pass) return console.log('⛔ تطوير الفكرة 5 لم ينجح، فلا تأكيد (حسب البرنامج المسجل).');
  }
  const marker = dev ? 'idea5-dev-done' : 'idea5-confirm-done';
  const done = data.load(marker);
  console.log('⏳ الحساب قد يأخذ دقيقة أو دقيقتين...');
  const j = judge5(m15, dev ? (d) => d <= config.split.devTo : (d) => d >= config.split.confirmFrom);
  const sg = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
  const info = `البيانات: ${m15[0].time} → ${m15.at(-1).time}\nللمعلومة فقط (ليس شرطاً): بتكلفة Exness Zero (~${EXNESS_ZERO_COST.toFixed(2)}$) = ${j.mz.n} صفقة، PF ${Number.isFinite(j.mz.pf) ? j.mz.pf.toFixed(2) : '∞'}، ${sg(j.mz.net)}R${done ? `\n⚠️ شُغّل من قبل (${done.at}). النتيجة الأولى هي المعتمدة؛ هذه إعادة عرض.` : ''}`;
  const text = report.write(dev ? 'التطوير' : 'التأكيد', j, info, dev ? 'idea5-dev' : 'idea5-confirm');
  console.log(text);
  if (!done) data.save(marker, { at: new Date().toISOString(), pass: j.pass });
}

// تشخيص الفكرة 5 على التطوير فقط (2020–2023). لا يلمس بيانات التأكيد أبداً.
function idea5Diag() {
  const raw = data.load('xau-m15');
  if (!raw?.length) return console.log('⚠️ لا توجد بيانات. شغّل أولاً: npm run fetch');
  const m15 = data.clean(raw).filter((b) => b.time.slice(0, 10) <= config.split.devTo);
  const { buyDiag, sellDiag, cands } = idea5Diagnose(m15);
  const L = ['KC GOLD LAB — تشخيص الفكرة 5 (التطوير 2020–2023 فقط، بيانات 2024+ لم تُلمس)', '', '━━ قمع الإشارات (كم بقي بعد كل شرط)'];
  const keys = [...new Set([...Object.keys(buyDiag), ...Object.keys(sellDiag)])].sort();
  for (const k of keys) L.push(`   ${k}: شراء ${buyDiag[k] ?? 0} | بيع ${sellDiag[k] ?? 0}`);
  const n = cands.length;
  const avg = (f, list = cands) => (list.length ? list.reduce((s, x) => s + f(x), 0) / list.length : 0);
  L.push('', `━━ الصفقات المرشحة قبل قاعدة "صفقة واحدة" وقبل التكاليف: ${n}`);
  L.push(`   متوسط أقصى ربح ظاهر (MFE): ${avg((x) => x.mfe).toFixed(2)}R | متوسط أقصى خسارة ظاهرة (MAE): ${avg((x) => x.mae).toFixed(2)}R`);
  for (const lvl of [1, 1.5, 2, 3]) L.push(`   وصلت إلى +${lvl}R في وقت ما: ${cands.filter((x) => x.mfe >= lvl).length} من ${n}`);
  L.push(`   متوسط المدة: ${avg((x) => x.hours).toFixed(1)} ساعة | متوسط عرض المنطقة: ${avg((x) => x.zoneAtr).toFixed(2)} ATR`);
  const gross = (x) => (x.exit - x.entry) / x.risk;
  L.push(`   متوسط النتيجة قبل التكاليف: ${avg(gross) >= 0 ? '+' : ''}${avg(gross).toFixed(3)}R`);
  L.push('', '━━ طريقة الخروج');
  const how = {};
  for (const x of cands) how[x.how] = (how[x.how] ?? 0) + 1;
  for (const [k, v] of Object.entries(how)) {
    const list = cands.filter((x) => x.how === k);
    L.push(`   ${k}: ${v} | متوسط النتيجة ${avg(gross, list).toFixed(2)}R | متوسط MFE ${avg((x) => x.mfe, list).toFixed(2)}R`);
  }
  L.push('', '━━ حسب الاتجاه والسنة (قبل التكاليف)');
  for (const dir of [1, -1]) for (const y of ['2020', '2021', '2022', '2023']) {
    const list = cands.filter((x) => x.dir === dir && x.year === y);
    if (list.length) L.push(`   ${dir === 1 ? 'شراء' : 'بيع'} ${y}: ${list.length} | المجموع ${list.reduce((s, x) => s + gross(x), 0).toFixed(1)}R`);
  }
  L.push('', 'للتشخيص فقط. أي تعديل يُسجَّل كنسخة 2، ويُحكم عليه مرة واحدة على 2024 → اليوم.');
  console.log(L.join('\n'));
}

// الفكرة 2: فخ الكسر الكاذب (عكس الفكرة 1). جاءت من رؤية نتائج تطوير الفكرة 1، فالتطوير للمعلومة فقط،
// والحكم الوحيد على التأكيد (2024 → اليوم)، مرة واحدة.
function idea2() {
  const raw = data.load('xau-m15');
  if (!raw?.length) return console.log('⚠️ لا توجد بيانات. شغّل أولاً: npm run fetch');
  const bars = data.clean(raw);
  const done = data.load('idea2-done');
  const info = `البيانات: ${bars[0].time} → ${bars.at(-1).time}${done ? `\n⚠️ شُغّل من قبل (${done.at}). النتيجة الأولى هي المعتمدة؛ هذه إعادة عرض.` : ''}`;
  const devJ = judge(bars, (d) => d <= config.split.devTo, { fade: true });
  const j = judge(bars, (d) => d >= config.split.confirmFrom, { fade: true });
  const text = report.write('الفكرة 2 — التأكيد', j, `${info}\nللمعلومة فقط (لا يُحكم عليه لأن الفكرة جاءت منه): التطوير 2020–2023 = ${devJ.m.n} صفقة، PF ${Number.isFinite(devJ.m.pf) ? devJ.m.pf.toFixed(2) : '∞'}، ${devJ.m.net >= 0 ? '+' : ''}${devJ.m.net.toFixed(1)}R`, 'idea2');
  console.log(text);
  if (!done) data.save('idea2-done', { at: new Date().toISOString(), pass: j.pass });
  console.log('\nالتقارير في مجلد reports/ (idea2-report.txt و CSV و HTML)');
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
  Promise.resolve(cmd === 'fetch' ? fetchAll() : cmd === 'dev' || cmd === 'confirm' ? section(cmd) : cmd === 'idea2' ? idea2() : cmd === 'idea3' ? idea3('dev') : cmd === 'idea3-confirm' ? idea3('confirm') : cmd === 'idea4' ? idea4('dev') : cmd === 'idea4-confirm' ? idea4('confirm') : cmd === 'idea5' ? idea5('dev') : cmd === 'idea5-confirm' ? idea5('confirm') : cmd === 'idea5-diag' ? idea5Diag() : console.log('الأوامر: fetch | dev | confirm | idea2 | idea3 | idea3-confirm | idea4 | idea4-confirm | idea5 | idea5-confirm')).catch((e) => {
    console.error('فشل:', e.message);
    console.error('إذا انقطع التحميل، أعد نفس الأمر وسيكمل من حيث توقف.');
    process.exit(1);
  });
}

module.exports = { judge };
