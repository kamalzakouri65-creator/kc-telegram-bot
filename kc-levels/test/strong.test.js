const test = require('node:test');
const assert = require('node:assert');
const { buyAtSupport, strongLevels } = require('../src/strong');

// 230 شمعة حول 110 (المدى 2)، قاعان عند 100 (الشمعتان 205 و 218)، ثم رجوع للمستوى عند الشمعة 228
function series(after = {}) {
  const cs = [];
  for (let k = 0; k < 240; k++) cs.push({ time: `t${String(k).padStart(3, '0')}`, open: 110, high: 111, low: 109, close: 110 });
  cs[205] = { ...cs[205], low: 100, close: 104 };
  cs[218] = { ...cs[218], low: 100.4, close: 104 };
  cs[228] = { ...cs[228], open: 105, low: 100.1, close: 103 };
  for (const [k, c] of Object.entries(after)) cs[k] = { ...cs[k], ...c };
  return cs;
}

test('شراء عند المستوى القوي (متوسط القاعين)، والهدف 2 ATR', () => {
  const t = buyAtSupport(series({ 229: { open: 103, high: 120, low: 102, close: 118 } }), 0);
  assert.strictEqual(t.length, 1);
  assert.strictEqual(t[0].time, 't228');
  assert.ok(Math.abs(t[0].r - 2) < 1e-9);
});

test('الوقف 1 ATR = −1R، والسبريد يُخصم', () => {
  const [t] = buyAtSupport(series({ 229: { open: 103, high: 104, low: 90, close: 92 } }), 0.5);
  assert.ok(t.r < -1);
});

test('مستوى مكسور بإغلاق تحته لا يُستعمل، والقاعان القريبان جداً (أقل من 10 شموع) لا يكوّنان مستوى', () => {
  assert.strictEqual(buyAtSupport(series({ 222: { low: 99, close: 99.5 } }), 0).filter((x) => x.time === 't228').length, 0);
  const close = series({ 218: { low: 109, close: 110 }, 210: { low: 100.4, close: 104 } });
  assert.strictEqual(buyAtSupport(close, 0).filter((x) => x.time === 't228').length, 0);
});

test('البيع عند المقاومة بالعكس', () => {
  const m = series({ 230: { high: 120, low: 104, close: 118 } }).map((c) => ({ time: c.time, open: 300 - c.open, high: 300 - c.low, low: 300 - c.high, close: 300 - c.close }));
  const t = strongLevels(m, 0);
  assert.ok(t.some((x) => x.side === 'SELL' && x.time === 't228' && Math.abs(x.r - 2) < 1e-9));
});
