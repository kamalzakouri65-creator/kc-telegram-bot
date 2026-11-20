// أدوات الاختبار: بيانات صغيرة مصنوعة يدوياً
const { config } = require('../src/config');

const RULES = config.rules;
const ZERO = { spread: 0, slippage: 0, commission: 0, swapPctPerNight: 0 };
const BASE = config.costs.base;

// شموع M15 من قائمة [o, h, l, c]
function m15Of(rows) {
  return { o: rows.map((r) => r[0]), h: rows.map((r) => r[1]), l: rows.map((r) => r[2]), c: rows.map((r) => r[3]) };
}
// M1 من قائمة [o, h, l, c] مع وقت يبدأ من start
function m1Of(rows, start) {
  return { t: rows.map((_, i) => start + i * 60000), o: rows.map((r) => r[0]), h: rows.map((r) => r[1]), l: rows.map((r) => r[2]), c: rows.map((r) => r[3]) };
}
// كل شمعة M15 تتحول إلى 15 دقيقة تمر بالضبط بـ: o (الدقيقة 0) → الطرف الأول (الدقيقة 4) → الطرف الثاني (الدقيقة 9) → c (الدقيقة 14).
// الصاعدة: الأدنى ثم الأعلى، والهابطة: الأعلى ثم الأدنى. فتجميع M1 يعيد نفس [o, h, l, c] بالضبط.
function m1FromM15(rows, start) {
  const out = [];
  for (const [o, h, l, c] of rows) {
    const [a, b] = c >= o ? [l, h] : [h, l];
    const knots = [[0, o], [4, a], [9, b], [14, c]];
    const pts = [];
    for (let k = 0; k < 15; k++) {
      let s = 0;
      while (k > knots[s + 1][0]) s++;
      const [k0, v0] = knots[s];
      const [k1, v1] = knots[s + 1];
      pts.push(v0 + ((v1 - v0) * (k - k0)) / (k1 - k0));
    }
    for (let k = 0; k < 15; k++) {
      const x = k === 0 ? o : pts[k - 1];
      const y = pts[k];
      out.push([x, Math.max(x, y), Math.min(x, y), y]);
    }
  }
  return m1Of(out, start);
}

// سيناريو شراء: قمة مؤكدة عند 2 (105)، ثم انخفاض، ثم OB عند 7، ثم كسر عند 8، ثم خروج، ثم لمسة وتأكيد
function bullScenario({ pad = 0, ob7Bull = false, after = null } = {}) {
  const rows = [
    [100, 101, 99, 100.5],
    [100.5, 102, 100, 101.5],
    [101.5, 105, 101, 104], // 2: قمة
    [104, 104.5, 102, 103],
    [103, 103.5, 101, 101.5],
    [101.5, 102, 100, 100.5],
    [100.6, 101.2, 99.8, 101], // 6: أدنى سعر بعد القمة (s)
    ob7Bull ? [100.2, 101.5, 100.2, 101.3] : [101, 101.5, 100.2, 100.4], // 7: OB (هابطة)
    [100.4, 106.5, 100.3, 106], // 8: الكسر، جسم 5.6
    [106, 107, 105, 106.5], // 9: خارج المنطقة
    [106.5, 106.8, 103, 103.5], // 10: خارج المنطقة
  ];
  for (let k = 0; k < pad; k++) rows.push([105, 106, 104, 105]);
  rows.push(...(after ?? [
    [103.5, 103.6, 101.0, 101.2], // لمسة 1: هابطة بدون تأكيد
    [101.1, 104, 100.9, 103.8], // ابتلاعية صاعدة داخل المنطقة
  ]));
  return rows;
}
const constAtr = (n, v) => new Array(n).fill(v);

module.exports = { RULES, ZERO, BASE, m15Of, m1Of, m1FromM15, bullScenario, constAtr };
