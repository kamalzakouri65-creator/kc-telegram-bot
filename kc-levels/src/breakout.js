// (ج) اختراق القمة أو القاع — القواعد ثابتة قبل التشغيل (2026-11-12):
//   القمة/القاع: أعلى/أدنى من 3 شموع قبلها و 3 بعدها، ولا يُعرف إلا بعد مرور 3 شموع.
//   الدخول (شراء): أول إغلاق فوق آخر قمة مؤكدة (من آخر 50 شمعة)، وإغلاق الشمعة السابقة كان تحتها. الدخول بسعر الإغلاق.
//   الوقف: تحت آخر قاع مؤكد قبل الدخول بـ 0.25 × ATR، ويُلغى إذا كانت المخاطرة > 3 × ATR. الهدفان 1.5R و 3R.
//   بدون أي فلتر ترند. البيع: كسر آخر قاع، بالعكس تماماً.
const { atr } = require('../../gold-forex-signals-bot/src/indicators');
const { pivots } = require('./structure');

const P = { pivot: 3, lookback: 50, slBufferAtr: 0.25, maxRiskAtr: 3, tp1R: 1.5, tp2R: 3 };
const MIN_CANDLES = 60;
const flip = (cs) => cs.map((c) => ({ ...c, open: -c.open, high: -c.low, low: -c.high, close: -c.close }));

function bullishBreak(cs, a, p = P) {
  const i = cs.length - 1;
  const c = cs[i];
  if (a[i] == null) return null;
  const { lows, highs } = pivots(cs.slice(0, i), p.pivot);
  const h = highs.at(-1);
  if (h == null || h < i - p.lookback || !lows.length) return null;
  const level = cs[h].high;
  if (!(c.close > level && cs[i - 1].close <= level)) return null;
  // الكسر الأول فقط: لا إغلاق فوق القمة بين تأكيدها والشمعة السابقة
  for (let k = h + 1; k < i; k++) if (cs[k].close > level) return null;
  const stopLoss = cs[lows.at(-1)].low - p.slBufferAtr * a[i];
  const risk = c.close - stopLoss;
  if (!(risk > 0) || risk > p.maxRiskAtr * a[i]) return null;
  return { side: 'BUY', time: c.time, entry: c.close, stopLoss, takeProfit1: c.close + p.tp1R * risk, takeProfit2: c.close + p.tp2R * risk };
}

function analyzeBreakout(candles) {
  if (candles.length < MIN_CANDLES) return null;
  const a = atr(candles, 14);
  const buy = bullishBreak(candles, a);
  if (buy) return buy;
  const s = bullishBreak(flip(candles), a);
  if (!s) return null;
  return { side: 'SELL', time: s.time, entry: -s.entry, stopLoss: -s.stopLoss, takeProfit1: -s.takeProfit1, takeProfit2: -s.takeProfit2 };
}

module.exports = { analyzeBreakout };
