const test = require('node:test');
const assert = require('node:assert');
const { SPEC, overnightTrades, badOpenShare, judge } = require('../src/overnight');

test('الشروط كما سُجّلت', () => {
  assert.deepStrictEqual([SPEC.spreadPct, SPEC.swapPctPerNight, SPEC.minPf, SPEC.maxBadOpenShare, SPEC.lot], [0.01, 0.02, 1.2, 0.05, 0.1]);
  assert.deepStrictEqual(SPEC.periods.map((p) => p[1]), ['1985-01-01', '2005-01-01', '2021-01-01']);
});

test('الدخول عند الإغلاق والخروج عند الافتتاح التالي، و Swap حسب الليالي (الجمعة → الإثنين = 3)', () => {
  const c = [
    { time: '2026-11-13', open: 100, high: 101, low: 99, close: 100 }, // الجمعة
    { time: '2026-11-16', open: 101, high: 102, low: 100, close: 101 }, // الإثنين
    { time: '2026-11-17', open: 100.5, high: 101, low: 99, close: 100 },
  ];
  const [fri, mon] = overnightTrades(c);
  assert.strictEqual(fri.nights, 3);
  assert.ok(Math.abs(fri.ret - (1 - 0.01 - 0.06)) < 1e-9);
  assert.strictEqual(mon.nights, 1);
  assert.ok(Math.abs(mon.gross - ((100.5 - 101) / 101) * 100) < 1e-9);
});

test('بيانات افتتاح = إغلاق الأمس كثيرة → لا حكم', () => {
  const flat = [];
  let p = 100;
  for (let k = 0; k < 400; k++) {
    const t = new Date(Date.parse('1990-01-01') + k * 86400000).toISOString().slice(0, 10);
    flat.push({ time: t, open: p, high: p + 1, low: p - 1, close: p + 0.1 });
    p += 0.1;
  }
  assert.ok(badOpenShare(flat) > 0.9);
  assert.strictEqual(judge(flat).verdict, 'لا حكم');
});
