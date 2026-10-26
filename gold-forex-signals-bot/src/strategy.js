const { ema, rsi, macd, atr } = require('./indicators');

const MIN_CANDLES = 210;

// يحلل الشموع ويُرجع إشارة BUY أو SELL أو null.
// الشروط:
//   - الاتجاه: EMA50 فوق EMA200 للشراء (وتحته للبيع)، والسعر في نفس الجهة من EMA50
//   - الزخم: تقاطع MACD مع خط الإشارة في آخر شمعة مغلقة
//   - التصفية: RSI بين 50 و70 للشراء، وبين 30 و50 للبيع (تجنّب التشبع)
// وقف الخسارة = 1.5 × ATR والهدفان = 1.5 × و 3 × المخاطرة
function analyze(candles, opts = {}) {
  const slMult = opts.slAtrMultiplier ?? 1.5;
  if (candles.length < MIN_CANDLES) return null;

  const closes = candles.map((c) => c.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsi14 = rsi(closes, 14);
  const m = macd(closes);
  const atr14 = atr(candles, 14);

  const i = candles.length - 1;
  const p = i - 1;
  const price = closes[i];

  const crossedUp = m.line[p] <= m.signal[p] && m.line[i] > m.signal[i];
  const crossedDown = m.line[p] >= m.signal[p] && m.line[i] < m.signal[i];
  const upTrend = ema50[i] > ema200[i] && price > ema50[i];
  const downTrend = ema50[i] < ema200[i] && price < ema50[i];

  let side = null;
  if (upTrend && crossedUp && rsi14[i] > 50 && rsi14[i] < 70) side = 'BUY';
  else if (downTrend && crossedDown && rsi14[i] < 50 && rsi14[i] > 30) side = 'SELL';
  if (!side) return null;

  const risk = atr14[i] * slMult;
  const dir = side === 'BUY' ? 1 : -1;
  return {
    side,
    time: candles[i].time,
    entry: price,
    stopLoss: price - dir * risk,
    takeProfit1: price + dir * risk * 1.5,
    takeProfit2: price + dir * risk * 3,
    rsi: rsi14[i],
    ema50: ema50[i],
    ema200: ema200[i],
    atr: atr14[i],
  };
}

// ملخص الحالة الحالية للسوق (للأمر /status) بغض النظر عن وجود إشارة
function snapshot(candles) {
  if (candles.length < MIN_CANDLES) return null;
  const closes = candles.map((c) => c.close);
  const i = closes.length - 1;
  const ema50 = ema(closes, 50)[i];
  const ema200 = ema(closes, 200)[i];
  const m = macd(closes);
  return {
    price: closes[i],
    time: candles[i].time,
    rsi: rsi(closes, 14)[i],
    trend: ema50 > ema200 ? 'صاعد' : 'هابط',
    macdAbove: m.line[i] > m.signal[i],
  };
}

module.exports = { analyze, snapshot, MIN_CANDLES };
