const test = require('node:test');
const assert = require('node:assert');
const { analyzePullback } = require('../src/pullback');

// اتجاه صاعد طويل، ثم تصحيح يلمس EMA50، ثم عودة للصعود
function uptrendWithPullback() {
  const closes = [];
  for (let i = 0; i < 260; i++) closes.push(1000 + i * 2);
  let p = closes.at(-1);
  for (let i = 0; i < 6; i++) closes.push((p -= 8));
  for (let i = 0; i < 15; i++) closes.push((p += 6));
  return closes.map((close, i) => {
    const open = i ? closes[i - 1] : close;
    return { time: `t${i}`, open, close, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1 };
  });
}

const mirror = (candles) =>
  candles.map((c) => ({ time: c.time, open: 5000 - c.open, close: 5000 - c.close, high: 5000 - c.low, low: 5000 - c.high }));

function signalsOver(candles) {
  const found = [];
  for (let n = 250; n <= candles.length; n++) {
    const s = analyzePullback(candles.slice(0, n));
    if (s) found.push({ n, s });
  }
  return found;
}

test('التصحيح إلى EMA50 في اتجاه صاعد يعطي شراء واحداً بوقف تحت الدخول', () => {
  const found = signalsOver(uptrendWithPullback());
  assert.ok(found.length >= 1, 'يجب أن تظهر إشارة');
  for (const { s } of found) {
    assert.strictEqual(s.side, 'BUY');
    assert.ok(s.stopLoss < s.entry && s.takeProfit1 > s.entry && s.takeProfit2 > s.takeProfit1);
  }
  // لا تتكرر الإشارة على شمعتين متتاليتين
  for (let k = 1; k < found.length; k++) assert.ok(found[k].n - found[k - 1].n > 1);
});

test('الإعداد المعكوس يعطي بيع فقط', () => {
  const sides = new Set(signalsOver(mirror(uptrendWithPullback())).map(({ s }) => s.side));
  assert.deepStrictEqual([...sides], ['SELL']);
});

test('لا إشارة في اتجاه صاعد مستمر بدون تصحيح، ولا عند نقص البيانات', () => {
  const steady = Array.from({ length: 300 }, (_, i) => {
    const close = 1000 + i * 2;
    return { time: `t${i}`, open: close - 2, close, high: close + 1, low: close - 3 };
  });
  assert.strictEqual(signalsOver(steady).length, 0);
  assert.strictEqual(analyzePullback(steady.slice(0, 100)), null);
});
