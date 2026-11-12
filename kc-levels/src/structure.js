// (ب) هيكل السوق: قمم وقيعان صاعدة — القواعد ثابتة قبل التشغيل (2026-11-12):
//   القمة/القاع: أعلى/أدنى من 3 شموع قبلها و 3 بعدها، ولا يُعرف إلا بعد مرور 3 شموع.
//   ترند صاعد: آخر قاع أعلى من القاع الذي قبله (قاع أعلى)، وآخر قمة قبل هذا القاع أعلى من القمة التي قبلها (قمة أعلى).
//   الدخول (شراء): أول إغلاق فوق أعلى سعر منذ القاع الأعلى (كسر القمة الصغيرة بعده). الدخول بسعر الإغلاق.
//   الوقف: تحت القاع الأعلى بـ 0.25 × ATR، ويُلغى إذا كانت المخاطرة > 3 × ATR. الهدفان 1.5R و 3R.
//   البيع: قمم وقيعان هابطة، بالعكس تماماً.
const { atr } = require('../../gold-forex-signals-bot/src/indicators');

const P = { pivot: 3, slBufferAtr: 0.25, maxRiskAtr: 3, tp1R: 1.5, tp2R: 3 };
const MIN_CANDLES = 60;
const flip = (cs) => cs.map((c) => ({ ...c, open: -c.open, high: -c.low, low: -c.high, close: -c.close }));

function pivots(cs, L) {
  const lows = [];
  const highs = [];
  for (let j = L; j < cs.length - L; j++) {
    let lo = true;
    let hi = true;
    for (let k = 1; k <= L; k++) {
      if (!(cs[j].low < cs[j - k].low && cs[j].low <= cs[j + k].low)) lo = false;
      if (!(cs[j].high > cs[j - k].high && cs[j].high >= cs[j + k].high)) hi = false;
    }
    if (lo) lows.push(j);
    if (hi) highs.push(j);
  }
  return { lows, highs };
}

function bullishStructure(cs, a, p = P) {
  const i = cs.length - 1;
  const c = cs[i];
  if (a[i] == null) return null;
  // النقاط المؤكدة قبل الشمعة الحالية فقط
  const { lows, highs } = pivots(cs.slice(0, i), p.pivot);
  if (lows.length < 2) return null;
  const l2 = lows.at(-1);
  const l1 = lows.at(-2);
  if (!(cs[l2].low > cs[l1].low)) return null; // قاع أعلى
  const before = highs.filter((h) => h < l2);
  if (before.length < 2) return null;
  if (!(cs[before.at(-1)].high > cs[before.at(-2)].high)) return null; // قمة أعلى
  // أعلى سعر منذ القاع الأعلى، وأول إغلاق فوقه فقط: إذا أُغلقت شمعة سابقة فوق القمة قبلها، فالكسر حدث من قبل
  let level = -Infinity;
  for (let k = l2 + 1; k < i; k++) {
    if (Number.isFinite(level) && cs[k].close > level) return null;
    level = Math.max(level, cs[k].high);
  }
  if (!Number.isFinite(level) || !(c.close > level)) return null;
  const stopLoss = cs[l2].low - p.slBufferAtr * a[i];
  const risk = c.close - stopLoss;
  if (!(risk > 0) || risk > p.maxRiskAtr * a[i]) return null;
  return { side: 'BUY', time: c.time, entry: c.close, stopLoss, takeProfit1: c.close + p.tp1R * risk, takeProfit2: c.close + p.tp2R * risk };
}

function analyzeStructure(candles) {
  if (candles.length < MIN_CANDLES) return null;
  const a = atr(candles, 14);
  const buy = bullishStructure(candles, a);
  if (buy) return buy;
  const s = bullishStructure(flip(candles), a);
  if (!s) return null;
  return { side: 'SELL', time: s.time, entry: -s.entry, stopLoss: -s.stopLoss, takeProfit1: -s.takeProfit1, takeProfit2: -s.takeProfit2 };
}

module.exports = { analyzeStructure, pivots };
