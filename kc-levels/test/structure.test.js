const test = require('node:test');
const assert = require('node:assert');
const { analyzeStructure, pivots } = require('../src/structure');

// موجات: قاع 100 → قمة 110 → قاع 104 → قمة 114 → قاع 108 (أعلى) → ارتداد إلى 111 → ثم كسر فوق 111
function wave(points, step = 1) {
  const cs = [];
  let p = points[0];
  for (let k = 1; k < points.length; k++) {
    const target = points[k];
    const n = Math.max(4, Math.round(Math.abs(target - p) / step));
    for (let j = 0; j < n; j++) {
      const o = p;
      p = p + (target - p) / (n - j);
      cs.push({ time: `t${cs.length}`, open: o, high: Math.max(o, p) + 0.8, low: Math.min(o, p) - 0.8, close: p });
    }
  }
  return cs;
}
const base = () => [...wave([95, 96, 95, 96, 95, 96, 95, 96, 95, 96, 95, 96, 95, 96, 95, 96], 0.5), ...wave([95, 100, 110, 104, 114, 108, 111, 109], 1)];

test('القمم والقيعان المؤكدة', () => {
  const { lows, highs } = pivots(base(), 3);
  assert.ok(lows.length >= 2 && highs.length >= 2);
});

test('شراء عند أول إغلاق فوق أعلى سعر منذ القاع الأعلى', () => {
  const cs = base();
  const level = Math.max(...cs.slice(-8).map((c) => c.high));
  cs.push({ time: 'entry', open: 109.5, high: level + 1.2, low: 109.4, close: level + 1 });
  const s = analyzeStructure(cs);
  assert.ok(s, 'يجب أن تظهر إشارة');
  assert.strictEqual(s.side, 'BUY');
  assert.ok(s.stopLoss < 108 && s.stopLoss > 106);
  assert.ok(Math.abs(s.takeProfit2 - (s.entry + 3 * (s.entry - s.stopLoss))) < 1e-9);
});

test('لا إشارة بدون كسر، ولا في الشمعة التالية للكسر', () => {
  const cs = base();
  cs.push({ time: 'x', open: 109.5, high: 110, low: 109.4, close: 109.8 });
  assert.strictEqual(analyzeStructure(cs), null);
  const level = Math.max(...base().slice(-8).map((c) => c.high));
  const b = base();
  b.push({ time: 'e1', open: 109.5, high: level + 1.2, low: 109.4, close: level + 1 });
  b.push({ time: 'e2', open: level + 1, high: level + 2.2, low: level + 0.9, close: level + 2 });
  assert.strictEqual(analyzeStructure(b), null, 'أول كسر فقط');
});

test('البيع: قمم وقيعان هابطة بالعكس', () => {
  const cs = base();
  const level = Math.max(...cs.slice(-8).map((c) => c.high));
  cs.push({ time: 'entry', open: 109.5, high: level + 1.2, low: 109.4, close: level + 1 });
  const m = cs.map((c) => ({ time: c.time, open: 300 - c.open, high: 300 - c.low, low: 300 - c.high, close: 300 - c.close }));
  const s = analyzeStructure(m);
  assert.strictEqual(s.side, 'SELL');
  assert.ok(s.stopLoss > s.entry);
});
