// B: الكريبتو — EMA+MACD يومي شراء فقط (قاعدة البوت كما هي) على 10 عملات جديدة. الشروط مسجلة قبل أي نتيجة (2026-11-19):
//   العملات: أكبر العملات في يناير 2021 بعد استبعاد BTC و ETH و SOL و BNB والعملات المستقرة (اختيار موضوعي، لا الناجحة اليوم).
//   التكاليف: رسوم 0.1% + انزلاق 0.05% لكل جهة (مثل kc-crypto-daily)، واختبار بضعف التكاليف.
//   الفترات: بيانات كل عملة (بعد 210 يوماً للتسخين) تُقسم إلى 3 أثلاث زمنية.
//   النجاح للمجموعة: 7+ عملات من 10 رابحة، PF ≥ 1.2، كل ثلث رابح للمجموعة، 60+ صفقة، ورابح بضعف التكاليف. تشغيل مرة واحدة.
//   npm run crypto-more -- fetch     ثم     npm run crypto-more -- run
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { metrics } = require('./engine');
const { runLongOnly } = require('../../kc-crypto-daily/src/engine');
const { config: cryptoConfig } = require('../../kc-crypto-daily/src/config');
const binance = require('../../kc-crypto-daily/src/data');
const { analyze } = require('../../gold-forex-signals-bot/src/strategy');

const SPEC = {
  pairs: ['XRPUSDT', 'ADAUSDT', 'DOTUSDT', 'LTCUSDT', 'LINKUSDT', 'BCHUSDT', 'XLMUSDT', 'DOGEUSDT', 'UNIUSDT', 'TRXUSDT'],
  dataFrom: '2017-08-17',
  warmupBars: 210,
  costPct: 2 * (cryptoConfig.costs.feePct + cryptoConfig.costs.slippagePct),
  criteria: { minPositivePairs: 7, minPf: 1.2, minTrades: 60 },
};

const file = (n) => path.join(config.paths.data, `crypto-more-${n}.json`);
const save = (n, v) => (fs.mkdirSync(config.paths.data, { recursive: true }), fs.writeFileSync(file(n), JSON.stringify(v)));
const load = (n) => {
  try {
    return JSON.parse(fs.readFileSync(file(n), 'utf8'));
  } catch {
    return null;
  }
};

// حدود الأثلاث الزمنية لعملة واحدة (بعد التسخين)
function thirds(candles) {
  const start = Date.parse(candles[Math.min(SPEC.warmupBars, candles.length - 1)].time.slice(0, 10));
  const end = Date.parse(candles.at(-1).time.slice(0, 10));
  return [0, 1, 2, 3].map((k) => new Date(start + ((end - start) * k) / 3).toISOString().slice(0, 10));
}

function judge(byPair) {
  const all = [];
  const double = [];
  const perThird = [[], [], []];
  const rows = [];
  for (const [pair, candles] of Object.entries(byPair)) {
    const b = thirds(candles);
    const t = runLongOnly(candles, analyze, { from: `${b[0]} 00:00:00` });
    const d = runLongOnly(candles, analyze, { from: `${b[0]} 00:00:00`, costPct: SPEC.costPct * 2 });
    for (const x of t) {
      const k = x.time < `${b[1]}` ? 0 : x.time < `${b[2]}` ? 1 : 2;
      perThird[k].push(x);
    }
    all.push(...t);
    double.push(...d);
    rows.push({ pair, from: b[0], m: metrics(t) });
  }
  const sort = (l) => l.sort((a, c) => (a.closedAt < c.closedAt ? -1 : 1));
  const m = metrics(sort(all));
  const md = metrics(sort(double));
  const thirdsM = perThird.map((l) => metrics(sort(l)));
  const positive = rows.filter((r) => r.m.net > 0).length;
  const C = SPEC.criteria;
  const reasons = [];
  if (positive < C.minPositivePairs) reasons.push(`رابحة على ${positive} عملات فقط (المطلوب ${C.minPositivePairs})`);
  if (!(m.pf >= C.minPf)) reasons.push(`PF المجموعة أقل من ${C.minPf}`);
  thirdsM.forEach((x, k) => {
    if (!(x.net > 0)) reasons.push(`الثلث ${k + 1}: الصافي غير موجب`);
  });
  if (m.n < C.minTrades) reasons.push(`${m.n} صفقة فقط (المطلوب ${C.minTrades})`);
  if (!(md.net > 0)) reasons.push('بضعف التكاليف: الصافي غير موجب');
  return { rows, m, md, thirdsM, positive, reasons, pass: reasons.length === 0 };
}

async function fetchAll() {
  for (const p of SPEC.pairs) {
    try {
      const c = await binance.fetchDaily(p, Date.parse(`${SPEC.dataFrom}T00:00:00Z`));
      save(p, c);
      console.log(`${p}: ${c.length} يوم من ${c[0]?.time.slice(0, 10)} إلى ${c.at(-1)?.time.slice(0, 10)}`);
    } catch (e) {
      console.log(`⚠️ ${p}: ${e.message}`);
    }
  }
  console.log('\nالخطوة التالية: npm run crypto-more -- run');
}

const sgn = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
const pf = (m) => (m.n === 0 ? '—' : Number.isFinite(m.pf) ? m.pf.toFixed(2) : '∞');
const row = (label, m) => `${label}: ${m.n} صفقة | ربح ${m.winRate.toFixed(0)}% | PF ${pf(m)} | ${sgn(m.net)}R | تراجع ${m.maxDd.toFixed(1)}R`;

function run() {
  const byPair = {};
  const missing = [];
  for (const p of SPEC.pairs) {
    const c = load(p);
    if (c?.length > SPEC.warmupBars + 30) byPair[p] = c;
    else missing.push(p);
  }
  if (missing.length) return console.log(`⚠️ لا توجد بيانات كافية: ${missing.join('، ')}. شغّل أولاً: npm run crypto-more -- fetch (ولا تشغّل الاختبار قبل اكتمالها)`);
  const done = load('done');
  const j = judge(byPair);
  const L = ['KC CRYPTO MORE — EMA+MACD يومي شراء فقط على 10 عملات جديدة (تشغيل مرة واحدة)'];
  if (done) L.push(`⚠️ شُغّل من قبل (${done.at}). النتيجة الأولى هي المعتمدة؛ هذه إعادة عرض.`);
  L.push(`التكاليف: ${SPEC.costPct.toFixed(2)}% لكل صفقة (رسوم + انزلاق على الجهتين).`, '');
  for (const r of j.rows) L.push(row(`${r.pair.replace('USDT', '')} (من ${r.from})`, r.m));
  L.push('', row('المجموعة', j.m), row('بضعف التكاليف', j.md), ...j.thirdsM.map((x, k) => row(`الثلث ${k + 1}`, x)));
  L.push('', `━━ الحكم: ${j.pass ? '✅ نجح' : '❌ لم ينجح'} (عملات رابحة ${j.positive} من 10)`, ...j.reasons.map((x) => `   - ${x}`));
  L.push('', 'R = المبلغ الذي تخاطر به في الصفقة. اختبار تاريخي فقط، لا تداول.');
  const text = L.join('\n');
  console.log(text);
  if (!done) {
    save('done', { at: new Date().toISOString(), pass: j.pass });
    fs.mkdirSync(config.paths.logs, { recursive: true });
    fs.writeFileSync(path.join(config.paths.logs, 'crypto-more-report.txt'), text);
    console.log('\nالتقرير المعتمد محفوظ في logs/crypto-more-report.txt');
  }
}

if (require.main === module) {
  const cmd = process.argv[2];
  Promise.resolve(cmd === 'fetch' ? fetchAll() : cmd === 'run' ? run() : console.log('الأوامر: fetch | run')).catch((e) => {
    console.error('فشل:', e.message);
    process.exit(1);
  });
}

module.exports = { SPEC, judge, thirds };
