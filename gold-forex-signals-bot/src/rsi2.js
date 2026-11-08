// RSI(2) على المؤشرات الأمريكية، يومي، شراء فقط. نفس قواعد kc-nasdaq-daily التي اجتازت التطوير (2021–2026)
// والتأكيد (2005–2020) على Nasdaq 100 و S&P 500، والمؤشرات محسوبة بنفس الطريقة بالضبط.
//   الدخول: الإغلاق فوق متوسط 200 يوم، و RSI(2) أقل من 10.
//   الخروج: أول إغلاق فوق متوسط 5 أيام، أو بعد 10 أيام تداول. الوقف: الدخول − 2 × ATR(14).
const P = { smaTrend: 200, smaExit: 5, rsiPeriod: 2, entryBelow: 10, stopAtr: 2, maxBars: 10 };

function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  values.forEach((v, i) => {
    sum += v;
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  });
  return out;
}
function rsiWilder(closes, n) {
  const out = new Array(closes.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);
    if (i <= n) {
      gain += g / n;
      loss += l / n;
    } else {
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
    }
    if (i >= n) out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}
function atrWilder(c, n = 14) {
  const out = new Array(c.length).fill(null);
  let v = null;
  for (let i = 1; i < c.length; i++) {
    const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    v = i <= n ? (v ?? 0) + tr / n : (v * (n - 1) + tr) / n;
    if (i >= n) out[i] = v;
  }
  return out;
}

function analyzeRsi2(candles) {
  if (candles.length < P.smaTrend + 10) return null;
  const closes = candles.map((c) => c.close);
  const i = candles.length - 1;
  const trend = sma(closes, P.smaTrend)[i];
  const r = rsiWilder(closes, P.rsiPeriod)[i];
  const a = atrWilder(candles)[i];
  if (trend === null || r === null || a === null) return null;
  if (!(closes[i] > trend && r < P.entryBelow)) return null;
  return {
    side: 'BUY',
    time: candles[i].time,
    entry: closes[i],
    stopLoss: closes[i] - P.stopAtr * a,
    exitRule: { sma: P.smaExit, maxBars: P.maxBars },
    rsi: r,
    atr: a,
  };
}

module.exports = { analyzeRsi2, sma, rsiWilder, atrWilder, RSI2_PARAMS: P };
