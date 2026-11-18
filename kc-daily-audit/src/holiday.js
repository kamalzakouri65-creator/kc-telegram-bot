// ما قبل العطل — الشروط مسجلة قبل أي نتيجة (2026-11-18) ووافق عليها صاحب المشروع:
//   يوم ما قبل العطلة = آخر يوم تداول قبل يوم عمل (إثنين–جمعة) أُغلق فيه السوق الأمريكي.
//   الإغلاقات المفاجئة غير المعلنة مسبقاً مستبعدة (UNSCHEDULED).
//   شراء عند إغلاق اليوم الذي يسبقه، وبيع عند إغلاق يوم ما قبل العطلة. الوقف 2×ATR(14) (فجوة تحته = الافتتاح).
//   التكاليف: سبريد 0.01% + Swap 0.02% لكل ليلة. الفترات: 1985→2004، 2005→2020، 2021→اليوم.
//   النجاح (S&P 500): كل فترة رابحة و 20+ صفقة، PF ≥ 1.2، رابح بضعف السبريد، المتانة 5 من 6
//   (الدخول قبل 1/2/3 أيام × الخروج قبل العطلة أو أول إغلاق بعدها)، والبيانات سليمة. NASDAQ و Dow للمقارنة. تشغيل مرة واحدة.
//   npm run holiday -- fetch     ثم     npm run holiday -- run
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { metrics, flatShare } = require('./engine');
const { nights } = require('../../kc-nasdaq-daily/src/engine');
const yahoo = require('../../kc-nasdaq-daily/src/data');

const UNSCHEDULED = ['1985-09-27', '1994-04-27', '2001-09-11', '2001-09-12', '2001-09-13', '2001-09-14', '2004-06-11', '2007-01-02', '2012-10-29', '2012-10-30', '2018-12-05', '2025-01-09'];
const SPEC = {
  markets: [
    { name: 'S&P 500', ticker: '^GSPC', judged: true },
    { name: 'NASDAQ 100', ticker: '^NDX', judged: false },
    { name: 'Dow Jones', ticker: '^DJI', judged: false },
  ],
  dataFrom: '1984-06-01',
  rule: { daysBefore: 1, exit: 'before', stopAtr: 2 },
  periods: [['الفترة 1', '1985-01-01', '2004-12-31'], ['الفترة 2', '2005-01-01', '2020-12-31'], ['الفترة 3', '2021-01-01', '9999']],
  spreadPct: 0.01,
  swapPctPerNight: 0.02,
  minPf: 1.2,
  minTrades: 20,
  grid: { daysBefore: [1, 2, 3], exit: ['before', 'after'], minPositive: 5 },
  maxFlat: 0.05,
};

const file = (n) => path.join(config.paths.data, `holiday-${n.replace(/\W/g, '')}.json`);
const save = (n, v) => (fs.mkdirSync(config.paths.data, { recursive: true }), fs.writeFileSync(file(n), JSON.stringify(v)));
const load = (n) => {
  try {
    return JSON.parse(fs.readFileSync(file(n), 'utf8'));
  } catch {
    return null;
  }
};
const DAY = 86400000;

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

// مؤشرات أيام ما قبل العطل: بين الشمعة i والتالية يوم عمل مفقود ليس إغلاقاً مفاجئاً
function preHolidayIndexes(candles) {
  const out = [];
  for (let i = 0; i + 1 < candles.length; i++) {
    const missing = [];
    for (let t = Date.parse(candles[i].time) + DAY; t < Date.parse(candles[i + 1].time); t += DAY) {
      const d = new Date(t);
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) missing.push(d.toISOString().slice(0, 10));
    }
    if (missing.length && !missing.some((m) => UNSCHEDULED.includes(m))) out.push(i);
  }
  return out;
}

function holidayTrades(candles, { from = '0000', to = '9999', spreadPct = SPEC.spreadPct, rule = SPEC.rule } = {}) {
  const a = atrWilder(candles);
  const out = [];
  for (const p of preHolidayIndexes(candles)) {
    const e = p - rule.daysBefore;
    const x = rule.exit === 'before' ? p : p + 1;
    if (e < 1 || x >= candles.length || a[e] === null) continue;
    const c = candles[e];
    if (c.time < from || c.time > to) continue;
    const risk = rule.stopAtr * a[e];
    const stop = c.close - risk;
    let exit = null;
    let at = null;
    for (let k = e + 1; k <= x; k++) {
      if (candles[k].low <= stop) {
        [exit, at] = [Math.min(stop, candles[k].open), candles[k].time];
        break;
      }
      if (k === x) [exit, at] = [candles[k].close, candles[k].time];
    }
    const cost = (c.close * (spreadPct + nights(c.time, at) * SPEC.swapPctPerNight)) / 100 / risk;
    out.push({ time: c.time, closedAt: at, holidayEve: candles[p].time, r: (exit - c.close) / risk - cost });
  }
  return out;
}

function judge(candles) {
  const start = SPEC.periods[0][1];
  const trades = holidayTrades(candles, { from: start });
  const m = metrics(trades);
  const md = metrics(holidayTrades(candles, { from: start, spreadPct: SPEC.spreadPct * 2 }));
  const reasons = [];
  let noVerdict = false;
  const periods = SPEC.periods.map(([name, from, to]) => {
    const bars = candles.filter((c) => c.time >= from && c.time <= to);
    const flat = flatShare(bars);
    const pm = metrics(trades.filter((t) => t.time >= from && t.time <= to));
    if (flat > SPEC.maxFlat) {
      noVerdict = true;
      reasons.push(`${name}: البيانات غير موثوقة (${(flat * 100).toFixed(1)}% شموع بلا مدى)`);
    }
    if (!(pm.net > 0)) reasons.push(`${name}: الصافي غير موجب`);
    if (pm.n < SPEC.minTrades) reasons.push(`${name}: ${pm.n} صفقة فقط (المطلوب ${SPEC.minTrades})`);
    return { name, from: bars[0]?.time, to: bars.at(-1)?.time, flat, m: pm };
  });
  if (!(m.pf >= SPEC.minPf)) reasons.push(`PF الكلي أقل من ${SPEC.minPf}`);
  if (!(md.net > 0)) reasons.push('بضعف السبريد: الصافي غير موجب');
  const grid = [];
  for (const daysBefore of SPEC.grid.daysBefore)
    for (const exit of SPEC.grid.exit) grid.push({ daysBefore, exit, m: metrics(holidayTrades(candles, { from: start, rule: { ...SPEC.rule, daysBefore, exit } })) });
  const positive = grid.filter((g) => g.m.net > 0).length;
  if (positive < SPEC.grid.minPositive) reasons.push(`المتانة: ${positive} من 6 رابحة فقط (المطلوب ${SPEC.grid.minPositive})`);
  return { trades, m, md, periods, grid, positive, reasons, verdict: noVerdict ? 'لا حكم' : reasons.length ? 'فشل' : 'نجح' };
}

async function fetchAll() {
  for (const mk of SPEC.markets) {
    const c = await yahoo.fetchDaily(mk.ticker, SPEC.dataFrom);
    save(mk.ticker, c);
    console.log(`${mk.name}: ${c.length} يوم من ${c[0]?.time} إلى ${c.at(-1)?.time}`);
  }
  console.log('\nالخطوة التالية: npm run holiday -- run');
}

const sgn = (x, d = 1) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
const pf = (m) => (m.n === 0 ? '—' : Number.isFinite(m.pf) ? m.pf.toFixed(2) : '∞');
const row = (label, m) => `${label}: ${m.n} صفقة | ربح ${m.winRate.toFixed(0)}% | PF ${pf(m)} | ${sgn(m.net)}R | تراجع ${m.maxDd.toFixed(1)}R`;
const EXIT = { before: 'قبل العطلة', after: 'بعدها بيوم' };

function run() {
  const data = Object.fromEntries(SPEC.markets.map((m) => [m.name, load(m.ticker)]));
  const missing = SPEC.markets.filter((m) => !data[m.name]?.length);
  if (missing.length) return console.log(`⚠️ لا توجد بيانات ${missing.map((m) => m.name).join('، ')}. شغّل أولاً: npm run holiday -- fetch`);
  const done = load('done');
  const L = ['KC PRE-HOLIDAY — ما قبل عطل السوق الأمريكي (تشغيل مرة واحدة)'];
  if (done) L.push(`⚠️ شُغّل من قبل (${done.at}). النتيجة الأولى هي المعتمدة؛ هذه إعادة عرض.`);
  L.push(`القاعدة: شراء عند إغلاق اليوم السابق لآخر يوم قبل العطلة، والبيع عند إغلاق آخر يوم قبلها. الوقف 2×ATR. التكاليف: سبريد ${SPEC.spreadPct}% + Swap ${SPEC.swapPctPerNight}% لكل ليلة.`, '');
  let sp = null;
  for (const mk of SPEC.markets) {
    const j = judge(data[mk.name]);
    L.push(`• ${mk.name}${mk.judged ? '' : ' (للمقارنة فقط)'}`, `   ${row('الكل', j.m)} | Exp ${j.m.n ? sgn(j.m.net / j.m.n, 3) : '—'}R`, `   ${row('بضعف السبريد', j.md)}`);
    for (const p of j.periods) L.push(`   ${row(`${p.name} ${p.from ?? '—'} → ${p.to ?? '—'}`, p.m)} | بلا مدى ${(p.flat * 100).toFixed(1)}%`);
    L.push(`   المتانة: ${j.positive} من 6 رابحة`);
    for (const d of SPEC.grid.daysBefore) L.push(`     قبل ${d}: ${j.grid.filter((g) => g.daysBefore === d).map((g) => `${EXIT[g.exit]} PF ${pf(g.m)} ${sgn(g.m.net)}R (${g.m.n})`).join(' | ')}`);
    L.push('');
    if (mk.judged) sp = j;
  }
  L.push('━━ الحكم (S&P 500)', `• ${sp.verdict === 'نجح' ? '✅ نجح' : sp.verdict === 'فشل' ? '❌ لم ينجح' : '⚠️ لا حكم'}`, ...sp.reasons.map((r) => `   - ${r}`));
  L.push('', 'R = المبلغ الذي تخاطر به في الصفقة (2×ATR). اختبار تاريخي فقط، لا تداول.');
  const text = L.join('\n');
  console.log(text);
  if (!done) {
    save('done', { at: new Date().toISOString() });
    fs.mkdirSync(config.paths.logs, { recursive: true });
    fs.writeFileSync(path.join(config.paths.logs, 'holiday-report.txt'), text);
    console.log('\nالتقرير المعتمد محفوظ في logs/holiday-report.txt');
  }
}

if (require.main === module) {
  const cmd = process.argv[2];
  Promise.resolve(cmd === 'fetch' ? fetchAll() : cmd === 'run' ? run() : console.log('الأوامر: fetch | run')).catch((e) => {
    console.error('فشل:', e.message);
    process.exit(1);
  });
}

module.exports = { SPEC, UNSCHEDULED, preHolidayIndexes, holidayTrades, judge };
