// Silver Bullet و Previous Day High/Low. الشموع: { time: 'YYYY-MM-DD HH:MM:SS' بتوقيت نيويورك, open, high, low, close }
const { config } = require('./config');

const clockOf = (c) => c.time.slice(11, 16);
const dayOf = (c) => c.time.slice(0, 10);
const addMinutes = (clock, m) => {
  const t = Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3)) + m;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

// ATR(14) بطريقة Wilder، كل قيمة تعتمد على الشموع حتى تلك الشمعة فقط
function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  let prev = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const tr = i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close));
    if (i < period) {
      prev = (prev ?? 0) + tr / period;
      if (i === period - 1) out[i] = prev;
    } else {
      prev = (prev * (period - 1) + tr) / period;
      out[i] = prev;
    }
  }
  return out;
}

// متابعة صفقة من الشمعة from حتى آخر شمعة قبل exitClock في نفس اليوم. fillBar: شمعة التنفيذ (يُحسب فيها الوقف فقط)
function manage(candles, { dir, entry, stop, target, from, day, exitClock, fillBar = null, spread }) {
  const risk = dir * (entry - stop);
  let exit = null;
  let outcome = 'time';
  let exitTime = null;
  let last = null;
  if (fillBar !== null) {
    const b = candles[fillBar];
    if (dir === 1 ? b.low <= stop : b.high >= stop) [exit, outcome, exitTime] = [stop, 'stop', b.time];
    last = b;
  }
  for (let j = from; exit === null && j < candles.length; j++) {
    const b = candles[j];
    if (dayOf(b) !== day || clockOf(b) >= exitClock) break;
    last = b;
    const stopHit = dir === 1 ? b.low <= stop : b.high >= stop;
    const targetHit = dir === 1 ? b.high >= target : b.low <= target;
    if (stopHit) [exit, outcome, exitTime] = [stop, 'stop', b.time];
    else if (targetHit) [exit, outcome, exitTime] = [target, 'target', b.time];
  }
  if (exit === null) [exit, exitTime] = [last.close, last.time];
  return { exit, outcome, exitTime, r: (dir * (exit - entry) - spread) / risk };
}

function silverBullet(candles, opts = config.silverBullet, spread = config.spread) {
  const a = atr(candles);
  const trades = [];
  const byDayWindow = new Set();
  for (let k = 2; k < candles.length; k++) {
    const c = candles[k];
    const day = dayOf(c);
    const clock = clockOf(c);
    const w = opts.windows.find(([s, e]) => clock >= s && clock < e);
    if (!w || a[k] === null) continue;
    const key = `${day} ${w[0]}`;
    if (byDayWindow.has(key)) continue; // أول فجوة فقط في كل نافذة
    const bull = c.low - candles[k - 2].high;
    const bear = candles[k - 2].low - c.high;
    const dir = bull >= opts.minGapAtr * a[k] ? 1 : bear >= opts.minGapAtr * a[k] ? -1 : 0;
    if (!dir) continue;
    byDayWindow.add(key);
    const three = candles.slice(k - 2, k + 1);
    const near = dir === 1 ? c.low : c.high;
    const stop = dir === 1 ? Math.min(...three.map((x) => x.low)) : Math.max(...three.map((x) => x.high));
    const risk = dir * (near - stop);
    if (!(risk > 0)) continue;
    // أول رجوع إلى الفجوة داخل النافذة
    for (let j = k + 1; j < candles.length; j++) {
      const b = candles[j];
      if (dayOf(b) !== day || clockOf(b) >= w[1]) break;
      const filled = dir === 1 ? b.low <= near : b.high >= near;
      if (!filled) continue;
      const target = near + dir * opts.rewardRisk * risk;
      const res = manage(candles, { dir, entry: near, stop, target, from: j + 1, day, exitClock: addMinutes(w[1], opts.exitHoursAfterWindow * 60), fillBar: j, spread });
      trades.push({ date: day, window: w[0], side: dir === 1 ? 'BUY' : 'SELL', entryTime: b.time, entry: near, stopLoss: stop, target, ...res });
      break;
    }
  }
  return trades;
}

function groupByDay(candles) {
  const days = [];
  let cur = null;
  candles.forEach((c, i) => {
    const d = dayOf(c);
    if (!cur || cur.date !== d) days.push((cur = { date: d, from: i, to: i }));
    cur.to = i;
  });
  return days;
}

function previousDayLevels(candles, opts = config.pdhl, spread = config.spread) {
  const a = atr(candles);
  const trades = [];
  const days = groupByDay(candles);
  let prev = null;
  for (const d of days) {
    if (prev) {
      const bars = candles.slice(prev.from, prev.to + 1);
      const pdh = Math.max(...bars.map((b) => b.high));
      const pdl = Math.min(...bars.map((b) => b.low));
      for (let i = d.from; i <= d.to; i++) {
        const b = candles[i];
        const clock = clockOf(b);
        if (clock < opts.entryFrom || a[i] === null) continue;
        if (clock >= opts.entryTo) break;
        const sell = b.high > pdh && b.close < pdh;
        const buy = b.low < pdl && b.close > pdl;
        if (sell === buy) continue; // لا شيء، أو شمعة سحبت الطرفين
        const dir = buy ? 1 : -1;
        const entry = b.close;
        const stop = dir === 1 ? b.low - opts.stopBufferAtr * a[i] : b.high + opts.stopBufferAtr * a[i];
        const risk = dir * (entry - stop);
        const target = entry + dir * opts.rewardRisk * risk;
        const res = manage(candles, { dir, entry, stop, target, from: i + 1, day: d.date, exitClock: opts.exitAt, spread });
        trades.push({ date: d.date, side: dir === 1 ? 'BUY' : 'SELL', entryTime: b.time, entry, stopLoss: stop, target, level: dir === 1 ? pdl : pdh, ...res });
        break; // صفقة واحدة في اليوم
      }
    }
    if (d.to - d.from + 1 >= 48) prev = d; // يوم كامل فقط يصلح مرجعاً
  }
  return { trades, days: days.map((x) => x.date) };
}

module.exports = { silverBullet, previousDayLevels, atr, manage };
