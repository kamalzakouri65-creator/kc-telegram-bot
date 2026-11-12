const test = require('node:test');
const assert = require('node:assert');
const { analyzeBounce, swingLows } = require('../src/bounce');

// شموع تتذبذب حول 100، مع قاعين عند 95 (الشمعتان 40 و 70)، ثم رجوع للدعم بشمعة رفض
function series({ reject = true, breakBelow = false } = {}) {
  const cs = [];
  for (let k = 0; k < 120; k++) {
    let low = 99;
    if (k === 40 || k === 70) low = 95;
    if (k === 41 || k === 71) low = 97;
    cs.push({ time: `t${k}`, open: 100, high: 101 + (k % 3) * 0.2, low, close: 100.2 });
  }
  if (breakBelow) cs[90] = { time: 't90', open: 99, high: 99.5, low: 93, close: 94 };
  // الشمعة الأخيرة: تنزل للدعم وترتد
  cs.push(reject ? { time: 'entry', open: 96.2, high: 97.0, low: 94.9, close: 96.8 } : { time: 'entry', open: 96.8, high: 97.0, low: 94.9, close: 96.2 });
  return cs;
}

test('القيعان: أدنى من 3 شموع قبلها و 3 بعدها', () => {
  const cs = series();
  assert.ok(swingLows(cs, 3).includes(40) && swingLows(cs, 3).includes(70));
});

test('شراء عند الرجوع للدعم بشمعة رفض، والوقف تحت المنطقة', () => {
  const s = analyzeBounce(series());
  assert.strictEqual(s.side, 'BUY');
  assert.deepStrictEqual(s.zone, { bottom: 95, top: 95 });
  assert.ok(s.stopLoss < 95);
  assert.ok(Math.abs(s.takeProfit1 - (s.entry + 1.5 * (s.entry - s.stopLoss))) < 1e-9);
});

test('لا إشارة بدون شمعة رفض، ولا إذا كُسرت المنطقة', () => {
  assert.strictEqual(analyzeBounce(series({ reject: false })), null);
  assert.strictEqual(analyzeBounce(series({ breakBelow: true })), null);
});

test('البيع عند المقاومة هو الشراء بالعكس', () => {
  const m = series().map((c) => ({ time: c.time, open: 200 - c.open, high: 200 - c.low, low: 200 - c.high, close: 200 - c.close }));
  const s = analyzeBounce(m);
  assert.strictEqual(s.side, 'SELL');
  assert.ok(s.stopLoss > 105);
});

test('لا نظر للمستقبل: الشموع بعد الإشارة لا تغيّرها', () => {
  const cs = series();
  const a = analyzeBounce(cs);
  const b = analyzeBounce(cs.map((c, k) => (k < cs.length - 1 ? c : c)));
  assert.deepStrictEqual(a, b);
});
