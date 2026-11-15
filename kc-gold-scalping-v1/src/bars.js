// تجهيز البيانات بدون نظر للمستقبل:
//  - حذف شموع أوقات الإغلاق (شموع العطلة المجمّدة والاستراحة اليومية).
//  - بناء M5 و M15 من M1. كل شمعة أعلى لها availIdx: أول شمعة M1 تكون عندها الشمعة الأعلى مغلقة ومعروفة.
//  - القمم والقيعان مع confirmIdx: أول شمعة M1 يكون عندها الـ pivot مؤكداً (بعد إغلاق 3 شموع بعده).
const { marketClosed, toMs } = require('./hours');

function prepareM1(raw) {
  return raw
    .map((c) => ({ ...c, ms: toMs(c.time) }))
    .filter((c) => !marketClosed(c.ms))
    .sort((a, b) => a.ms - b.ms);
}

function aggregate(m1, minutes) {
  const size = minutes * 60000;
  const bars = [];
  for (let i = 0; i < m1.length; i++) {
    const c = m1[i];
    const bucket = Math.floor(c.ms / size) * size;
    const last = bars.at(-1);
    if (last && last.ms === bucket) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.lastIdx = i;
    } else bars.push({ ms: bucket, open: c.open, high: c.high, low: c.low, close: c.close, firstIdx: i, lastIdx: i });
  }
  // الشمعة معروفة عند إغلاق آخر دقيقة فيها إذا اكتمل وقتها، وإلا عند أول دقيقة من الشمعة التالية
  for (let k = 0; k < bars.length; k++) {
    const b = bars[k];
    const complete = m1[b.lastIdx].ms + 60000 >= b.ms + size;
    b.availIdx = complete || k === bars.length - 1 ? b.lastIdx : bars[k + 1].firstIdx;
  }
  return bars;
}

function atr(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  let v = null;
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
    v = i <= n ? (v ?? 0) + tr / n : (v * (n - 1) + tr) / n;
    if (i >= n) out[i] = v;
  }
  return out;
}

// confirmAt(j): مؤشر M1 الذي يصبح فيه الـ pivot عند j مؤكداً
function pivots(bars, L, confirmAt) {
  const highs = [];
  const lows = [];
  for (let j = L; j < bars.length - L; j++) {
    let hi = true;
    let lo = true;
    for (let k = 1; k <= L; k++) {
      if (!(bars[j].high > bars[j - k].high && bars[j].high >= bars[j + k].high)) hi = false;
      if (!(bars[j].low < bars[j - k].low && bars[j].low <= bars[j + k].low)) lo = false;
    }
    if (hi) highs.push({ j, price: bars[j].high, confirmIdx: confirmAt(j + L) });
    if (lo) lows.push({ j, price: bars[j].low, confirmIdx: confirmAt(j + L) });
  }
  return { highs, lows };
}

// عدد العناصر التي confirmIdx لها ≤ i (القائمة مرتبة)
function countConfirmed(list, i) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].confirmIdx <= i) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function prepare(raw, L) {
  const m1 = prepareM1(raw);
  const m5 = aggregate(m1, 5);
  const m15 = aggregate(m1, 15);
  return {
    m1,
    m5,
    m15,
    atrM1: atr(m1),
    pivM1: pivots(m1, L, (k) => k),
    pivM5: pivots(m5, L, (k) => m5[k].availIdx),
    pivM15: pivots(m15, L, (k) => m15[k].availIdx),
  };
}

module.exports = { prepare, prepareM1, aggregate, atr, pivots, countConfirmed };
