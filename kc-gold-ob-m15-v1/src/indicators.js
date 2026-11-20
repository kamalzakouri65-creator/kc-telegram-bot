// كل مؤشر عند الشمعة i يستعمل الشموع 0..i فقط (لا نظر للمستقبل).
// ATR Wilder: البداية متوسط أول n من True Range، ثم ATR = (ATR السابق × (n−1) + TR) ÷ n
function atr(bars, n) {
  const out = new Array(bars.c.length).fill(NaN);
  let sum = 0;
  let prev = NaN;
  for (let i = 0; i < bars.c.length; i++) {
    const tr = i === 0 ? bars.h[i] - bars.l[i] : Math.max(bars.h[i] - bars.l[i], Math.abs(bars.h[i] - bars.c[i - 1]), Math.abs(bars.l[i] - bars.c[i - 1]));
    if (i < n) {
      sum += tr;
      if (i === n - 1) prev = out[i] = sum / n;
    } else prev = out[i] = (prev * (n - 1) + tr) / n;
  }
  return out;
}
// EMA على الإغلاق: البداية متوسط بسيط لأول n، ثم k = 2 ÷ (n + 1)
function ema(values, n) {
  const out = new Array(values.length).fill(NaN);
  const k = 2 / (n + 1);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < n) {
      sum += values[i];
      if (i === n - 1) out[i] = sum / n;
    } else out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}
// قمة عند j: أعلى (بشكل صارم) من p شموع قبلها و p بعدها. لا تُعرف إلا بعد إغلاق الشمعة j + p.
function isPivotHigh(bars, j, p) {
  if (j - p < 0 || j + p >= bars.h.length) return false;
  for (let d = 1; d <= p; d++) if (!(bars.h[j] > bars.h[j - d] && bars.h[j] > bars.h[j + d])) return false;
  return true;
}
function isPivotLow(bars, j, p) {
  if (j - p < 0 || j + p >= bars.l.length) return false;
  for (let d = 1; d <= p; d++) if (!(bars.l[j] < bars.l[j - d] && bars.l[j] < bars.l[j + d])) return false;
  return true;
}
module.exports = { atr, ema, isPivotHigh, isPivotLow };
