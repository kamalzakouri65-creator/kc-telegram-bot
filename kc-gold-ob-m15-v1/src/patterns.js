// شموع التأكيد. p = الشمعة السابقة، c = الشمعة الحالية، كلاهما { o, h, l, c }.
const EPS = 1e-9; // لتفادي أخطاء الفاصلة العشرية في المقارنات الحدّية (≥)
const body = (x) => Math.abs(x.c - x.o);

// ابتلاعية صاعدة: السابقة هابطة، والحالية صاعدة، o ≤ c_prev و c ≥ o_prev، وجسم الحالية أكبر بشكل صارم
function bullEngulf(p, c) {
  return p.c < p.o && c.c > c.o && c.o <= p.c + EPS && c.c >= p.o - EPS && body(c) > body(p) + EPS;
}
function bearEngulf(p, c) {
  return p.c > p.o && c.c < c.o && c.o >= p.c - EPS && c.c <= p.o + EPS && body(c) > body(p) + EPS;
}
// Pin bar صاعد: جسم > 0، مدى > 0، الذيل السفلي ≥ 2 × الجسم، الإغلاق في الثلث العلوي. أي لون.
function bullPin(c) {
  const b = body(c);
  const range = c.h - c.l;
  if (!(b > 0) || !(range > 0)) return false;
  return Math.min(c.o, c.c) - c.l >= 2 * b - EPS && c.c >= c.l + (2 / 3) * range - EPS;
}
function bearPin(c) {
  const b = body(c);
  const range = c.h - c.l;
  if (!(b > 0) || !(range > 0)) return false;
  return c.h - Math.max(c.o, c.c) >= 2 * b - EPS && c.c <= c.h - (2 / 3) * range + EPS;
}
// النمط المؤكد للاتجاه (side = 1 شراء، −1 بيع) أو null
function confirmation(side, p, c) {
  if (side > 0) return bullEngulf(p, c) ? 'engulfing' : bullPin(c) ? 'pinbar' : null;
  return bearEngulf(p, c) ? 'engulfing' : bearPin(c) ? 'pinbar' : null;
}
module.exports = { bullEngulf, bearEngulf, bullPin, bearPin, confirmation };
