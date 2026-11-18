// IBS (قوة إغلاق الشمعة) — الشروط مسجلة قبل أي نتيجة (2026-11-18) ووافق عليها صاحب المشروع:
//   IBS = (الإغلاق − الأدنى) ÷ (الأعلى − الأدنى). شراء عند الإغلاق إذا IBS < 0.2 والسعر فوق متوسط 200 يوم.
//   الخروج: أول إغلاق فوق أعلى اليوم السابق، أو بعد 5 أيام. الوقف: الدخول − 2×ATR(14) (فجوة تحته = سعر الافتتاح). صفقة واحدة.
//   التكاليف: سبريد 0.01% + Swap 0.02% لكل ليلة. الفترات: 1985→2004، 2005→2020، 2021→اليوم.
//   النجاح (S&P 500): كل فترة رابحة و 20+ صفقة، PF ≥ 1.2 كلياً، رابح بضعف السبريد، المتانة 7 من 9 (IBS 0.1/0.2/0.3 × 3/5/10 أيام)،
//   والبيانات سليمة (أقل من 5% شموع بلا مدى). NASDAQ و Dow للمقارنة فقط. تشغيل مرة واحدة.
//   npm run ibs -- fetch     ثم     npm run ibs -- run
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { metrics, flatShare } = require('./engine');
const { sma, nights } = require('../../kc-nasdaq-daily/src/engine');
const { rsi2Trades } = require('./research');
const yahoo = require('../../kc-nasdaq-daily/src/data');

const SPEC = {
  markets: [
    { name: 'S&P 500', ticker: '^GSPC', judged: true },
    { name: 'NASDAQ 100', ticker: '^NDX', judged: false },
    { name: 'Dow Jones', ticker: '^DJI', judged: false },
  ],
  dataFrom: '1984-01-01',
  rule: { ibsBelow: 0.2, maxBars: 5, smaTrend: 200, stopAtr: 2 },
  periods: [['الفترة 1', '1985-01-01', '2004-12-31'], ['الفترة 2', '2005-01-01', '2020-12-31'], ['الفترة 3', '2021-01-01', '9999']],
  spreadPct: 0.01,
  swapPctPerNight: 0.02,
  minPf: 1.2,
  minTrades: 20,
  grid: { ibs: [0.1, 0.2, 0.3], maxBars: [3, 5, 10], minPositive: 7 },
  maxFlat: 0.05,
};

const file = (n) => path.join(config.paths.data, `ibs-${n.replace(/\W/g, '')}.json`);
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

function ibsTrades(candles, { from = '0000', to = '9999', spreadPct = SPEC.spreadPct, rule = SPEC.rule } = {}) {
  const trend = sma(candles.map((c) => c.close), rule.smaTrend);
  const a = atrWilder(candles);
  const out = [];
  let open = null;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    if (open) {
      open.bars++;
      let exit = null;
      if (c.low <= open.stop) exit = Math.min(open.stop, c.open);
      else if (c.close > candles[i - 1].high || open.bars >= rule.maxBars) exit = c.close;
      if (exit !== null) {
        const cost = (open.entry * (spreadPct + nights(open.time, c.time) * SPEC.swapPctPerNight)) / 100 / open.risk;
        out.push({ time: open.time, closedAt: c.time, r: (exit - open.entry) / open.risk - cost });
        open = null;
      }
      continue;
    }
    const range = c.high - c.low;
    if (c.time < from || c.time > to || trend[i] === null || a[i] === null || !(range > 0)) continue;
    const ibs = (c.close - c.low) / range;
    if (ibs < rule.ibsBelow && c.close > trend[i]) {
      const risk = rule.stopAtr * a[i];
      open = { time: c.time, entry: c.close, stop: c.close - risk, risk, bars: 0 };
    }
  }
  return out;
}

function judge(candles) {
  const start = SPEC.periods[0][1];
  const trades = ibsTrades(candles, { from: start });
  const double = ibsTrades(candles, { from: start, spreadPct: SPEC.spreadPct * 2 });
  const m = metrics(trades);
  const md = metrics(double);
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
  for (const ibsBelow of SPEC.grid.ibs)
    for (const maxBars of SPEC.grid.maxBars) grid.push({ ibsBelow, maxBars, m: metrics(ibsTrades(candles, { from: start, rule: { ...SPEC.rule, ibsBelow, maxBars } })) });
  const positive = grid.filter((g) => g.m.net > 0).length;
  if (positive < SPEC.grid.minPositive) reasons.push(`المتانة: ${positive} من 9 رابحة فقط (المطلوب ${SPEC.grid.minPositive})`);
  const rsi = rsi2Trades(candles, { from: start });
  const overlap = trades.filter((t) => rsi.some((r) => r.time <= t.closedAt && r.closedAt >= t.time)).length;
  return { trades, m, md, periods, grid, positive, overlap, reasons, verdict: noVerdict ? 'لا حكم' : reasons.length ? 'فشل' : 'نجح' };
}

async function fetchAll() {
  for (const mk of SPEC.markets) {
    const c = await yahoo.fetchDaily(mk.ticker, SPEC.dataFrom);
    save(mk.ticker, c);
    console.log(`${mk.name}: ${c.length} يوم من ${c[0]?.time} إلى ${c.at(-1)?.time}`);
  }
  console.log('\nالخطوة التالية: npm run ibs -- run');
}

const sgn = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
const pf = (m) => (m.n === 0 ? '—' : Number.isFinite(m.pf) ? m.pf.toFixed(2) : '∞');
const row = (label, m) => `${label}: ${m.n} صفقة | ربح ${m.winRate.toFixed(0)}% | PF ${pf(m)} | ${sgn(m.net)}R | تراجع ${m.maxDd.toFixed(1)}R`;

function run() {
  const data = Object.fromEntries(SPEC.markets.map((m) => [m.name, load(m.ticker)]));
  const missing = SPEC.markets.filter((m) => !data[m.name]?.length);
  if (missing.length) return console.log(`⚠️ لا توجد بيانات ${missing.map((m) => m.name).join('، ')}. شغّل أولاً: npm run ibs -- fetch`);
  const done = load('done');
  const L = ['KC IBS — شراء عند إغلاق قريب من أدنى اليوم (تشغيل مرة واحدة)'];
  if (done) L.push(`⚠️ شُغّل من قبل (${done.at}). النتيجة الأولى هي المعتمدة؛ هذه إعادة عرض.`);
  L.push(`القاعدة: IBS < ${SPEC.rule.ibsBelow} وفوق متوسط ${SPEC.rule.smaTrend} يوم؛ الخروج فوق أعلى الأمس أو بعد ${SPEC.rule.maxBars} أيام؛ الوقف ${SPEC.rule.stopAtr}×ATR. التكاليف: سبريد ${SPEC.spreadPct}% + Swap ${SPEC.swapPctPerNight}% لكل ليلة.`, '');
  let sp = null;
  for (const mk of SPEC.markets) {
    const j = judge(data[mk.name]);
    L.push(`• ${mk.name}${mk.judged ? '' : ' (للمقارنة فقط)'}`, `   ${row('الكل', j.m)} | Exp ${j.m.n ? `${j.m.net >= 0 ? '+' : ''}${(j.m.net / j.m.n).toFixed(3)}` : '—'}R`, `   ${row('بضعف السبريد', j.md)}`);
    for (const p of j.periods) L.push(`   ${row(`${p.name} ${p.from ?? '—'} → ${p.to ?? '—'}`, p.m)} | بلا مدى ${(p.flat * 100).toFixed(1)}%`);
    L.push(`   المتانة: ${j.positive} من 9 رابحة`);
    for (const ib of SPEC.grid.ibs) L.push(`     IBS<${ib}: ${j.grid.filter((g) => g.ibsBelow === ib).map((g) => `${g.maxBars} أيام PF ${pf(g.m)} ${sgn(g.m.net)}R (${g.m.n})`).join(' | ')}`);
    L.push(`   تتزامن مع صفقة RSI(2): ${j.overlap} من ${j.trades.length}`, '');
    if (mk.judged) sp = j;
  }
  L.push('━━ الحكم (S&P 500)', `• ${sp.verdict === 'نجح' ? '✅ نجح' : sp.verdict === 'فشل' ? '❌ لم ينجح' : '⚠️ لا حكم'}`, ...sp.reasons.map((r) => `   - ${r}`));
  L.push('', 'R = المبلغ الذي تخاطر به في الصفقة (2×ATR). اختبار تاريخي فقط، لا تداول.');
  const text = L.join('\n');
  console.log(text);
  if (!done) {
    save('done', { at: new Date().toISOString() });
    fs.mkdirSync(config.paths.logs, { recursive: true });
    fs.writeFileSync(path.join(config.paths.logs, 'ibs-report.txt'), text);
    console.log('\nالتقرير المعتمد محفوظ في logs/ibs-report.txt');
  }
}

if (require.main === module) {
  const cmd = process.argv[2];
  Promise.resolve(cmd === 'fetch' ? fetchAll() : cmd === 'run' ? run() : console.log('الأوامر: fetch | run')).catch((e) => {
    console.error('فشل:', e.message);
    process.exit(1);
  });
}

module.exports = { SPEC, ibsTrades, judge };
