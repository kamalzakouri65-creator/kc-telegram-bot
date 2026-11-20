// بناء شموع M15 و H1 من M1 بدون تسريب: شمعة تبدأ عند t متاحة فقط عند t + المدة (بعد إغلاق آخر دقيقة فيها).
// M1 بصيغة أعمدة: { t: [ms], o, h, l, c } مرتبة تصاعدياً.
function aggregate(m1, minutes) {
  const span = minutes * 60000;
  const out = { span, t: [], o: [], h: [], l: [], c: [], first: [], last: [] };
  let cur = -1;
  for (let k = 0; k < m1.t.length; k++) {
    const b = Math.floor(m1.t[k] / span) * span;
    if (b !== cur) {
      cur = b;
      out.t.push(b);
      out.o.push(m1.o[k]);
      out.h.push(m1.h[k]);
      out.l.push(m1.l[k]);
      out.c.push(m1.c[k]);
      out.first.push(k);
      out.last.push(k);
    } else {
      const j = out.t.length - 1;
      if (m1.h[k] > out.h[j]) out.h[j] = m1.h[k];
      if (m1.l[k] < out.l[j]) out.l[j] = m1.l[k];
      out.c[j] = m1.c[k];
      out.last[j] = k;
    }
  }
  return out;
}
// وقت توفر الشمعة j (إغلاقها)
const closeTime = (bars, j) => bars.t[j] + bars.span;

// قص M1 إلى فترة [from, to]
function sliceM1(m1, from, to) {
  let a = 0;
  while (a < m1.t.length && m1.t[a] < from) a++;
  let b = a;
  while (b < m1.t.length && m1.t[b] <= to) b++;
  const pick = (arr) => arr.slice(a, b);
  return { t: pick(m1.t), o: pick(m1.o), h: pick(m1.h), l: pick(m1.l), c: pick(m1.c) };
}

module.exports = { aggregate, closeTime, sliceM1 };
