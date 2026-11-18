const test = require('node:test');
const assert = require('node:assert');
const { SPEC, ibsTrades } = require('../src/ibs');

test('الشروط كما سُجّلت', () => {
  assert.deepStrictEqual(SPEC.rule, { ibsBelow: 0.2, maxBars: 5, smaTrend: 200, stopAtr: 2 });
  assert.deepStrictEqual([SPEC.spreadPct, SPEC.swapPctPerNight, SPEC.minPf, SPEC.minTrades, SPEC.maxFlat], [0.01, 0.02, 1.2, 20, 0.05]);
  assert.deepStrictEqual([SPEC.grid.ibs, SPEC.grid.maxBars, SPEC.grid.minPositive], [[0.1, 0.2, 0.3], [3, 5, 10], 7]);
});

// 220 يوماً صاعدة ثم إغلاق قرب أدنى اليوم، ثم يوم يغلق فوق أعلى الأمس
function scenario(exitDay) {
  const c = [];
  for (let k = 0; k < 220; k++) {
    const p = 100 + k * 0.1;
    c.push({ time: new Date(Date.parse('2020-01-01') + k * 86400000).toISOString().slice(0, 10), open: p, high: p + 0.5, low: p - 0.5, close: p + 0.2 });
  }
  const last = c.at(-1).close;
  c.push({ time: '2020-08-08', open: last, high: last + 0.4, low: last - 0.6, close: last - 0.55 }); // IBS ≈ 0.05
  c.push(exitDay(last));
  return c;
}

test('الدخول عند IBS < 0.2 فوق متوسط 200، والخروج عند إغلاق فوق أعلى الأمس', () => {
  const c = scenario((p) => ({ time: '2020-08-09', open: p - 0.5, high: p + 1, low: p - 0.6, close: p + 0.9 }));
  const [t] = ibsTrades(c);
  assert.ok(t, 'يجب أن تكون هناك صفقة');
  assert.deepStrictEqual([t.time, t.closedAt], ['2020-08-08', '2020-08-09']);
  assert.ok(t.r > 0);
});

test('الوقف: فجوة تحت الوقف = الخروج بسعر الافتتاح', () => {
  const c = scenario((p) => ({ time: '2020-08-09', open: p - 20, high: p - 19, low: p - 21, close: p - 20 }));
  const [t] = ibsTrades(c);
  assert.ok(t.r < -1, 'الفجوة تخسر أكثر من 1R');
});
