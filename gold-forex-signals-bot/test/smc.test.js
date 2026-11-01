const test = require('node:test');
const assert = require('node:assert');
const { analyzeSmc } = require('../src/smc');
const { formatSignal } = require('../src/format');

// قمة عند 103 (الشمعة 62)، قاع عند 97.5 (66)، سحب سيولة تحته (71)، اندفاع يكسر الهيكل
// ويترك فجوة بين 99.0 و 100.2 (73)، ثم عودة للفجوة مع إغلاق صاعد (78)
function bullishSetup({ sweepLow = 96.8 } = {}) {
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push([100, 100.5, 99.5, 100]);
  rows.push(
    [100, 101, 99.8, 100.8],
    [100.8, 102, 100.5, 101.8],
    [101.8, 103, 101.5, 102.5],
    [102.5, 102.6, 101, 101.2],
    [101.2, 101.4, 99.5, 99.8],
    [99.8, 100, 98.5, 98.8],
    [98.8, 99, 97.5, 97.8],
    [97.8, 98.8, 97.7, 98.5],
    [98.5, 99.2, 98.2, 99],
    [99, 99.5, 98.6, 99.2],
    [99.2, 99.4, 98.4, 98.6],
    [98.6, 98.8, sweepLow, 97.9],
    [97.9, 99.0, 97.8, 98.9],
    [98.9, 101.8, 98.8, 101.6],
    [101.6, 103.8, 100.2, 103.5],
    [103.5, 104, 102.5, 102.8],
    [102.8, 103, 101.2, 101.5],
    [101.5, 101.7, 100.6, 100.8],
    [100.8, 101.6, 99.8, 101.3]
  );
  return rows.map(([open, high, low, close], i) => ({ time: `t${i}`, open, high, low, close }));
}
const mirror = (candles) =>
  candles.map((c) => ({ time: c.time, open: 200 - c.open, high: 200 - c.low, low: 200 - c.high, close: 200 - c.close }));

test('سحب سيولة ثم كسر هيكل ثم عودة للفجوة يعطي شراء، والوقف تحت قاع السحب', () => {
  const s = analyzeSmc(bullishSetup());
  assert.ok(s, 'يجب أن تظهر إشارة');
  assert.strictEqual(s.side, 'BUY');
  assert.strictEqual(s.entry, 101.3);
  assert.ok(s.stopLoss < 96.8);
  assert.deepStrictEqual(s.zone, { top: 100.2, bottom: 99 });
  const risk = s.entry - s.stopLoss;
  assert.ok(Math.abs(s.takeProfit1 - (s.entry + 2 * risk)) < 1e-9);
  assert.ok(Math.abs(s.takeProfit2 - (s.entry + 4 * risk)) < 1e-9);
  assert.match(formatSignal('XAU/USD', '1h', s, 'smc'), /Smart Money[\s\S]*🧱 FVG: 99\.00 - 100\.20/);
});

test('بدون سحب سيولة لا توجد إشارة', () => {
  assert.strictEqual(analyzeSmc(bullishSetup({ sweepLow: 97.6 })), null);
});

test('قبل العودة إلى الفجوة لا توجد إشارة', () => {
  assert.strictEqual(analyzeSmc(bullishSetup().slice(0, -1)), null);
});

test('الإعداد المعكوس يعطي بيع بوقف فوق قمة السحب', () => {
  const s = analyzeSmc(mirror(bullishSetup()));
  assert.strictEqual(s.side, 'SELL');
  assert.ok(Math.abs(s.entry - 98.7) < 1e-9);
  assert.ok(s.stopLoss > 103.2);
  assert.ok(s.takeProfit1 < s.entry && s.takeProfit2 < s.takeProfit1);
  assert.ok(Math.abs(s.zone.bottom - 99.8) < 1e-9 && Math.abs(s.zone.top - 101) < 1e-9);
});
