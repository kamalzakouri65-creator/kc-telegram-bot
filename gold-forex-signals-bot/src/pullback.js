const { ema, rsi, atr } = require('./indicators');

const MIN_CANDLES = 210;

// استراتيجية التصحيح (Pullback): الدخول مع الاتجاه بعد أن يرجع السعر إلى EMA50.
//   شراء: EMA50 فوق EMA200 وEMA50 صاعد، لمس السعر EMA50 في آخر 3 شموع دون أن يغلق تحت EMA200،
//         ثم شمعة صاعدة تغلق فوق EMA50 وفوق أعلى سعر في الشمعة السابقة (عودة الزخم). والبيع عكسه.
//   الوقف تحت أدنى سعر في آخر 5 شموع بهامش 0.25 × ATR، والهدفان 1.5 × و 3 × المخاطرة.
function analyzePullback(candles, options = {}) {
  const opts = { touchLookback: 3, swingLookback: 5, slBufferAtr: 0.25, maxRiskAtr: 3, tp1R: 1.5, tp2R: 3, ...options };
  if (candles.length < MIN_CANDLES) return null;

  const closes = candles.map((c) => c.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(candles, 14);
  const i = candles.length - 1;

  // هل الشمعة j تحقق شرط الدخول في الاتجاه dir؟
  const triggers = (j, dir) => {
    const c = candles[j];
    const prev = candles[j - 1];
    const trend = dir * (ema50[j] - ema200[j]) > 0 && dir * (ema50[j] - ema50[j - 10]) > 0;
    if (!trend) return false;
    let touched = false;
    for (let k = j - opts.touchLookback + 1; k <= j; k++) {
      const reached = dir === 1 ? candles[k].low <= ema50[k] : candles[k].high >= ema50[k];
      const held = dir * (candles[k].close - ema200[k]) > 0;
      if (!held) return false;
      if (reached) touched = true;
    }
    const resumed = dir * (c.close - c.open) > 0 && dir * (c.close - ema50[j]) > 0 && dir * (c.close - (dir === 1 ? prev.high : prev.low)) > 0;
    return touched && resumed;
  };

  for (const dir of [1, -1]) {
    // نرسل الإشارة على أول شمعة تحقق الشرط فقط، حتى لا تتكرر على الشموع التالية
    if (!triggers(i, dir) || triggers(i - 1, dir)) continue;

    const recent = candles.slice(i - opts.swingLookback + 1, i + 1);
    const extreme = dir === 1 ? Math.min(...recent.map((c) => c.low)) : Math.max(...recent.map((c) => c.high));
    const stopLoss = extreme - dir * opts.slBufferAtr * atr14[i];
    const entry = closes[i];
    const risk = dir * (entry - stopLoss);
    if (!(risk > 0) || risk > opts.maxRiskAtr * atr14[i]) continue;

    return {
      side: dir === 1 ? 'BUY' : 'SELL',
      time: candles[i].time,
      entry,
      stopLoss,
      takeProfit1: entry + dir * risk * opts.tp1R,
      takeProfit2: entry + dir * risk * opts.tp2R,
      rsi: rsi14[i],
      atr: atr14[i],
    };
  }
  return null;
}

module.exports = { analyzePullback };
