// محاكاة اختراق نطاق الافتتاح يوماً بيوم. الشموع: { time: 'YYYY-MM-DD HH:MM:SS' بتوقيت نيويورك, open, high, low, close }
const { config } = require('./config');

const dayOf = (c) => c.time.slice(0, 10);
const clockOf = (c) => c.time.slice(11, 16);

function groupByDay(candles) {
  const days = new Map();
  for (const c of candles) {
    const d = dayOf(c);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(c);
  }
  return [...days.entries()].map(([date, bars]) => ({ date, bars: bars.sort((a, b) => (a.time < b.time ? -1 : 1)) }));
}

// يوم واحد: يُرجع صفقة أو { skip: السبب } أو null إذا لم يحدث اختراق
function simulateDay(bars, rules = config.rules, costs = config.costs) {
  if (!bars.length || clockOf(bars[0]) !== rules.sessionOpen) return { skip: 'اليوم لا يبدأ عند الافتتاح' };
  const rangeBars = rules.rangeMinutes / 15;
  if (bars.length <= rangeBars) return { skip: 'شموع قليلة' };
  const range = bars.slice(0, rangeBars);
  const high = Math.max(...range.map((b) => b.high));
  const low = Math.min(...range.map((b) => b.low));
  const mid = (high + low) / 2;

  for (let i = rangeBars; i < bars.length; i++) {
    const b = bars[i];
    if (clockOf(b) > rules.lastEntryBarStart) break;
    const dir = b.close > high ? 1 : b.close < low ? -1 : 0;
    if (!dir) continue;

    const entry = b.close;
    const risk = dir * (entry - mid);
    const target = entry + dir * rules.rewardRisk * risk;
    let exit = null;
    let outcome = 'close';
    let exitTime = null;
    for (let j = i + 1; j < bars.length; j++) {
      const x = bars[j];
      const stopHit = dir === 1 ? x.low <= mid : x.high >= mid;
      const targetHit = dir === 1 ? x.high >= target : x.low <= target;
      if (stopHit) [exit, outcome, exitTime] = [mid, 'stop', x.time];
      else if (targetHit) [exit, outcome, exitTime] = [target, 'target', x.time];
      if (exit !== null) break;
    }
    if (exit === null) [exit, exitTime] = [bars.at(-1).close, bars.at(-1).time];
    const spread = (entry * costs.spreadPct) / 100;
    const r = (dir * (exit - entry) - spread) / risk;
    return { date: dayOf(b), side: dir === 1 ? 'BUY' : 'SELL', entryTime: b.time, entry, stopLoss: mid, target, rangeHigh: high, rangeLow: low, exit, exitTime, outcome, r };
  }
  return null;
}

function runBacktest(candles, opts = {}) {
  const trades = [];
  const skipped = [];
  const days = groupByDay(candles);
  for (const { date, bars } of days) {
    const t = simulateDay(bars, opts.rules, opts.costs);
    if (t?.skip) skipped.push({ date, reason: t.skip });
    else if (t) trades.push(t);
  }
  return { trades, skipped, days: days.map((d) => d.date) };
}

module.exports = { simulateDay, runBacktest, groupByDay };
