// استراتيجية FVG (فجوة القيمة العادلة) مع الاتجاه — للاختبار فقط، غير مفعّلة في البوت.
// القواعد ثابتة قبل الاختبار (2026-11-05):
//   شراء: EMA50 فوق EMA200. فجوة صاعدة تكوّنت في آخر 20 شمعة: قاع الشمعة k أعلى من قمة الشمعة k-2،
//         وحجم الفجوة ≥ 0.3 × ATR. لم تُغلق أي شمعة تحت أسفل الفجوة منذ تكوّنها، ولم يرجع لها السعر قبل الآن.
//         الدخول: أول شمعة ينزل قاعها إلى أعلى الفجوة أو أدنى ثم تُغلق صاعدة فوق أعلى الفجوة.
//   الوقف تحت أسفل الفجوة بـ 0.25 × ATR (تُلغى إذا كانت المسافة أكبر من 3 × ATR)، والهدفان 1.5 × و 3 × المخاطرة.
//   البيع عكس كل ما سبق.
const { ema, rsi, atr } = require('./indicators');

const MIN_CANDLES = 210;
const OPTS = { maxAge: 20, minGapAtr: 0.3, slBufferAtr: 0.25, maxRiskAtr: 3, tp1R: 1.5, tp2R: 3 };

function analyzeFvg(candles, options = {}) {
  const o = { ...OPTS, ...options };
  if (candles.length < MIN_CANDLES) return null;
  const closes = candles.map((c) => c.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const atr14 = atr(candles, 14);
  const i = candles.length - 1;
  const c = candles[i];

  for (const dir of [1, -1]) {
    if (dir * (ema50[i] - ema200[i]) <= 0) continue;
    // الفجوات من الأحدث إلى الأقدم؛ الفجوة تكتمل عند إغلاق الشمعة k، فأقدم k مسموح هو i - maxAge
    for (let k = i - 1; k >= Math.max(2, i - o.maxAge); k--) {
      // near: حد الفجوة الذي يلمسه السعر عند الرجوع، far: الحد الذي تُلغى الفجوة إذا أُغلق خلفه
      const near = dir === 1 ? candles[k].low : candles[k].high;
      const far = dir === 1 ? candles[k - 2].high : candles[k - 2].low;
      const size = dir * (near - far);
      if (!(size >= o.minGapAtr * atr14[k])) continue;
      const [top, bottom] = [Math.max(near, far), Math.min(near, far)];
      let valid = true;
      for (let j = k + 1; j < i; j++) {
        const touched = dir === 1 ? candles[j].low <= near : candles[j].high >= near;
        const broken = dir * (candles[j].close - far) < 0;
        if (touched || broken) {
          valid = false;
          break;
        }
      }
      if (!valid) continue;
      const touchedNow = dir === 1 ? c.low <= near : c.high >= near;
      const confirmed = dir * (c.close - c.open) > 0 && dir * (c.close - near) > 0;
      if (!touchedNow || !confirmed) break; // أحدث فجوة صالحة لم تُختبر بعد: ننتظر
      const stopLoss = far - dir * o.slBufferAtr * atr14[i];
      const risk = dir * (c.close - stopLoss);
      if (!(risk > 0) || risk > o.maxRiskAtr * atr14[i]) break;
      return {
        side: dir === 1 ? 'BUY' : 'SELL',
        time: c.time,
        entry: c.close,
        stopLoss,
        takeProfit1: c.close + dir * risk * o.tp1R,
        takeProfit2: c.close + dir * risk * o.tp2R,
        rsi: rsi(closes, 14)[i],
        atr: atr14[i],
        zone: { bottom: Math.min(top, bottom), top: Math.max(top, bottom) },
        zoneLabel: 'FVG',
      };
    }
  }
  return null;
}

module.exports = { analyzeFvg };
