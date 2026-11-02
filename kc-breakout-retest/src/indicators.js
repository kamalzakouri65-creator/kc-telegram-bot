// مؤشرات سببية: القيمة عند i تعتمد على الشموع 0..i فقط

// متوسط المدى الحقيقي بطريقة Wilder
function atr(candles, period) {
  const out = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr = candles.map((c, i) =>
    i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close))
  );
  let prev = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

// القمم والقيعان: الشمعة j قمة إذا كانت قمتها أعلى من قمم الشمعتين قبلها والشمعتين بعدها.
// لا تُعرف إلا بعد إغلاق الشمعتين اللاحقتين، فنحفظ confirmedAt = j + L ولا نستعملها قبله.
function swings(candles, L) {
  const highs = [];
  const lows = [];
  for (let j = L; j < candles.length - L; j++) {
    let isHigh = true;
    let isLow = true;
    for (let d = 1; d <= L; d++) {
      if (!(candles[j].high > candles[j - d].high && candles[j].high > candles[j + d].high)) isHigh = false;
      if (!(candles[j].low < candles[j - d].low && candles[j].low < candles[j + d].low)) isLow = false;
    }
    if (isHigh) highs.push({ index: j, price: candles[j].high, confirmedAt: j + L });
    if (isLow) lows.push({ index: j, price: candles[j].low, confirmedAt: j + L });
  }
  return { highs, lows };
}

module.exports = { atr, swings };
