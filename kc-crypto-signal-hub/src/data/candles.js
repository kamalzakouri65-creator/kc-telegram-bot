// صيغة الشمعة الموحدة: { openTime, closeTime, open, high, low, close, volume } والأوقات بالميلي ثانية (UTC)

// صف Binance: [openTime, open, high, low, close, volume, closeTime, ...]
function parseKline(k) {
  return {
    openTime: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closeTime: k[6],
  };
}

// الشموع المغلقة فقط: الشمعة التي لم يمر وقت إغلاقها بعد ما زالت تتغير
const closedOnly = (candles, now) => candles.filter((c) => c.closeTime < now);

// فهرس آخر شمعة أُغلقت عند الوقت t أو قبله، أو -1
function lastClosedIndex(candles, t) {
  let lo = 0;
  let hi = candles.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].closeTime <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

// تجميع شموع صغيرة إلى إطار أكبر (للاختبارات)، مثل 3 × M5 = M15
function aggregate(candles, intervalMs) {
  const out = [];
  for (const c of candles) {
    const openTime = Math.floor(c.openTime / intervalMs) * intervalMs;
    const last = out.at(-1);
    if (last && last.openTime === openTime) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else {
      out.push({ ...c, openTime, closeTime: openTime + intervalMs - 1 });
    }
  }
  return out;
}

// إزالة التكرار وترتيب الشموع حسب الوقت (عند دمج دفعات من Binance)
function mergeCandles(...lists) {
  const byTime = new Map();
  for (const list of lists) for (const c of list) byTime.set(c.openTime, c);
  return [...byTime.values()].sort((a, b) => a.openTime - b.openTime);
}

module.exports = { parseKline, closedOnly, lastClosedIndex, aggregate, mergeCandles };
