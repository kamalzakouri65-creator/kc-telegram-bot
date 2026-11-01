// تأكيد الدخول على M5 (على شمعة مغلقة فقط)

// ابتلاع صاعد: شمعة صاعدة تبتلع جسم الشمعة الهابطة قبلها
function bullishEngulfing(candles, i) {
  if (i < 1) return false;
  const c = candles[i];
  const p = candles[i - 1];
  return c.close > c.open && p.close < p.open && c.close >= p.open && c.open <= p.close;
}

// اختراق: إغلاق فوق أعلى سعر في آخر n شموع
function bullishBreakout(candles, i, n) {
  if (i < n) return false;
  let high = -Infinity;
  for (let t = i - n; t < i; t++) high = Math.max(high, candles[t].high);
  return candles[i].close > candles[i].open && candles[i].close > high;
}

// فلتر الحجم: حجم شمعة التأكيد أكبر من متوسط حجم آخر 20 شمعة قبلها
function volumeRatio(candles, volSma, i) {
  const avg = volSma[i - 1];
  return avg ? candles[i].volume / avg : 0;
}

function m5Confirmation(candles, volSma, i, breakoutLookback) {
  const engulfing = bullishEngulfing(candles, i);
  const breakout = bullishBreakout(candles, i, breakoutLookback);
  const ratio = volumeRatio(candles, volSma, i);
  return {
    pattern: engulfing ? 'engulfing' : breakout ? 'breakout' : null,
    volumeRatio: ratio,
    volumeOk: ratio > 1,
  };
}

module.exports = { bullishEngulfing, bullishBreakout, volumeRatio, m5Confirmation };
