// نفس إدارة الصفقة في اختبار البوت (src/backtest.js) بالضبط: الإشارة على شمعة مغلقة، المتابعة من الشمعة التالية،
// نصف عند الهدف 1 ونصف عند الهدف 2، الوقف ثابت، الوقف أولاً عند التعارض، ولا إشارة جديدة على شمعة الإغلاق.
// الإضافة الوحيدة: حجم النافذة قابل للتغيير، والتكاليف (سبريد + انزلاق + Swap لكل ليلة).
const { HOUR } = require('./hours');

// عدد مرات المرور على 21:00 UTC (وقت احتساب Swap تقريباً) بين الدخول والخروج
function nightsHeld(entryMs, exitMs) {
  let n = 0;
  let t = Math.floor(entryMs / (24 * HOUR)) * 24 * HOUR + 21 * HOUR;
  if (t <= entryMs) t += 24 * HOUR;
  for (; t <= exitMs; t += 24 * HOUR) n++;
  return n;
}

function run(candles, analyzeFn, { window = 500, spread = 0, slippage = 0, swapPctPerNight = 0, from = '0000', to = '9999' } = {}) {
  const trades = [];
  let open = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (open) {
      const dir = open.side === 'BUY' ? 1 : -1;
      const risk = dir * (open.entry - open.stopLoss);
      const stopHit = dir === 1 ? c.low <= open.stopLoss : c.high >= open.stopLoss;
      for (const half of open.halves) {
        if (half.result !== null) continue;
        const targetHit = dir === 1 ? c.high >= half.target : c.low <= half.target;
        if (stopHit) half.result = -1;
        else if (targetHit) half.result = (dir * (half.target - open.entry)) / risk;
      }
      if (open.halves.every((h) => h.result !== null)) {
        const gross = open.halves.reduce((s, h) => s + h.result, 0) / open.halves.length;
        const nights = nightsHeld(open.ms, c.ms + HOUR - 1);
        const cost = (spread + slippage + (open.entry * swapPctPerNight * nights) / 100) / risk;
        trades.push({ side: open.side, time: open.time, closedAt: c.time, year: open.time.slice(0, 4), r: gross - cost, gross, nights });
        open = null;
      }
      continue;
    }
    if (c.time < from || c.time > to) continue;
    const s = analyzeFn(candles.slice(Math.max(0, i + 1 - window), i + 1));
    if (s) open = { ...s, ms: c.ms, halves: [{ target: s.takeProfit1, result: null }, { target: s.takeProfit2, result: null }] };
  }
  return trades;
}

function metrics(trades) {
  let eq = 0;
  let peak = 0;
  let dd = 0;
  let streak = 0;
  let worst = 0;
  for (const t of trades) {
    eq += t.r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
    streak = t.r < 0 ? streak + 1 : 0;
    worst = Math.max(worst, streak);
  }
  const wins = trades.filter((t) => t.r > 0);
  const gw = wins.reduce((s, t) => s + t.r, 0);
  const gl = -trades.filter((t) => t.r < 0).reduce((s, t) => s + t.r, 0);
  return { n: trades.length, winRate: trades.length ? (wins.length / trades.length) * 100 : 0, pf: gl ? gw / gl : trades.length && gw > 0 ? Infinity : 0, net: eq, maxDd: dd, exp: trades.length ? eq / trades.length : 0, worst };
}

module.exports = { run, metrics, nightsHeld };
