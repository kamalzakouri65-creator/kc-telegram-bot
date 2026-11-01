// استراتيجية Smart Money (SMC):
//   1. سحب سيولة: شمعة تكسر قاعاً سابقاً (Swing Low) بذيلها ثم تغلق فوقه
//   2. كسر هيكل (BOS): بعدها شمعة تغلق فوق آخر قمة (Swing High)
//   3. فجوة قيمة عادلة (FVG) تتركها حركة الاندفاع: قمة الشمعة m-1 أقل من قاع الشمعة m+1
//   4. الدخول: أول عودة للسعر إلى الفجوة مع إغلاق صاعد فوق أسفلها
//   الوقف تحت قاع سحب السيولة، والهدفان 2 × و 4 × المخاطرة. البيع عكس كل ما سبق.
const { rsi, atr } = require('./indicators');
const { pivots } = require('./orderblock');

const MIN_CANDLES = 50;

// نكتشف إعداد الشراء فقط، ونكتشف البيع بقلب الشموع (السعر ← سالب السعر) ثم نعيد قلب النتيجة
const flip = (candles) => candles.map((c) => ({ ...c, open: -c.open, high: -c.low, low: -c.high, close: -c.close }));

function bullishSetup(candles, atr14, opts) {
  const i = candles.length - 1;
  const c = candles[i];
  const L = opts.pivotLength;
  const piv = pivots(candles, L);
  // آخر قمة/قاع مؤكد قبل الشمعة k (القمة j لا تُعرف إلا بعد مرور L شمعة)
  const lastPivot = (flags, k) => {
    for (let j = k - L - 1; j >= 0; j--) if (flags[j]) return j;
    return -1;
  };

  for (let k = i - 1; k >= Math.max(1, i - opts.maxAge); k--) {
    const h = lastPivot(piv.highs, k);
    if (h < 0) continue;
    const level = candles[h].high;
    if (!(candles[k].close > level && candles[k - 1].close <= level)) continue;

    // سحب سيولة قبل كسر الهيكل
    let sweep = -1;
    for (let s = k - 1; s >= Math.max(0, k - opts.sweepLookback); s--) {
      const p = lastPivot(piv.lows, s);
      if (p >= 0 && candles[s].low < candles[p].low && candles[s].close > candles[p].low) {
        sweep = s;
        break;
      }
    }
    if (sweep < 0) return null;

    // أحدث فجوة صاعدة بين سحب السيولة وكسر الهيكل لم يلمسها السعر قبل الشمعة الحالية
    // (الاندفاع قد يترك أكثر من فجوة، والسعر يملأ القريبة أولاً ثم يصل للأعمق)
    let fvg = null;
    for (let m = Math.min(k + 1, i - 2); m > sweep && !fvg; m--) {
      if (candles[m - 1].high >= candles[m + 1].low) continue;
      const top = candles[m + 1].low;
      let filled = false;
      for (let t = m + 2; t < i; t++) if (candles[t].low <= top) filled = true;
      if (!filled) fvg = { top, bottom: candles[m - 1].high };
    }
    if (!fvg) return null;

    const touched = c.low <= fvg.top && c.close > fvg.bottom && c.close > c.open;
    if (!touched) return null;

    let sweepLow = Infinity;
    for (let t = sweep; t <= k; t++) sweepLow = Math.min(sweepLow, candles[t].low);
    const stopLoss = sweepLow - opts.slBufferAtr * atr14[i];
    const risk = c.close - stopLoss;
    if (!(risk > 0) || risk > opts.maxRiskAtr * atr14[i]) return null;
    return { entry: c.close, stopLoss, risk, zone: { top: fvg.top, bottom: fvg.bottom } };
  }
  return null;
}

function analyzeSmc(candles, options = {}) {
  const opts = { pivotLength: 3, maxAge: 30, sweepLookback: 15, slBufferAtr: 0.1, maxRiskAtr: 5, tp1R: 2, tp2R: 4, ...options };
  if (candles.length < MIN_CANDLES) return null;
  const atr14 = atr(candles, 14);
  const i = candles.length - 1;
  const rsi14 = rsi(candles.map((c) => c.close), 14);

  for (const dir of [1, -1]) {
    const setup = bullishSetup(dir === 1 ? candles : flip(candles), atr14, opts);
    if (!setup) continue;
    const entry = dir * setup.entry;
    const stopLoss = dir * setup.stopLoss;
    const zone = dir === 1 ? setup.zone : { top: -setup.zone.bottom, bottom: -setup.zone.top };
    return {
      side: dir === 1 ? 'BUY' : 'SELL',
      time: candles[i].time,
      entry,
      stopLoss,
      takeProfit1: entry + dir * setup.risk * opts.tp1R,
      takeProfit2: entry + dir * setup.risk * opts.tp2R,
      rsi: rsi14[i],
      atr: atr14[i],
      zone,
      zoneLabel: 'FVG',
    };
  }
  return null;
}

module.exports = { analyzeSmc };
