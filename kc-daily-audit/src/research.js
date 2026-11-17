// بحث 2026-11-17 — الشروط مسجلة قبل أي نتيجة ووافق عليها صاحب المشروع:
//   (1) محاكاة الخطة الحقيقية بالدولار: US500 بـ 0.1 لوت (XM) و 0.14 لوت (Exness)، رصيد 500$ (للمعرفة فقط)
//   (2) فحص متانة RSI(2): الدخول 5/10/15 × الخروج فوق متوسط 3/5/10 — "متينة" إذا 7 من 9 رابحة على كل مؤشر
//   (3) تأثير بداية الشهر: شراء عند إغلاق اليوم قبل الأخير من الشهر، والخروج عند إغلاق اليوم الثالث من الشهر الجديد،
//       الوقف 2×ATR. النجاح كما في اختبار المؤشرات الجديدة. تشغيل مرة واحدة.
//   npm run research -- fetch     ثم     npm run research -- run
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { metrics, flatShare } = require('./engine');
const { runRsi2, sma, rsiWilder, nights } = require('../../kc-nasdaq-daily/src/engine');
const { config: ndxConfig } = require('../../kc-nasdaq-daily/src/config');
const yahoo = require('../../kc-nasdaq-daily/src/data');

const MARKETS = [
  { name: 'S&P 500', ticker: '^GSPC', spreadPct: 0.01 },
  { name: 'NASDAQ 100', ticker: '^NDX', spreadPct: 0.007 },
  { name: 'Dow Jones', ticker: '^DJI', spreadPct: 0.02 },
];
const SWAP = ndxConfig.swapPctPerNight; // 0.02% لكل ليلة
const SIM = { start: 500, stopRule: 100, bigLoss: 20, spreadPts: 0.4, lots: [0.1, 0.14], from: '2005-01-01' };
const GRID = { entry: [5, 10, 15], exit: [3, 5, 10], minPositive: 7 };
const TOM = { periods: [['الفترة 1', '0000', '2004-12-31'], ['الفترة 2', '2005-01-01', '2020-12-31'], ['الفترة 3', '2021-01-01', '9999']], minTrades: 20, minPf: 1.2, maxFlat: 0.05 };

const file = (n) => path.join(config.paths.data, `research-${n.replace(/\W/g, '')}.json`);
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

// صفقات RSI(2) بالتفاصيل (دخول، وقف، خروج) — نفس منطق runRsi2 في kc-nasdaq-daily
function rsi2Trades(candles, { from = '0000', to = '9999' } = {}, p = ndxConfig.rsi2) {
  const closes = candles.map((c) => c.close);
  const trend = sma(closes, p.smaTrend);
  const exitMa = sma(closes, p.smaExit);
  const r2 = rsiWilder(closes, p.rsiPeriod);
  const a = atrWilder(candles);
  const out = [];
  let open = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (open) {
      open.bars++;
      let exit = null;
      if (c.low <= open.stop) exit = Math.min(open.stop, c.open);
      else if (c.close > exitMa[i] || open.bars >= p.maxBars) exit = c.close;
      if (exit !== null) {
        out.push({ ...open, exit, closedAt: c.time });
        open = null;
      }
      continue;
    }
    if (c.time < from || c.time > to || trend[i] === null || a[i] === null || r2[i] === null) continue;
    if (c.close > trend[i] && r2[i] < p.entryBelow) open = { time: c.time, entry: c.close, stop: c.close - p.stopAtr * a[i], bars: 0 };
  }
  return out;
}

// (1) الدولار: ربح الصفقة = اللوت × (الخروج − الدخول) − السبريد − Swap
function dollarSim(trades, lot, { skipAbove = Infinity } = {}) {
  let bal = SIM.start;
  let peak = bal;
  let maxDd = 0;
  let streak = 0;
  let worstStreak = 0;
  let stopHitAt = null;
  const list = [];
  for (const t of trades) {
    const lossAtStop = lot * (t.entry - t.stop);
    if (lossAtStop > skipAbove) continue;
    const pnl = lot * (t.exit - t.entry) - lot * SIM.spreadPts - (lot * t.entry * SWAP * nights(t.time, t.closedAt)) / 100;
    bal += pnl;
    peak = Math.max(peak, bal);
    maxDd = Math.max(maxDd, peak - bal);
    streak = pnl < 0 ? streak + 1 : 0;
    worstStreak = Math.max(worstStreak, streak);
    if (!stopHitAt && bal <= SIM.start - SIM.stopRule) stopHitAt = t.closedAt;
    list.push({ ...t, pnl, lossAtStop });
  }
  const years = list.length ? (Date.parse(list.at(-1).closedAt) - Date.parse(list[0].time)) / (365.25 * 86400000) : 0;
  const stops = list.map((t) => t.lossAtStop).sort((a, b) => a - b);
  return {
    n: list.length,
    end: bal,
    perYear: years ? (bal - SIM.start) / years : 0,
    maxDd,
    worstStreak,
    worstTrade: Math.min(0, ...list.map((t) => t.pnl)),
    stopMedian: stops.length ? stops[Math.floor(stops.length / 2)] : 0,
    stopMax: stops.at(-1) ?? 0,
    bigStops: trades.filter((t) => lot * (t.entry - t.stop) > SIM.bigLoss).length,
    stopHitAt,
  };
}

// (3) بداية الشهر
function tomTrades(candles, { spreadPct, from = '0000', to = '9999' }) {
  const a = atrWilder(candles);
  const month = (i) => candles[i].time.slice(0, 7);
  const out = [];
  for (let i = 15; i + 4 < candles.length; i++) {
    // i = اليوم قبل الأخير من الشهر: i+1 نفس الشهر، i+2 شهر جديد
    if (!(month(i + 1) === month(i) && month(i + 2) !== month(i))) continue;
    const c = candles[i];
    if (c.time < from || c.time > to || a[i] === null) continue;
    const risk = 2 * a[i];
    const stop = c.close - risk;
    let exit = null;
    let at = null;
    for (let k = i + 1; k <= i + 4; k++) {
      if (candles[k].low <= stop) {
        [exit, at] = [Math.min(stop, candles[k].open), candles[k].time];
        break;
      }
      if (k === i + 4) [exit, at] = [candles[k].close, candles[k].time];
    }
    const cost = (c.close * (spreadPct + nights(c.time, at) * SWAP)) / 100 / risk;
    out.push({ time: c.time, closedAt: at, r: (exit - c.close) / risk - cost });
  }
  return out;
}

function judgeTom(candles, spreadPct) {
  const trades = tomTrades(candles, { spreadPct });
  const double = tomTrades(candles, { spreadPct: spreadPct * 2 });
  const m = metrics(trades);
  const reasons = [];
  let noVerdict = false;
  const periods = TOM.periods.map(([name, from, to]) => {
    const bars = candles.filter((c) => c.time >= from && c.time <= to);
    const pm = metrics(trades.filter((t) => t.time >= from && t.time <= to));
    const flat = flatShare(bars);
    if (flat > TOM.maxFlat) {
      noVerdict = true;
      reasons.push(`${name}: البيانات غير موثوقة (${(flat * 100).toFixed(1)}%)`);
    }
    if (!(pm.net > 0)) reasons.push(`${name}: الصافي غير موجب`);
    if (pm.n < TOM.minTrades) reasons.push(`${name}: ${pm.n} صفقة فقط`);
    return { name, from: bars[0]?.time, to: bars.at(-1)?.time, m: pm };
  });
  if (!(m.pf >= TOM.minPf)) reasons.push(`PF الكلي أقل من ${TOM.minPf}`);
  const md = metrics(double);
  if (!(md.net > 0)) reasons.push('بضعف السبريد: الصافي غير موجب');
  return { trades, m, md, periods, reasons, verdict: noVerdict ? 'لا حكم' : reasons.length ? 'فشل' : 'نجح' };
}

async function fetchAll() {
  for (const mk of MARKETS) {
    const c = await yahoo.fetchDaily(mk.ticker, '1984-01-01');
    save(mk.ticker, c);
    console.log(`${mk.name}: ${c.length} يوم من ${c[0]?.time} إلى ${c.at(-1)?.time}`);
  }
  console.log('\nالخطوة التالية: npm run research -- run');
}

const sgn = (x, d = 1) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
const pf = (m) => (m.n === 0 ? '—' : Number.isFinite(m.pf) ? m.pf.toFixed(2) : '∞');
const row = (label, m) => `${label}: ${m.n} صفقة | ربح ${m.winRate.toFixed(0)}% | PF ${pf(m)} | ${sgn(m.net)}R | تراجع ${m.maxDd.toFixed(1)}R`;

function run() {
  const data = Object.fromEntries(MARKETS.map((m) => [m.name, load(m.ticker)]));
  const missing = MARKETS.filter((m) => !data[m.name]?.length);
  if (missing.length) return console.log(`⚠️ لا توجد بيانات ${missing.map((m) => m.name).join('، ')}. شغّل أولاً: npm run research -- fetch`);
  const L = ['KC RESEARCH — 2026-11-17 (الشروط مسجلة مسبقاً)', ''];

  // (1)
  const spx = data['S&P 500'];
  L.push(`━━ (1) محاكاة الخطة بالدولار: S&P 500، RSI(2)، رصيد ${SIM.start}$، سبريد ${SIM.spreadPts} نقطة + Swap ${SWAP}% لكل ليلة`);
  for (const [label, from, to] of [[`من ${SIM.from} حتى اليوم`, SIM.from, '9999'], ['1985–2004 (للمعلومة)', '0000', '2004-12-31']]) {
    const trades = rsi2Trades(spx, { from, to });
    L.push(`• ${label}`);
    for (const lot of SIM.lots) {
      const s = dollarSim(trades, lot);
      L.push(`   ${lot} لوت: ${s.n} صفقة | الرصيد النهائي ${s.end.toFixed(0)}$ | ${sgn(s.perYear, 1)}$ في السنة | أكبر تراجع ${s.maxDd.toFixed(0)}$ | أطول خسائر ${s.worstStreak} | أسوأ صفقة ${s.worstTrade.toFixed(0)}$`);
      L.push(`      الخسارة عند الوقف: الوسيط ${s.stopMedian.toFixed(1)}$، الأكبر ${s.stopMax.toFixed(1)}$ | أكثر من ${SIM.bigLoss}$: ${s.bigStops} مرة | قاعدة الـ ${SIM.stopRule}$: ${s.stopHitAt ? `كانت ستوقفنا في ${s.stopHitAt}` : 'لم تُلمس'}`);
      const k = dollarSim(trades, lot, { skipAbove: SIM.bigLoss });
      L.push(`      لو تخطينا الإشارات فوق ${SIM.bigLoss}$ (للمعلومة): ${k.n} صفقة | الرصيد ${k.end.toFixed(0)}$ | أكبر تراجع ${k.maxDd.toFixed(0)}$`);
    }
  }
  L.push('');

  // (2)
  L.push(`━━ (2) متانة RSI(2): الدخول (RSI أقل من) × الخروج (فوق متوسط)، من بداية البيانات، بعد التكاليف. القاعدة الرسمية 10 × 5 لا تتغير`);
  const robust = [];
  for (const mk of MARKETS) {
    let positive = 0;
    L.push(`• ${mk.name}`);
    for (const e of GRID.entry) {
      const cells = GRID.exit.map((x) => {
        const m = metrics(runRsi2(data[mk.name], { from: '0000', spreadPct: mk.spreadPct }, { ...ndxConfig.rsi2, entryBelow: e, smaExit: x }));
        if (m.net > 0) positive++;
        return `خروج ${x}: PF ${pf(m)} ${sgn(m.net)}R (${m.n})${e === 10 && x === 5 ? ' ← الرسمية' : ''}`;
      });
      L.push(`   RSI<${e}: ${cells.join(' | ')}`);
    }
    L.push(`   رابحة: ${positive} من 9`);
    robust.push({ name: mk.name, positive });
  }
  L.push('');

  // (3)
  L.push('━━ (3) تأثير بداية الشهر (تشغيل مرة واحدة)');
  const done = load('tom-done');
  if (done) L.push(`⚠️ شُغّل من قبل (${done.at}). النتيجة الأولى هي المعتمدة؛ هذه إعادة عرض.`);
  const tomV = [];
  for (const mk of MARKETS) {
    const j = judgeTom(data[mk.name], mk.spreadPct);
    const rsi = rsi2Trades(data[mk.name]);
    const overlap = j.trades.filter((t) => rsi.some((r) => r.time <= t.closedAt && r.closedAt >= t.time)).length;
    L.push(`• ${mk.name}`, `   ${row('الكل', j.m)}`, `   ${row('بضعف السبريد', j.md)}`);
    for (const p of j.periods) L.push(`   ${row(`${p.name} ${p.from ?? '—'} → ${p.to ?? '—'}`, p.m)}`);
    L.push(`   تتزامن مع صفقة RSI(2): ${overlap} من ${j.trades.length}`);
    tomV.push({ name: mk.name, ...j });
  }
  L.push('');

  L.push('━━ الخلاصة');
  for (const r of robust) L.push(`• متانة ${r.name}: ${r.positive >= GRID.minPositive ? '✅ متينة' : '⚠️ غير متينة'} (${r.positive} من 9 رابحة، المطلوب ${GRID.minPositive})`);
  for (const v of tomV) L.push(`• بداية الشهر ${v.name}: ${v.verdict === 'نجح' ? '✅ نجح' : v.verdict === 'فشل' ? '❌ لم ينجح' : '⚠️ لا حكم'}`, ...v.reasons.map((r) => `   - ${r}`));
  L.push('', 'R = المبلغ الذي تخاطر به في الصفقة. اختبار تاريخي فقط، لا تداول.');
  const text = L.join('\n');
  console.log(text);
  if (!done) {
    save('tom-done', { at: new Date().toISOString() });
    fs.mkdirSync(config.paths.logs, { recursive: true });
    fs.writeFileSync(path.join(config.paths.logs, 'research-report.txt'), text);
    console.log('\nالتقرير المعتمد محفوظ في logs/research-report.txt');
  }
}

if (require.main === module) {
  const cmd = process.argv[2];
  Promise.resolve(cmd === 'fetch' ? fetchAll() : cmd === 'run' ? run() : console.log('الأوامر: fetch | run')).catch((e) => {
    console.error('فشل:', e.message);
    process.exit(1);
  });
}

module.exports = { rsi2Trades, dollarSim, tomTrades, judgeTom, SIM, GRID, TOM };
