const test = require('node:test');
const assert = require('node:assert');
const { judge, SPEC } = require('../src/new-indices');

function daily(from, n, drift, flat = false) {
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const out = [];
  let p = 1000;
  for (let k = 0; k < n; k++) {
    const next = p * (1 + rnd() * 0.025 + drift);
    const time = new Date(Date.parse(from) + k * 86400000).toISOString().slice(0, 10);
    out.push(flat ? { time, open: next, high: next, low: next, close: next } : { time, open: p, high: Math.max(p, next) * 1.004, low: Math.min(p, next) * 0.996, close: next });
    p = next;
  }
  return out;
}

test('الشروط كما سُجّلت', () => {
  assert.deepStrictEqual([SPEC.spreadPct, SPEC.minProfitFactor, SPEC.minTradesPerPeriod, SPEC.maxFlatShare], [0.02, 1.2, 20, 0.05]);
  assert.deepStrictEqual(SPEC.markets.map((m) => m.ticker), ['^DJI', '^RUT', '^GDAXI', '^FTSE', '^N225']);
});

test('بيانات بلا مدى في فترة = لا حكم، وفترة بلا صفقات كافية = فشل', () => {
  const c = [...daily('1990-01-01', 5500, 0.0005, true), ...daily('2005-01-01', 6000, 0.0005)];
  const j = judge(c);
  assert.strictEqual(j.verdict, 'لا حكم');
  assert.ok(j.reasons.some((r) => r.includes('الفترة 3')), 'الفترة 3 بلا بيانات تقريباً');
});
