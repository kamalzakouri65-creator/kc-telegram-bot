// حالة الاختبار المستقبلي (docs/FORWARD-TEST.md). يقرأ سجل صفقات البوت فقط ولا يكتب فيه.
const fs = require('fs');
const path = require('path');
const { metrics, nightsHeld } = require('./engine');

const RULES = {
  symbol: 'XAU/USD',
  interval: '4h',
  strategies: { 'ema-macd': 'EMA + MACD', pullback: 'Pullback' },
  from: '2026-11-16 00:00:00',
  spread: 0.24,
  slippage: 0.1,
  swapPctPerNight: 0.02,
  minTrades: 30,
  minPf: 1.2,
  minPfEach: 1.0,
  maxDd: 10,
};
const TRADES_FILE = path.join(__dirname, '..', '..', 'gold-forex-signals-bot', 'data', 'trades.json');
const H4 = 4 * 3600000;
const ms = (t) => Date.parse(t.replace(' ', 'T') + 'Z');

// صفقات الاختبار المغلقة بعد خصم التكاليف، مرتبة بوقت الإغلاق
function forwardTrades(all) {
  return all
    .filter((t) => t.symbol === RULES.symbol && t.interval === RULES.interval && (t.strategy ?? 'ema-macd') in RULES.strategies && t.time >= RULES.from && t.closed)
    .map((t) => {
      const risk = Math.abs(t.entry - t.stopLoss);
      const nights = nightsHeld(ms(t.time) + H4, ms(t.closedAt) + H4 - 1);
      const cost = (RULES.spread + RULES.slippage + (t.entry * RULES.swapPctPerNight * nights) / 100) / risk;
      return { time: t.time, closedAt: t.closedAt, side: t.side, strategy: t.strategy ?? 'ema-macd', rawR: t.r, r: t.r - cost };
    })
    .sort((a, b) => (a.closedAt < b.closedAt ? -1 : 1));
}

function status(all) {
  const trades = forwardTrades(all);
  // التراجع لحظة بلحظة: أول مرة يصل 10R قبل اكتمال 30 صفقة = إيقاف مبكر
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
  const each = Object.fromEntries(Object.keys(RULES.strategies).map((k) => [k, metrics(judged.filter((t) => t.strategy === k))]));
  let verdict = 'جارٍ';
  const reasons = [];
  if (stoppedAt) {
    verdict = 'فشل';
    reasons.push(`التراجع وصل ${RULES.maxDd}R بعد ${stoppedAt} صفقة (إيقاف مبكر)`);
  } else if (judged.length >= RULES.minTrades) {
    if (!(m.pf >= RULES.minPf)) reasons.push(`PF ${m.pf.toFixed(2)} أقل من ${RULES.minPf}`);
    if (!(m.net > 0)) reasons.push(`الصافي ${m.net.toFixed(2)}R غير موجب`);
    for (const [k, e] of Object.entries(each)) if (e.n && !(e.pf >= RULES.minPfEach)) reasons.push(`${RULES.strategies[k]}: PF ${e.pf.toFixed(2)} أقل من ${RULES.minPfEach}`);
    if (!(m.maxDd < RULES.maxDd)) reasons.push(`التراجع ${m.maxDd.toFixed(1)}R`);
    verdict = reasons.length ? 'فشل' : 'نجح';
  }
  const open = all.filter((t) => t.symbol === RULES.symbol && t.interval === RULES.interval && (t.strategy ?? 'ema-macd') in RULES.strategies && t.time >= RULES.from && !t.closed).length;
  return { trades, judged, m, each, verdict, reasons, open };
}

function report(s) {
  const pf = (x) => (x.n === 0 ? '—' : Number.isFinite(x.pf) ? x.pf.toFixed(2) : '∞');
  const sgn = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
  const row = (label, x) => `${label}: ${x.n} صفقة | ربح ${x.winRate.toFixed(0)}% | PF ${pf(x)} | ${sgn(x.net)}R | تراجع ${x.maxDd.toFixed(1)}R`;
  const lines = [
    'الاختبار المستقبلي — الذهب 4h (الشروط في docs/FORWARD-TEST.md، مسجلة 2026-11-15)',
    `من ${RULES.from} UTC | صفقات مغلقة ${s.trades.length} من ${RULES.minTrades} | مفتوحة ${s.open}`,
    `النتائج بعد خصم التكاليف (سبريد ${RULES.spread} + انزلاق ${RULES.slippage} + Swap ${RULES.swapPctPerNight}% لكل ليلة)`,
    '',
    row('المجموع', s.m),
    ...Object.entries(s.each).map(([k, e]) => row(RULES.strategies[k], e)),
    '',
    `الحالة: ${s.verdict === 'جارٍ' ? '⏳ جارٍ — لا حكم قبل 30 صفقة' : s.verdict === 'نجح' ? '✅ نجح' : '❌ فشل'}`,
    ...s.reasons.map((r) => `  • ${r}`),
  ];
  if (s.trades.length) {
    lines.push('', 'آخر الصفقات:');
    for (const t of s.trades.slice(-10)) lines.push(`  ${t.time} ${t.side} ${RULES.strategies[t.strategy]} → ${sgn(t.rawR)}R قبل التكاليف، ${sgn(t.r)}R بعدها`);
  }
  lines.push('', 'للمعلومة فقط. لا تداول أثناء الاختبار.');
  return lines.join('\n');
}

if (require.main === module) {
  let all = [];
  try {
    all = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
  } catch {
    console.log('لم أجد سجل صفقات البوت (gold-forex-signals-bot/data/trades.json).');
  }
  console.log(report(status(all)));
}

module.exports = { RULES, forwardTrades, status, report };
