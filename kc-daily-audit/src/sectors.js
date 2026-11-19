// قطاعات السوق الأمريكي — RSI(2) كما هي في البوت. الشروط مسجلة قبل أي نتيجة (2026-11-19) ووافق عليها صاحب المشروع:
//   9 صناديق SPDR (منذ 1998): XLK XLF XLE XLV XLY XLP XLI XLB XLU. القائمة ثابتة.
//   التكاليف: سبريد 0.05% + Swap 0.02% لكل ليلة. الفترات: 1999→2010، 2011→2018، 2019→اليوم.
//   النجاح لكل قطاع وحده: كل فترة رابحة و 20+ صفقة، PF ≥ 1.2، رابح بضعف السبريد، المتانة 7 من 9،
//   وشرط إضافي (أُضيف قبل أي نتيجة بعد رؤية أوقات XM: XLK يُتداول فقط وقت السوق الأمريكي):
//   رابح أيضاً عندما يكون الدخول والخروج عند افتتاح اليوم التالي (كما يحدث في الواقع).
//   تشغيل مرة واحدة. أي قطاع ينجح يدخل اختباراً مستقبلياً قبل أي تداول حقيقي.
//   npm run sectors -- fetch     ثم     npm run sectors -- run
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { metrics, flatShare } = require('./engine');
const { sma, rsiWilder, nights } = require('../../kc-nasdaq-daily/src/engine');
const { config: ndxConfig } = require('../../kc-nasdaq-daily/src/config');
const yahoo = require('../../kc-nasdaq-daily/src/data');

const SPEC = {
  tickers: [
    ['XLK', 'التكنولوجيا'], ['XLF', 'البنوك والمال'], ['XLE', 'الطاقة'], ['XLV', 'الصحة'], ['XLY', 'الاستهلاك الكمالي'],
    ['XLP', 'الاستهلاك الأساسي'], ['XLI', 'الصناعة'], ['XLB', 'المواد'], ['XLU', 'المرافق'],
  ],
  dataFrom: '1998-12-01',
  periods: [['الفترة 1', '1999-01-01'], ['الفترة 2', '2011-01-01'], ['الفترة 3', '2019-01-01']],
  spreadPct: 0.05,
  swapPctPerNight: 0.02,
  minPf: 1.2,
  minTrades: 20,
  grid: { entry: [5, 10, 15], exit: [3, 5, 10], minPositive: 7 },
  maxFlat: 0.05,
};

const file = (n) => path.join(config.paths.data, `sectors-${n.replace(/\W/g, '')}.json`);
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

// RSI(2). mode 'close': الدخول والخروج عند الإغلاق (مثل الاختبار الأصلي).
// mode 'nextOpen': الإشارة عند الإغلاق، والدخول عند افتتاح اليوم التالي؛ إشارة الخروج عند الإغلاق والخروج عند افتتاح اليوم التالي.
// الوقف = إغلاق الإشارة − 2×ATR في الحالتين؛ المخاطرة (1R) = الدخول الفعلي − الوقف.
function rsi2Run(c, { from = '0000', to = '9999', spreadPct = SPEC.spreadPct, mode = 'close', p = ndxConfig.rsi2 } = {}) {
  const closes = c.map((x) => x.close);
  const trend = sma(closes, p.smaTrend);
  const exitMa = sma(closes, p.smaExit);
  const r2 = rsiWilder(closes, p.rsiPeriod);
  const a = atrWilder(c);
  const out = [];
  let open = null;
  let pendingEntry = null;
  let pendingExit = false;
  const close = (t, exit, at) => {
    const cost = (t.entry * (spreadPct + nights(t.time, at) * SPEC.swapPctPerNight)) / 100 / t.risk;
    out.push({ time: t.time, closedAt: at, r: (exit - t.entry) / t.risk - cost });
  };
  for (let i = 0; i < c.length; i++) {
    const x = c[i];
    if (pendingEntry) {
      const risk = x.open - pendingEntry.stop;
      open = risk > 0 ? { time: x.time, entry: x.open, stop: pendingEntry.stop, risk, bars: 0 } : null;
      pendingEntry = null;
    }
    if (open && pendingExit) {
      close(open, x.open, x.time);
      open = null;
      pendingExit = false;
      continue;
    }
    if (open) {
      open.bars++;
      let exit = null;
      if (x.low <= open.stop) exit = Math.min(open.stop, x.open);
      if (exit !== null) {
        close(open, exit, x.time);
        open = null;
        continue;
      }
      if (x.close > exitMa[i] || open.bars >= p.maxBars) {
        if (mode === 'close') {
          close(open, x.close, x.time);
          open = null;
        } else pendingExit = true;
      }
      continue;
    }
    if (x.time < from || x.time > to || trend[i] === null || a[i] === null || r2[i] === null) continue;
    if (x.close > trend[i] && r2[i] < p.entryBelow) {
      const stop = x.close - p.stopAtr * a[i];
      if (mode === 'close') open = { time: x.time, entry: x.close, stop, risk: x.close - stop, bars: 0 };
      else pendingEntry = { stop };
    }
  }
  return out;
}

function judge(c) {
  const from = SPEC.periods[0][1];
  const base = rsi2Run(c, { from });
  const m = metrics(base);
  const md = metrics(rsi2Run(c, { from, spreadPct: SPEC.spreadPct * 2 }));
  const mo = metrics(rsi2Run(c, { from, mode: 'nextOpen' }));
  const reasons = [];
  let noVerdict = false;
  const periods = SPEC.periods.map(([name, a], k) => {
    const b = SPEC.periods[k + 1]?.[1] ?? '9999';
    const bars = c.filter((x) => x.time >= a && x.time < b);
    const flat = flatShare(bars);
    const pm = metrics(base.filter((t) => t.time >= a && t.time < b));
    if (flat > SPEC.maxFlat) {
      noVerdict = true;
      reasons.push(`${name}: البيانات غير موثوقة (${(flat * 100).toFixed(1)}%)`);
    }
    if (!(pm.net > 0)) reasons.push(`${name}: الصافي غير موجب`);
    if (pm.n < SPEC.minTrades) reasons.push(`${name}: ${pm.n} صفقة فقط`);
    return { name, a, b, m: pm };
  });
  if (!(m.pf >= SPEC.minPf)) reasons.push(`PF الكلي أقل من ${SPEC.minPf}`);
  if (!(md.net > 0)) reasons.push('بضعف السبريد: الصافي غير موجب');
  if (!(mo.net > 0)) reasons.push('الدخول والخروج عند افتتاح اليوم التالي: الصافي غير موجب');
  let positive = 0;
  for (const e of SPEC.grid.entry)
    for (const x of SPEC.grid.exit) if (metrics(rsi2Run(c, { from, p: { ...ndxConfig.rsi2, entryBelow: e, smaExit: x } })).net > 0) positive++;
  if (positive < SPEC.grid.minPositive) reasons.push(`المتانة: ${positive} من 9 فقط`);
  return { m, md, mo, periods, positive, reasons, verdict: noVerdict ? 'لا حكم' : reasons.length ? 'فشل' : 'نجح' };
}

async function fetchAll() {
  for (const [t, name] of SPEC.tickers) {
    const c = await yahoo.fetchDaily(t, SPEC.dataFrom);
    save(t, c);
    console.log(`${t} (${name}): ${c.length} يوم من ${c[0]?.time} إلى ${c.at(-1)?.time}`);
  }
  console.log('\nالخطوة التالية: npm run sectors -- run');
}

const sgn = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
const pf = (m) => (m.n === 0 ? '—' : Number.isFinite(m.pf) ? m.pf.toFixed(2) : '∞');
const row = (label, m) => `${label}: ${m.n} صفقة | ربح ${m.winRate.toFixed(0)}% | PF ${pf(m)} | ${sgn(m.net)}R | تراجع ${m.maxDd.toFixed(1)}R`;

function run() {
  const missing = SPEC.tickers.filter(([t]) => !load(t)?.length);
  if (missing.length) return console.log(`⚠️ لا توجد بيانات ${missing.map(([t]) => t).join('، ')}. شغّل أولاً: npm run sectors -- fetch`);
  const done = load('done');
  const L = ['KC SECTORS — RSI(2) كما هي على 9 قطاعات أمريكية (تشغيل مرة واحدة)'];
  if (done) L.push(`⚠️ شُغّل من قبل (${done.at}). النتيجة الأولى هي المعتمدة؛ هذه إعادة عرض.`);
  L.push(`التكاليف: سبريد ${SPEC.spreadPct}% + Swap ${SPEC.swapPctPerNight}% لكل ليلة. الفترات: 1999، 2011، 2019 → اليوم.`, '');
  const summary = [];
  for (const [t, name] of SPEC.tickers) {
    const j = judge(load(t));
    L.push(`• ${t} — ${name}`, `   ${row('الكل (دخول عند الإغلاق)', j.m)}`, `   ${row('عند افتتاح اليوم التالي', j.mo)}`, `   ${row('بضعف السبريد', j.md)}`);
    for (const p of j.periods) L.push(`   ${row(`${p.name} (من ${p.a})`, p.m)}`);
    L.push(`   المتانة: ${j.positive} من 9`, '');
    summary.push(`• ${t} ${name}: ${j.verdict === 'نجح' ? '✅ نجح' : j.verdict === 'فشل' ? '❌' : '⚠️ لا حكم'}${j.reasons.length ? ` — ${j.reasons.join('؛ ')}` : ''}`);
  }
  L.push('━━ الأحكام', ...summary, '', 'أي قطاع ينجح يدخل اختباراً مستقبلياً قبل أي تداول. R = المبلغ الذي تخاطر به. اختبار تاريخي فقط.');
  const text = L.join('\n');
  console.log(text);
  if (!done) {
    save('done', { at: new Date().toISOString() });
    fs.mkdirSync(config.paths.logs, { recursive: true });
    fs.writeFileSync(path.join(config.paths.logs, 'sectors-report.txt'), text);
    console.log('\nالتقرير المعتمد محفوظ في logs/sectors-report.txt');
  }
}

if (require.main === module) {
  const cmd = process.argv[2];
  Promise.resolve(cmd === 'fetch' ? fetchAll() : cmd === 'run' ? run() : console.log('الأوامر: fetch | run')).catch((e) => {
    console.error('فشل:', e.message);
    process.exit(1);
  });
}

module.exports = { SPEC, rsi2Run, judge };
