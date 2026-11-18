// تأثير الليل (Overnight) — الشروط مسجلة قبل أي نتيجة (2026-11-18) ووافق عليها صاحب المشروع:
//   شراء عند إغلاق كل يوم تداول، وبيع عند افتتاح يوم التداول التالي. بلا وقف، بلا فلتر، شراء فقط.
//   التكاليف: سبريد 0.01% لكل صفقة + Swap 0.02% لكل ليلة تقويمية (الجمعة → الإثنين = 3). اختبار إضافي بضعف السبريد.
//   الفترات: 1985 → 2004، 2005 → 2020، 2021 → اليوم. جودة البيانات: أكثر من 5% افتتاح = إغلاق الأمس بالضبط → "لا حكم".
//   النجاح (S&P 500): صافي موجب في كل فترة، و PF ≥ 1.2 كلياً، ورابح بضعف السبريد، والبيانات سليمة. NASDAQ و Dow للمقارنة فقط.
//   تشغيل مرة واحدة: النتيجة الأولى هي المعتمدة.
//   npm run overnight -- fetch     ثم     npm run overnight -- run
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const yahoo = require('../../kc-nasdaq-daily/src/data');

const SPEC = {
  markets: [
    { name: 'S&P 500', ticker: '^GSPC', judged: true },
    { name: 'NASDAQ 100', ticker: '^NDX', judged: false },
    { name: 'Dow Jones', ticker: '^DJI', judged: false },
  ],
  dataFrom: '1984-12-01',
  periods: [['الفترة 1', '1985-01-01', '2004-12-31'], ['الفترة 2', '2005-01-01', '2020-12-31'], ['الفترة 3', '2021-01-01', '9999']],
  spreadPct: 0.01,
  swapPctPerNight: 0.02,
  minPf: 1.2,
  maxBadOpenShare: 0.05,
  lot: 0.1,
};

const file = (n) => path.join(config.paths.data, `overnight-${n.replace(/\W/g, '')}.json`);
const save = (n, v) => (fs.mkdirSync(config.paths.data, { recursive: true }), fs.writeFileSync(file(n), JSON.stringify(v)));
const load = (n) => {
  try {
    return JSON.parse(fs.readFileSync(file(n), 'utf8'));
  } catch {
    return null;
  }
};
const DAY = 86400000;
const nights = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

// صفقة لكل يوم: الدخول إغلاق اليوم t، والخروج افتتاح t+1. العائد بالنسبة المئوية بعد التكاليف
function overnightTrades(candles, { spreadPct = SPEC.spreadPct, swapPct = SPEC.swapPctPerNight } = {}) {
  const out = [];
  for (let t = 0; t + 1 < candles.length; t++) {
    const a = candles[t];
    const b = candles[t + 1];
    const gross = ((b.open - a.close) / a.close) * 100;
    const n = nights(a.time, b.time);
    out.push({ time: a.time, exitTime: b.time, gross, nights: n, ret: gross - spreadPct - swapPct * n });
  }
  return out;
}

// أيام افتتاحها يساوي إغلاق الأمس بالضبط (علامة بيانات افتتاح ناقصة)
function badOpenShare(candles) {
  if (candles.length < 2) return 1;
  let bad = 0;
  for (let i = 1; i < candles.length; i++) if (candles[i].open === candles[i - 1].close) bad++;
  return bad / (candles.length - 1);
}

function stats(trades) {
  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const t of trades) {
    eq += t.ret;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  const wins = trades.filter((t) => t.ret > 0);
  const gw = wins.reduce((s, t) => s + t.ret, 0);
  const gl = -trades.filter((t) => t.ret < 0).reduce((s, t) => s + t.ret, 0);
  return {
    n: trades.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    pf: gl ? gw / gl : trades.length && gw > 0 ? Infinity : 0,
    total: eq,
    avg: trades.length ? eq / trades.length : 0,
    avgGross: trades.length ? trades.reduce((s, t) => s + t.gross, 0) / trades.length : 0,
    maxDd: dd,
  };
}

function judge(candles) {
  const trades = overnightTrades(candles);
  const double = overnightTrades(candles, { spreadPct: SPEC.spreadPct * 2 });
  const inside = (list, from, to) => list.filter((t) => t.time >= from && t.time <= to);
  const reasons = [];
  let noVerdict = false;
  const periods = SPEC.periods.map(([name, from, to]) => {
    const bars = candles.filter((c) => c.time >= from && c.time <= to);
    const bad = badOpenShare(bars);
    const s = stats(inside(trades, from, to));
    if (bad > SPEC.maxBadOpenShare) {
      noVerdict = true;
      reasons.push(`${name}: بيانات الافتتاح غير موثوقة (${(bad * 100).toFixed(1)}% افتتاح = إغلاق الأمس)`);
    }
    if (!(s.total > 0)) reasons.push(`${name}: الصافي غير موجب`);
    return { name, from: bars[0]?.time, to: bars.at(-1)?.time, bad, s };
  });
  const all = inside(trades, SPEC.periods[0][1], '9999');
  const m = stats(all);
  const md = stats(inside(double, SPEC.periods[0][1], '9999'));
  if (!(m.pf >= SPEC.minPf)) reasons.push(`PF الكلي ${Number.isFinite(m.pf) ? m.pf.toFixed(2) : '∞'} أقل من ${SPEC.minPf}`);
  if (!(md.total > 0)) reasons.push('بضعف السبريد: الصافي غير موجب');
  return { m, md, periods, reasons, verdict: noVerdict ? 'لا حكم' : reasons.length ? 'فشل' : 'نجح' };
}

async function fetchAll() {
  for (const mk of SPEC.markets) {
    const c = await yahoo.fetchDaily(mk.ticker, SPEC.dataFrom);
    save(mk.ticker, c);
    console.log(`${mk.name}: ${c.length} يوم من ${c[0]?.time} إلى ${c.at(-1)?.time}`);
  }
  console.log('\nالخطوة التالية: npm run overnight -- run');
}

const pct = (x, d = 3) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}%`;
const pfs = (s) => (s.n === 0 ? '—' : Number.isFinite(s.pf) ? s.pf.toFixed(2) : '∞');
const row = (label, s) => `${label}: ${s.n} صفقة | ربح ${s.winRate.toFixed(0)}% | PF ${pfs(s)} | المتوسط ${pct(s.avg)} (قبل التكاليف ${pct(s.avgGross)}) | المجموع ${pct(s.total, 1)} | تراجع ${s.maxDd.toFixed(1)}%`;

function run() {
  const data = Object.fromEntries(SPEC.markets.map((m) => [m.name, load(m.ticker)]));
  const missing = SPEC.markets.filter((m) => !data[m.name]?.length);
  if (missing.length) return console.log(`⚠️ لا توجد بيانات ${missing.map((m) => m.name).join('، ')}. شغّل أولاً: npm run overnight -- fetch`);
  const done = load('done');
  const L = ['KC OVERNIGHT — شراء عند الإغلاق وبيع عند الافتتاح التالي (تشغيل مرة واحدة)'];
  if (done) L.push(`⚠️ شُغّل من قبل (${done.at}). النتيجة الأولى هي المعتمدة؛ هذه إعادة عرض.`);
  L.push(`التكاليف: سبريد ${SPEC.spreadPct}% لكل صفقة + Swap ${SPEC.swapPctPerNight}% لكل ليلة. النجاح على S&P 500 فقط؛ NASDAQ و Dow للمقارنة.`, '');
  const verdicts = [];
  for (const mk of SPEC.markets) {
    const c = data[mk.name];
    const j = judge(c);
    L.push(`• ${mk.name}${mk.judged ? '' : ' (للمقارنة فقط)'}`, `   ${row('الكل', j.m)}`, `   ${row('بضعف السبريد', j.md)}`);
    for (const p of j.periods) L.push(`   ${row(`${p.name} ${p.from ?? '—'} → ${p.to ?? '—'}`, p.s)} | افتتاح مشكوك ${(p.bad * 100).toFixed(1)}%`);
    if (mk.judged) {
      const price = c.at(-1).close;
      const perTrade = (j.m.avg / 100) * price * SPEC.lot;
      const years = (Date.parse(c.at(-1).time) - Date.parse(SPEC.periods[0][1])) / (365.25 * DAY);
      L.push(`   بالدولار (US500Cash ${SPEC.lot} لوت بسعر اليوم ${price.toFixed(0)}): ${perTrade >= 0 ? '+' : ''}${perTrade.toFixed(3)}$ لكل صفقة ≈ ${(perTrade * (j.m.n / years)).toFixed(1)}$ في السنة`);
      verdicts.push({ name: mk.name, ...j });
    }
    L.push('');
  }
  L.push('━━ الحكم (S&P 500)');
  for (const v of verdicts) L.push(`• ${v.verdict === 'نجح' ? '✅ نجح' : v.verdict === 'فشل' ? '❌ لم ينجح' : '⚠️ لا حكم'}`, ...v.reasons.map((r) => `   - ${r}`));
  L.push('', 'اختبار تاريخي فقط، لا تداول.');
  const text = L.join('\n');
  console.log(text);
  if (!done) {
    save('done', { at: new Date().toISOString() });
    fs.mkdirSync(config.paths.logs, { recursive: true });
    fs.writeFileSync(path.join(config.paths.logs, 'overnight-report.txt'), text);
    console.log('\nالتقرير المعتمد محفوظ في logs/overnight-report.txt');
  }
}

if (require.main === module) {
  const cmd = process.argv[2];
  Promise.resolve(cmd === 'fetch' ? fetchAll() : cmd === 'run' ? run() : console.log('الأوامر: fetch | run')).catch((e) => {
    console.error('فشل:', e.message);
    process.exit(1);
  });
}

module.exports = { SPEC, overnightTrades, badOpenShare, stats, judge };
