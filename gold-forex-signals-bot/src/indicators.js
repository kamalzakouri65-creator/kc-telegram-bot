// مؤشرات التحليل الفني. كل دالة تُرجع مصفوفة بنفس طول المدخلات،
// والقيم التي لا تكفي البيانات لحسابها تكون null.

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// RSI بطريقة Wilder
function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(diff, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-diff, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const line = values.map((_, i) =>
    fastEma[i] === null || slowEma[i] === null ? null : fastEma[i] - slowEma[i]
  );
  const start = line.findIndex((v) => v !== null);
  const signal = new Array(values.length).fill(null);
  if (start !== -1) {
    const sig = ema(line.slice(start), signalPeriod);
    sig.forEach((v, i) => {
      signal[start + i] = v;
    });
  }
  const histogram = line.map((v, i) =>
    v === null || signal[i] === null ? null : v - signal[i]
  );
  return { line, signal, histogram };
}

// متوسط المدى الحقيقي (ATR) بطريقة Wilder، يُستخدم لحساب وقف الخسارة والهدف
function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  let prev = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

module.exports = { ema, rsi, macd, atr };
