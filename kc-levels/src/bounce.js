// (أ) الارتداد من الدعم والمقاومة — القواعد ثابتة قبل التشغيل (2026-11-12):
//   القاع: أدنى من 3 شموع قبله و 3 بعده، ولا يُعرف إلا بعد مرور 3 شموع (بدون نظر للمستقبل).
//   منطقة الدعم: قاعان مؤكدان على الأقل في آخر 100 شمعة، والفرق بينهما ≤ 0.5 × ATR.
//     المنطقة من أدنى قاع إلى أعلى قاع فيها. تُلغى إذا أُغلقت شمعة تحتها بعد آخر قاع فيها.
//   الدخول (شراء): الشمعة تلمس المنطقة (قاعها ≤ أعلى المنطقة) وتُغلق صاعدة فوقها،
//     وذيلها السفلي ≥ 50% من مداها (شمعة رفض). الدخول بسعر الإغلاق.
//   الوقف: تحت min(قاع الشمعة، أسفل المنطقة) بـ 0.25 × ATR، ويُلغى إذا كانت المخاطرة > 3 × ATR.
//   الهدفان: 1.5R و 3R (نفس إدارة البوت). البيع عكس ذلك تماماً عند المقاومة.
const { atr } = require('../../gold-forex-signals-bot/src/indicators');

const P = { pivot: 3, lookback: 100, clusterAtr: 0.5, wickPct: 50, slBufferAtr: 0.25, maxRiskAtr: 3, tp1R: 1.5, tp2R: 3 };
const MIN_CANDLES = 120;

// السعر مقلوب: نكتشف الشراء فقط، والبيع بقلب الشموع
const flip = (cs) => cs.map((c) => ({ ...c, open: -c.open, high: -c.low, low: -c.high, close: -c.close }));

function swingLows(cs, L) {
  const out = [];
  for (let j = L; j < cs.length - L; j++) {
    let ok = true;
    for (let k = 1; k <= L && ok; k++) if (!(cs[j].low < cs[j - k].low && cs[j].low <= cs[j + k].low)) ok = false;
    if (ok) out.push(j);
  }
  return out;
}

function bullishBounce(cs, a, p = P) {
  const i = cs.length - 1;
  const c = cs[i];
  if (a[i] == null) return null;
  // القيعان المؤكدة قبل الشمعة الحالية فقط
  const lows = swingLows(cs.slice(0, i), p.pivot).filter((j) => j >= i - p.lookback);
  let best = null;
  for (let x = lows.length - 1; x >= 0 && !best; x--) {
    for (let y = x - 1; y >= 0; y--) {
      const [j1, j2] = [lows[y], lows[x]];
      if (Math.abs(cs[j1].low - cs[j2].low) > p.clusterAtr * a[i]) continue;
      const bottom = Math.min(cs[j1].low, cs[j2].low);
      const top = Math.max(cs[j1].low, cs[j2].low);
      // المنطقة مكسورة إذا أُغلقت شمعة تحتها بعد آخر قاع
      let broken = false;
      for (let k = j2 + 1; k < i; k++) if (cs[k].close < bottom) broken = true;
      if (!broken) best = { bottom, top };
      break;
    }
  }
  if (!best) return null;
  const range = c.high - c.low;
  const wick = Math.min(c.open, c.close) - c.low;
  const touched = c.low <= best.top;
  const rejected = c.close > c.open && c.close > best.top && range > 0 && (wick / range) * 100 >= p.wickPct;
  if (!touched || !rejected) return null;
  const stopLoss = Math.min(c.low, best.bottom) - p.slBufferAtr * a[i];
  const risk = c.close - stopLoss;
  if (!(risk > 0) || risk > p.maxRiskAtr * a[i]) return null;
  return { side: 'BUY', time: c.time, entry: c.close, stopLoss, takeProfit1: c.close + p.tp1R * risk, takeProfit2: c.close + p.tp2R * risk, zone: best };
}

function analyzeBounce(candles) {
  if (candles.length < MIN_CANDLES) return null;
  const a = atr(candles, 14);
  const buy = bullishBounce(candles, a);
  if (buy) return buy;
  const s = bullishBounce(flip(candles), a);
  if (!s) return null;
  return { side: 'SELL', time: s.time, entry: -s.entry, stopLoss: -s.stopLoss, takeProfit1: -s.takeProfit1, takeProfit2: -s.takeProfit2, zone: { bottom: -s.zone.top, top: -s.zone.bottom } };
}

module.exports = { analyzeBounce, swingLows, P };
