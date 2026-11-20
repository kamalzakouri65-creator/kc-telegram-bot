// قواعد الاستراتيجية على M15 كآلة حالة تتقدم شمعة شمعة. step(i) يُستدعى عند إغلاق الشمعة i ويقرأ الشموع 0..i فقط.
// bars: { o, h, l, c } لشموع M15. atr: مصفوفة ATR(14). trendAt(i): +1 إذا كان آخر إغلاق H1 مغلق فوق EMA 200، و −1 تحته، و 0 غير معروف.
const { isPivotHigh, isPivotLow } = require('./indicators');
const { confirmation } = require('./patterns');

const candle = (bars, i) => ({ o: bars.o[i], h: bars.h[i], l: bars.l[i], c: bars.c[i] });

// OB صاعد بعد كسر القمة عند h بشمعة الكسر b:
//  s = الشمعة صاحبة أدنى سعر بين h+1 و b (عند التساوي: الأحدث)، ثم نبحث للخلف من b−1 حتى s فقط عن أول شمعة هابطة.
//  لا بحث قبل s أبداً. إذا لم توجد شمعة هابطة: لا OB.
function findBullOb(bars, h, b) {
  let s = h + 1;
  for (let k = h + 1; k <= b; k++) if (bars.l[k] <= bars.l[s]) s = k;
  for (let k = b - 1; k >= s; k--) if (bars.c[k] < bars.o[k]) return k;
  return -1;
}
// OB هابط: s = أعلى سعر بين l+1 و b (الأحدث عند التساوي)، وأول شمعة صاعدة للخلف من b−1 حتى s
function findBearOb(bars, lo, b) {
  let s = lo + 1;
  for (let k = lo + 1; k <= b; k++) if (bars.h[k] >= bars.h[s]) s = k;
  for (let k = b - 1; k >= s; k--) if (bars.c[k] > bars.o[k]) return k;
  return -1;
}

const overlaps = (bars, i, ob) => bars.l[i] <= ob.hi && bars.h[i] >= ob.lo;

function createStrategy(bars, { atr, trendAt, rules }) {
  const p = rules.pivot;
  let lastHigh = null; // { idx, price, broken }
  let lastLow = null;
  let obs = [];
  const log = { bos: 0, bosNoDisplacement: 0, bosNoOb: 0, obs: 0, expired: 0, invalidated: 0, touchesUsed: 0 };

  function makeOb(side, pivotIdx, b) {
    const k = side > 0 ? findBullOb(bars, pivotIdx, b) : findBearOb(bars, pivotIdx, b);
    if (k < 0) {
      log.bosNoOb++;
      return;
    }
    const ob = { id: b, side, b, k, lo: bars.l[k], hi: bars.h[k], touches: 0, prevOv: false, active: true };
    ob.prevOv = overlaps(bars, b, ob); // إذا كانت شمعة الكسر داخل المنطقة، يجب أن يخرج السعر أولاً
    obs.push(ob);
    log.obs++;
  }

  function step(i) {
    const cands = [];
    // 1) تحديث الـ OB الموجودة (المنشأة قبل i) وجمع الإشارات
    for (const ob of obs) {
      if (!ob.active) continue;
      if (i - ob.b > rules.maxAge) {
        ob.active = false;
        log.expired++;
        continue;
      }
      const ov = overlaps(bars, i, ob);
      if (ov && !ob.prevOv) ob.touches++; // لمسة جديدة: دخول المنطقة بعد أن كان خارجها
      if (!ov && ob.prevOv && ob.touches >= rules.maxTouches) {
        // انتهت اللمسة الثانية بدون دخول
        ob.active = false;
        log.touchesUsed++;
        continue;
      }
      ob.prevOv = ov;
      if (ov && ob.touches >= 1 && ob.touches <= rules.maxTouches && i >= 1) {
        const c = candle(bars, i);
        const inZone = ob.side > 0 ? c.l <= ob.hi && c.c > ob.lo : c.h >= ob.lo && c.c < ob.hi;
        const pattern = inZone ? confirmation(ob.side, candle(bars, i - 1), c) : null;
        if (pattern && trendAt(i) === ob.side) cands.push({ ob, i, side: ob.side, pattern, atr: atr[i] });
      }
      // الإلغاء: إغلاق خلف الحد البعيد
      if ((ob.side > 0 && bars.c[i] < ob.lo) || (ob.side < 0 && bars.c[i] > ob.hi)) {
        ob.active = false;
        log.invalidated++;
      }
    }
    obs = obs.filter((o) => o.active);

    // 2) BOS عند i: إغلاق خلف آخر قمة/قاع مؤكد قبل i، والإغلاق السابق لم يكن خلفه. كل قمة/قاع يُكسر مرة واحدة.
    if (i >= 1 && lastHigh && !lastHigh.broken && bars.c[i] > lastHigh.price && bars.c[i - 1] <= lastHigh.price) {
      lastHigh.broken = true;
      log.bos++;
      const body = bars.c[i] - bars.o[i];
      if (body > 0 && Number.isFinite(atr[i - 1]) && body >= rules.dispAtr * atr[i - 1] - 1e-9) makeOb(1, lastHigh.idx, i);
      else log.bosNoDisplacement++;
    }
    if (i >= 1 && lastLow && !lastLow.broken && bars.c[i] < lastLow.price && bars.c[i - 1] >= lastLow.price) {
      lastLow.broken = true;
      log.bos++;
      const body = bars.o[i] - bars.c[i];
      if (body > 0 && Number.isFinite(atr[i - 1]) && body >= rules.dispAtr * atr[i - 1] - 1e-9) makeOb(-1, lastLow.idx, i);
      else log.bosNoDisplacement++;
    }

    // 3) تأكيد قمة/قاع عند j = i − p (بعد إغلاق الشمعة i فقط)
    const j = i - p;
    if (isPivotHigh(bars, j, p)) lastHigh = { idx: j, price: bars.h[j], broken: false };
    if (isPivotLow(bars, j, p)) lastLow = { idx: j, price: bars.l[j], broken: false };

    // الأحدث أولاً عند تعدد الإشارات
    cands.sort((a, b) => b.ob.b - a.ob.b);
    return cands;
  }

  // بعد الدخول من OB لا يُستعمل مرة أخرى
  function consume(ob) {
    ob.active = false;
    obs = obs.filter((o) => o.active);
  }

  return { step, consume, log, state: () => ({ lastHigh, lastLow, obs }) };
}

module.exports = { createStrategy, findBullOb, findBearOb };
