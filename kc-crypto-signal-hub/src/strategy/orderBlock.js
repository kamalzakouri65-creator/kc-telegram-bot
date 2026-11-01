// Order Block صاعد مع اندفاع (Displacement) بين سحب السيولة s وكسر الهيكل k:
//   - الاندفاع: شمعة صاعدة في (s..k] جسمها >= displacementAtr × ATR
//   - البلوك: آخر شمعة هابطة قبل شمعة الاندفاع (وليست قبل السحب)
//   - FVG: فجوة صاعدة في حركة الاندفاع (قمة الشمعة i-1 أقل من قاع الشمعة i+1) وتُحسب كعامل ثقة
function bullishOrderBlock(candles, atr, s, k, displacementAtr) {
  let d = -1;
  let strength = 0;
  for (let i = s + 1; i <= k; i++) {
    const body = candles[i].close - candles[i].open;
    if (atr[i] && body >= displacementAtr * atr[i]) {
      d = i;
      strength = body / atr[i];
      break;
    }
  }
  if (d < 0) return null;

  let j = -1;
  for (let t = d - 1; t >= s; t--) {
    if (candles[t].close < candles[t].open) {
      j = t;
      break;
    }
  }
  if (j < 0) return null;

  let fvg = null;
  for (let i = j + 1; i < k; i++) {
    if (candles[i - 1].high < candles[i + 1].low) {
      fvg = { top: candles[i + 1].low, bottom: candles[i - 1].high };
      break;
    }
  }
  return { index: j, top: candles[j].high, bottom: candles[j].low, displacementIndex: d, displacementAtr: strength, fvg };
}

// أول عودة للسعر إلى البلوك عند الشمعة m: تلمسه ولا تغلق تحته، ولم تلمسه أي شمعة بين k و m
function firstReturnAt(candles, ob, k, m) {
  if (m <= k) return false;
  for (let t = k + 1; t < m; t++) if (candles[t].low <= ob.top) return false;
  return candles[m].low <= ob.top && candles[m].close > ob.bottom;
}

module.exports = { bullishOrderBlock, firstReturnAt };
