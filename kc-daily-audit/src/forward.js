// حالة الاختبار المستقبلي للمؤشرات (docs/FORWARD-TEST-INDICES.md). يقرأ سجل صفقات البوت فقط ولا يكتب فيه.
const fs = require('fs');
const path = require('path');
const { metrics, runRsi2Windowed } = require('./engine');
const { nights } = require('../../kc-nasdaq-daily/src/engine');
const { config: ndxConfig } = require('../../kc-nasdaq-daily/src/config');

const RULES = {
  // Dow Jones أضيف في 2026-11-16 قبل أي إشارة (بموافقة صاحب المشروع)، بسبريد متحفظ 0.02% كما في اختباره
  markets: { 'NASDAQ 100': { ticker: '^NDX', spreadPct: 0.007 }, 'S&P 500': { ticker: '^GSPC', spreadPct: 0.01 }, 'DOW JONES': { ticker: '^DJI', spreadPct: 0.02 } },
  strategy: 'rsi2',
  from: '2026-11-17',
  swapPctPerNight: 0.02,
  minTrades: 30,
  minPf: 1.0,
  maxDd: 8,
  window: 300,
};
const TRADES_FILE = path.join(__dirname, '..', '..', 'gold-forex-signals-bot', 'data', 'trades.json');
const day = (t) => t.slice(0, 10);
const inTest = (t) => RULES.markets[t.symbol] && t.strategy === RULES.strategy && day(t.time) >= RULES.from;

function forwardTrades(all) {
  return all
    .filter((t) => inTest(t) && t.closed)
    .map((t) => {
      const risk = t.entry - t.stopLoss;
      const n = nights(day(t.time), day(t.closedAt));
      const cost = (t.entry * (RULES.markets[t.symbol].spreadPct + n * RULES.swapPctPerNight)) / 100 / risk;
      return { symbol: t.symbol, time: day(t.time), closedAt: day(t.closedAt), rawR: t.r, r: t.r - cost };
    })
    .sort((a, b) => (a.closedAt < b.closedAt ? -1 : 1));
}

function status(all) {
  const trades = forwardTrades(all);
  let eq = 0;
  let peak = 0;
  let stoppedAt = null;
  for (let i = 0; i < Math.min(trades.length, RULES.minTrades); i++) {
    eq += trades[i].r;
    peak = Math.max(peak, eq);
    if (peak - eq >= RULES.maxDd) {
      stoppedAt = i + 1;
      break;
    }
  }
  const judged = trades.slice(0, stoppedAt ?? RULES.minTrades);
  const m = metrics(judged);
  const reasons = [];
  let verdict = 'جارٍ';
  if (stoppedAt) {
    verdict = 'فشل';
    reasons.push(`التراجع وصل ${RULES.maxDd}R بعد ${stoppedAt} صفقة (إيقاف مبكر، يجب التحقيق في السبب)`);
  } else if (judged.length >= RULES.minTrades) {
    if (!(m.net > 0)) reasons.push(`الصافي ${m.net.toFixed(2)}R غير موجب`);
    if (!(m.pf >= RULES.minPf)) reasons.push(`PF ${m.pf.toFixed(2)} أقل من ${RULES.minPf}`);
    if (!(m.maxDd < RULES.maxDd)) reasons.push(`التراجع ${m.maxDd.toFixed(1)}R`);
    verdict = reasons.length ? 'فشل' : 'نجح';
  }
  const bySymbol = Object.fromEntries(Object.keys(RULES.markets).map((s) => [s, metrics(judged.filter((t) => t.symbol === s))]));
  const open = all.filter((t) => inTest(t) && !t.closed).length;
  return { trades, judged, m, bySymbol, verdict, reasons, open };
}

// المطابقة: الإشارات المتوقعة من القواعد (بيانات Yahoo) مقابل ما سجّله البوت
function compareSignals(all, candlesBySymbol) {
  const out = {};
  for (const [symbol, spec] of Object.entries(RULES.markets)) {
    const candles = candlesBySymbol[symbol];
    if (!candles) continue;
    const expected = runRsi2Windowed(candles, { from: RULES.from, spreadPct: spec.spreadPct, window: RULES.window }).map((t) => t.time);
    // آخر صفقة متوقعة قد تكون مفتوحة بعد، فنضيف الدخول المفتوح أيضاً
    const last = runRsi2Windowed([...candles, { ...candles.at(-1), time: '9999-12-31', open: Infinity, high: Infinity, low: -Infinity, close: Infinity }], { from: RULES.from, spreadPct: spec.spreadPct, window: RULES.window });
    for (const t of last) if (!expected.includes(t.time) && t.time !== '9999-12-31') expected.push(t.time);
    const bot = all.filter((t) => t.symbol === symbol && inTest(t)).map((t) => day(t.time));
    const lastDay = candles.at(-1).time;
    out[symbol] = {
      missing: expected.filter((d) => !bot.includes(d)),
      extra: bot.filter((d) => !expected.includes(d) && d <= lastDay),
      matched: expected.filter((d) => bot.includes(d)).length,
    };
  }
  return out;
}

function report(s, cmp) {
  const pf = (x) => (x.n === 0 ? '—' : Number.isFinite(x.pf) ? x.pf.toFixed(2) : '∞');
  const sgn = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
  const row = (label, x) => `${label}: ${x.n} صفقة | ربح ${x.winRate.toFixed(0)}% | PF ${pf(x)} | ${sgn(x.net)}R | تراجع ${x.maxDd.toFixed(1)}R`;
  const L = [
    'الاختبار المستقبلي — المؤشرات RSI(2): NASDAQ 100 و S&P 500 و Dow Jones (الشروط في docs/FORWARD-TEST-INDICES.md، مسجلة 2026-11-16)',
    `من ${RULES.from} | صفقات مغلقة ${s.trades.length} من ${RULES.minTrades} | مفتوحة ${s.open}`,
    `النتائج بعد خصم السبريد و Swap ${RULES.swapPctPerNight}% لكل ليلة`,
    '',
    row('المجموع', s.m),
    ...Object.entries(s.bySymbol).map(([k, x]) => row(k, x)),
    '',
    `الحالة: ${s.verdict === 'جارٍ' ? '⏳ جارٍ — لا حكم قبل 30 صفقة' : s.verdict === 'نجح' ? '✅ نجح' : '❌ فشل'}`,
    ...s.reasons.map((r) => `  • ${r}`),
    '',
    'المطابقة مع القواعد (بيانات Yahoo):',
  ];
  if (!cmp) L.push('  ⚠️ لم أستطع جلب بيانات Yahoo (الإنترنت؟). أعد المحاولة لاحقاً.');
  else
    for (const [k, c] of Object.entries(cmp)) {
      const ok = !c.missing.length && !c.extra.length;
      L.push(`  ${ok ? '✅' : '⚠️'} ${k}: متطابقة ${c.matched}${c.missing.length ? ` | ناقصة عند البوت: ${c.missing.join('، ')}` : ''}${c.extra.length ? ` | زائدة عند البوت: ${c.extra.join('، ')}` : ''}`);
    }
  if (s.trades.length) {
    L.push('', 'آخر الصفقات:');
    for (const t of s.trades.slice(-10)) L.push(`  ${t.time} ${t.symbol} → ${sgn(t.rawR)}R قبل التكاليف، ${sgn(t.r)}R بعدها`);
  }
  L.push('', 'للمعلومة فقط. لا تداول أثناء الاختبار.');
  return L.join('\n');
}

async function main() {
  let all = [];
  try {
    all = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
  } catch {
    console.log('لم أجد سجل صفقات البوت (gold-forex-signals-bot/data/trades.json).');
  }
  let cmp = null;
  try {
    const { fetchDaily } = require('../../kc-nasdaq-daily/src/data');
    const candles = {};
    for (const [symbol, spec] of Object.entries(RULES.markets)) candles[symbol] = await fetchDaily(spec.ticker, '2025-01-01');
    cmp = compareSignals(all, candles);
  } catch {
    cmp = null;
  }
  console.log(report(status(all), cmp));
}

if (require.main === module) main();

module.exports = { RULES, forwardTrades, status, compareSignals, report, ndxConfig };
