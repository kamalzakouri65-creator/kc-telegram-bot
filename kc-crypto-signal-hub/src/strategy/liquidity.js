const { lastConfirmed } = require('./structure');

// سحب سيولة صاعد قبل الشمعة k: شمعة s ينزل ذيلها تحت قاع مؤكد سابق ثم تغلق فوقه (استرجاع).
// نأخذ أحدث سحب ضمن آخر lookback شمعة، والقاع المسحوب يجب أن يكون مؤكداً قبل شمعة السحب.
function sweepBefore(candles, piv, k, lookback) {
  for (let s = k - 1; s >= Math.max(1, k - lookback); s--) {
    const [swing] = lastConfirmed(piv.lows, s - 1, 1);
    if (!swing) continue;
    if (candles[s].low < swing.price && candles[s].close > swing.price) {
      let sweepLow = Infinity;
      for (let t = s; t <= k; t++) sweepLow = Math.min(sweepLow, candles[t].low);
      return { index: s, sweptLevel: swing.price, sweepLow };
    }
  }
  return null;
}

module.exports = { sweepBefore };
