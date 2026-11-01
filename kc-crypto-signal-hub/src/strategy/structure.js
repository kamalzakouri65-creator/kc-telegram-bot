// هيكل السوق: القمم والقيعان (Swing)، الاتجاه HH/HL، وكسر الهيكل BOS / CHoCH.
// القمة عند الشمعة j لا تُعرف إلا بعد إغلاق L شمعة بعدها، فنحفظ وقت تأكيدها (confirmedAt = j + L)
// ولا نستعملها قبل ذلك. هكذا لا يوجد أي نظر للمستقبل.

function pivots(candles, L) {
  const highs = [];
  const lows = [];
  for (let j = L; j < candles.length - L; j++) {
    let isHigh = true;
    let isLow = true;
    for (let d = 1; d <= L; d++) {
      if (candles[j - d].high >= candles[j].high || candles[j + d].high > candles[j].high) isHigh = false;
      if (candles[j - d].low <= candles[j].low || candles[j + d].low < candles[j].low) isLow = false;
    }
    if (isHigh) highs.push({ index: j, price: candles[j].high, confirmedAt: j + L });
    if (isLow) lows.push({ index: j, price: candles[j].low, confirmedAt: j + L });
  }
  return { highs, lows };
}

// عدد القمم/القيعان المؤكدة عند الفهرس idx أو قبله (القائمة مرتبة حسب confirmedAt)
function confirmedCount(list, idx) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].confirmedAt <= idx) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// آخر n قمم/قيعان مؤكدة عند idx
function lastConfirmed(list, idx, n = 1) {
  const count = confirmedCount(list, idx);
  return list.slice(Math.max(0, count - n), count);
}

// اتجاه الهيكل عند idx: صاعد إذا آخر قمتين وآخر قاعين متصاعدة (HH و HL)
function trendAt(piv, idx) {
  const [h1, h2] = lastConfirmed(piv.highs, idx, 2);
  const [l1, l2] = lastConfirmed(piv.lows, idx, 2);
  if (!h2 || !l2) return 'unknown';
  if (h2.price > h1.price && l2.price > l1.price) return 'bullish';
  if (h2.price < h1.price && l2.price < l1.price) return 'bearish';
  return 'range';
}

// كسر هيكل صاعد عند الشمعة k: تغلق فوق آخر قمة مؤكدة قبلها، والشمعة السابقة لم تغلق فوقها.
// يكون CHoCH إذا كان الهيكل قبله هابطاً (أول كسر عكس الاتجاه)، وإلا فهو BOS.
function bullishBreakAt(candles, piv, k) {
  if (k < 1) return null;
  const [swing] = lastConfirmed(piv.highs, k - 1, 1);
  if (!swing) return null;
  if (!(candles[k].close > swing.price && candles[k - 1].close <= swing.price)) return null;
  return { index: k, level: swing.price, swingIndex: swing.index, kind: trendAt(piv, k - 1) === 'bearish' ? 'CHoCH' : 'BOS' };
}

module.exports = { pivots, confirmedCount, lastConfirmed, trendAt, bullishBreakAt };
