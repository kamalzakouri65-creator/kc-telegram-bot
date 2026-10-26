const { rsi, atr } = require('./indicators');

const MIN_CANDLES = 60;

// قمم وقيعان "الفراكتل": الشمعة j قمة إذا كانت أعلى من length شمعة قبلها وبعدها
function pivots(candles, length) {
  const highs = new Array(candles.length).fill(false);
  const lows = new Array(candles.length).fill(false);
  for (let j = length; j < candles.length - length; j++) {
    let isHigh = true;
    let isLow = true;
    for (let d = 1; d <= length; d++) {
      if (candles[j - d].high >= candles[j].high || candles[j + d].high > candles[j].high) isHigh = false;
      if (candles[j - d].low <= candles[j].low || candles[j + d].low < candles[j].low) isLow = false;
    }
    highs[j] = isHigh;
    lows[j] = isLow;
  }
  return { highs, lows };
}

// يبحث عن أحدث Order Block لم يلمسه السعر بعد في اتجاه واحد (dir = 1 صاعد، -1 هابط).
// البلوك الصاعد = آخر شمعة هابطة قبل الاندفاع الذي كسر آخر قمة (BOS)، والهابط عكسه.
function findBlock(candles, atr14, piv, dir, opts) {
  const n = candles.length;
  const i = n - 1;
  const swing = dir === 1 ? piv.highs : piv.lows;
  const level = (c) => (dir === 1 ? c.high : c.low);

  // extreme[t] = أدنى قاع (أو أعلى قمة) من الشمعة t حتى ما قبل الشمعة الحالية،
  // لمعرفة هل عاد السعر إلى البلوك قبل الآن فأصبح مستهلكاً
  const extreme = new Array(n + 1).fill(dir === 1 ? Infinity : -Infinity);
  for (let t = i - 1; t >= 0; t--) {
    extreme[t] = dir === 1 ? Math.min(candles[t].low, extreme[t + 1]) : Math.max(candles[t].high, extreme[t + 1]);
  }

  let lastSwing = -1;
  let best = null;
  for (let k = 1; k < i; k++) {
    // القمة/القاع لا يُعرف إلا بعد مرور pivotLength شمعة
    const confirmed = k - 1 - opts.pivotLength;
    if (confirmed >= 0 && swing[confirmed]) lastSwing = confirmed;
    if (lastSwing < 0 || k < i - opts.maxAge) continue;

    const broke = dir * (candles[k].close - level(candles[lastSwing])) > 0;
    const before = dir * (candles[k - 1].close - level(candles[lastSwing])) <= 0;
    if (!broke || !before) continue;

    // بداية الاندفاع: أدنى قاع (أو أعلى قمة) بين القمة المكسورة وشمعة الكسر
    let m = lastSwing;
    for (let t = lastSwing; t <= k; t++) {
      if (dir === 1 ? candles[t].low < candles[m].low : candles[t].high > candles[m].high) m = t;
    }
    let j = -1;
    for (let t = m; t >= Math.max(0, m - 5); t--) {
      const c = candles[t];
      if (dir === 1 ? c.close < c.open : c.close > c.open) {
        j = t;
        break;
      }
    }
    if (j === -1) continue;

    const top = candles[j].high;
    const bottom = candles[j].low;
    const impulse = dir === 1 ? candles[k].close - bottom : top - candles[k].close;
    if (impulse < opts.minImpulseAtr * atr14[k]) continue;

    const touched = dir === 1 ? extreme[k + 1] <= top : extreme[k + 1] >= bottom;
    if (touched) continue;

    best = { top, bottom, formedAt: candles[j].time, brokeAt: candles[k].time };
  }
  return best;
}

// إشارة على أول عودة للسعر إلى Order Block مع شمعة رفض:
//   شراء: الشمعة تلمس البلوك الصاعد وتغلق صاعدة فوق منتصفه
//   بيع: الشمعة تلمس البلوك الهابط وتغلق هابطة تحت منتصفه
// وقف الخسارة خلف البلوك بهامش 0.25 × ATR، والهدفان 2 × و 3 × المخاطرة
function analyzeOrderBlock(candles, options = {}) {
  const opts = {
    pivotLength: 3,
    maxAge: 100,
    minImpulseAtr: 1.5,
    slBufferAtr: 0.25,
    tp1R: 2,
    tp2R: 3,
    ...options,
  };
  if (candles.length < MIN_CANDLES) return null;

  const atr14 = atr(candles, 14);
  const rsi14 = rsi(candles.map((c) => c.close), 14);
  const piv = pivots(candles, opts.pivotLength);
  const i = candles.length - 1;
  const c = candles[i];

  for (const dir of [1, -1]) {
    const block = findBlock(candles, atr14, piv, dir, opts);
    if (!block) continue;
    const mid = (block.top + block.bottom) / 2;
    const entered = dir === 1 ? c.low <= block.top : c.high >= block.bottom;
    const rejected = dir === 1 ? c.close > c.open && c.close > mid : c.close < c.open && c.close < mid;
    if (!entered || !rejected) continue;

    const stopLoss = dir === 1 ? block.bottom - opts.slBufferAtr * atr14[i] : block.top + opts.slBufferAtr * atr14[i];
    const risk = dir * (c.close - stopLoss);
    if (!(risk > 0)) continue;
    return {
      side: dir === 1 ? 'BUY' : 'SELL',
      time: c.time,
      entry: c.close,
      stopLoss,
      takeProfit1: c.close + dir * risk * opts.tp1R,
      takeProfit2: c.close + dir * risk * opts.tp2R,
      rsi: rsi14[i],
      atr: atr14[i],
      zone: { top: block.top, bottom: block.bottom },
    };
  }
  return null;
}

module.exports = { analyzeOrderBlock, pivots };
