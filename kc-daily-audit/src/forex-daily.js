// C: العملات الرئيسية على اليومي — RSI(2) كما هي في البوت (شراء فقط). الشروط مسجلة قبل أي نتيجة (2026-11-19):
//   الأزواج: EUR/USD GBP/USD USD/JPY USD/CHF AUD/USD USD/CAD NZD/USD (ثابتة). بيانات Yahoo اليومية.
//   التكاليف بالنقاط: سبريد 1.6 (EUR/USD) و 2.5 لغيره، و Swap 0.5 نقطة لكل ليلة. اختبار بضعف السبريد.
//   الفترات: 2004→2010، 2011→2018، 2019→اليوم.
//   النجاح لكل زوج: كل فترة رابحة و 20+ صفقة، PF ≥ 1.2، رابح بضعف السبريد، المتانة 7 من 9، والبيانات سليمة (أقل من 5% بلا مدى).
//   تشغيل مرة واحدة.   npm run forex-daily -- fetch     ثم     npm run forex-daily -- run
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { metrics, flatShare } = require('./engine');
const { sma, rsiWilder, nights } = require('../../kc-nasdaq-daily/src/engine');
const { config: ndxConfig } = require('../../kc-nasdaq-daily/src/config');
const yahoo = require('../../kc-nasdaq-daily/src/data');

const SPEC = {
  pairs: [
    { name: 'EUR/USD', ticker: 'EURUSD=X', pip: 0.0001, spreadPips: 1.6 },
    { name: 'GBP/USD', ticker: 'GBPUSD=X', pip: 0.0001, spreadPips: 2.5 },
    { name: 'USD/JPY', ticker: 'USDJPY=X', pip: 0.01, spreadPips: 2.5 },
    { name: 'USD/CHF', ticker: 'USDCHF=X', pip: 0.0001, spreadPips: 2.5 },
    { name: 'AUD/USD', ticker: 'AUDUSD=X', pip: 0.0001, spreadPips: 2.5 },
    { name: 'USD/CAD', ticker: 'USDCAD=X', pip: 0.0001, spreadPips: 2.5 },
    { name: 'NZD/USD', ticker: 'NZDUSD=X', pip: 0.0001, spreadPips: 2.5 },
  ],
  dataFrom: '2003-06-01',
  periods: [['الفترة 1', '2004-01-01'], ['الفترة 2', '2011-01-01'], ['الفترة 3', '2019-01-01']],
  swapPipsPerNight: 0.5,
  minPf: 1.2,
  minTrades: 20,
  grid: { entry: [5, 10, 15], exit: [3, 5, 10], minPositive: 7 },
  maxFlat: 0.05,
};

const file = (n) => path.join(config.paths.data, `forex-${n.replace(/\W/g, '')}.json`);
const save = (n, v) => (fs.mkdirSync(config.paths.data, { recursive: true }), fs.writeFileSync(file(n), JSON.stringify(v)));
const load = (n) => {
  try {
    return JSON.parse(fs.readFileSync(file(n), 'utf8'));
  } catch {
    return null;
  }
};

function atrWilder(c, n = 14) {
  const out = new Array(c.length).fill(null);
  let v = null;
  for (let i = 1; i < c.length; i++) {
    const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    v = i <= n ? (v ?? 0) + tr / n : (v * (n - 1) + tr) / n;
    if (i >= n) out[i] = v;
  }
  return out;
}

// RSI(2) بنفس منطق kc-nasdaq-daily، والتكاليف بالنقاط
function fxRun(c, pair, { from = '0000', spreadPips = pair.spreadPips, p = ndxConfig.rsi2 } = {}) {
  const closes = c.map((x) => x.close);
  const trend = sma(closes, p.smaTrend);
  const exitMa = sma(closes, p.smaExit);
  const r2 = rsiWilder(closes, p.rsiPeriod);
  const a = atrWilder(c);
  const out = [];
  let open = null;
  for (let i = 0; i < c.length; i++) {
    const x = c[i];
    if (open) {
      open.bars++;
      let exit = null;
      if (x.low <= open.stop) exit = Math.min(open.stop, x.open);
      else if (x.close > exitMa[i] || open.bars >= p.maxBars) exit = x.close;
      if (exit !== null) {
        const costPips = spreadPips + SPEC.swapPipsPerNight * nights(open.time, x.time);
        out.push({ time: open.time, closedAt: x.time, r: (exit - open.entry - costPips * pair.pip) / open.risk });
        open = null;
      }
      continue;
    }
    if (x.time < from || trend[i] === null || a[i] === null || r2[i] === null) continue;
    if (x.close > trend[i] && r2[i] < p.entryBelow) {
      const risk = p.stopAtr * a[i];
      if (risk > 0) open = { time: x.time, entry: x.close, stop: x.close - risk, risk, bars: 0 };
    }
  }
  return out;
}

function judge(c, pair) {
  const from = SPEC.periods[0][1];
  const base = fxRun(c, pair, { from });
  const m = metrics(base);
  const md = metrics(fxRun(c, pair, { from, spreadPips: pair.spreadPips * 2 }));
  const reasons = [];
  let noVerdict = false;
  const periods = SPEC.periods.map(([name, a], k) => {
    const b = SPEC.periods[k + 1]?.[1] ?? '9999';
    const bars = c.filter((x) => x.time >= a && x.time < b);
    const flat = flatShare(bars);
    const pm = metrics(base.filter((t) => t.time >= a && t.time < b));
    if (flat > SPEC.maxFlat) {
      noVerdict = true;
      reasons.push(`${name}: البيانات غير موثوقة (${(flat * 100).toFixed(1)}% بلا مدى)`);
    }
    if (!(pm.net > 0)) reasons.push(`${name}: الصافي غير موجب`);
    if (pm.n < SPEC.minTrades) reasons.push(`${name}: ${pm.n} صفقة فقط`);
    return { name, a, flat, m: pm };
  });
  if (!(m.pf >= SPEC.minPf)) reasons.push(`PF الكلي أقل من ${SPEC.minPf}`);
  if (!(md.net > 0)) reasons.push('بضعف السبريد: الصافي غير موجب');
  let positive = 0;
  for (const e of SPEC.grid.entry)
    for (const x of SPEC.grid.exit) if (metrics(fxRun(c, pair, { from, p: { ...ndxConfig.rsi2, entryBelow: e, smaExit: x } })).net > 0) positive++;
  if (positive < SPEC.grid.minPositive) reasons.push(`المتانة: ${positive} من 9 فقط`);
  return { m, md, periods, positive, reasons, verdict: noVerdict ? 'لا حكم' : reasons.length ? 'فشل' : 'نجح' };
}

async function fetchAll() {
  for (const pr of SPEC.pairs) {
    try {
      const c = await yahoo.fetchDaily(pr.ticker, SPEC.dataFrom);
      save(pr.ticker, c);
      console.log(`${pr.name}: ${c.length} يوم من ${c[0]?.time} إلى ${c.at(-1)?.time}`);
    } catch (e) {
      console.log(`⚠️ ${pr.name}: ${e.message}`);
    }
  }
  console.log('\nالخطوة التالية: npm run forex-daily -- run');
}

const sgn = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
const pf = (m) => (m.n === 0 ? '—' : Number.isFinite(m.pf) ? m.pf.toFixed(2) : '∞');
const row = (label, m) => `${label}: ${m.n} صفقة | ربح ${m.winRate.toFixed(0)}% | PF ${pf(m)} | ${sgn(m.net)}R | تراجع ${m.maxDd.toFixed(1)}R`;

function run() {
  const missing = SPEC.pairs.filter((p) => !load(p.ticker)?.length);
  if (missing.length) return console.log(`⚠️ لا توجد بيانات ${missing.map((p) => p.name).join('، ')}. شغّل أولاً: npm run forex-daily -- fetch`);
  const done = load('done');
  const L = ['KC FOREX DAILY — RSI(2) كما هي (شراء فقط) على 7 أزواج رئيسية (تشغيل مرة واحدة)'];
  if (done) L.push(`⚠️ شُغّل من قبل (${done.at}). النتيجة الأولى هي المعتمدة؛ هذه إعادة عرض.`);
  L.push(`التكاليف: سبريد 1.6 نقطة (EUR/USD) و 2.5 لغيره + Swap ${SPEC.swapPipsPerNight} نقطة لكل ليلة.`, '');
  const summary = [];
  for (const pr of SPEC.pairs) {
    const j = judge(load(pr.ticker), pr);
    L.push(`• ${pr.name}`, `   ${row('الكل', j.m)}`, `   ${row('بضعف السبريد', j.md)}`);
    for (const p of j.periods) L.push(`   ${row(`${p.name} (من ${p.a})`, p.m)} | بلا مدى ${(p.flat * 100).toFixed(1)}%`);
    L.push(`   المتانة: ${j.positive} من 9`, '');
    summary.push(`• ${pr.name}: ${j.verdict === 'نجح' ? '✅ نجح' : j.verdict === 'فشل' ? '❌' : '⚠️ لا حكم'}${j.reasons.length ? ` — ${j.reasons.join('؛ ')}` : ''}`);
  }
  L.push('━━ الأحكام', ...summary, '', 'R = المبلغ الذي تخاطر به. اختبار تاريخي فقط، لا تداول.');
  const text = L.join('\n');
  console.log(text);
  if (!done) {
    save('done', { at: new Date().toISOString() });
    fs.mkdirSync(config.paths.logs, { recursive: true });
    fs.writeFileSync(path.join(config.paths.logs, 'forex-daily-report.txt'), text);
    console.log('\nالتقرير المعتمد محفوظ في logs/forex-daily-report.txt');
  }
}

if (require.main === module) {
  const cmd = process.argv[2];
  Promise.resolve(cmd === 'fetch' ? fetchAll() : cmd === 'run' ? run() : console.log('الأوامر: fetch | run')).catch((e) => {
    console.error('فشل:', e.message);
    process.exit(1);
  });
}

module.exports = { SPEC, fxRun, judge };
