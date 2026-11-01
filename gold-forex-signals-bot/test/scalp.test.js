const test = require('node:test');
const assert = require('node:assert');
const { analyzeSessionBreakout } = require('../src/scalp');

const london = { rangeStart: 7, rangeEnd: 8, tradeUntil: 12 };

// شموع 15 دقيقة ليوم واحد: نطاق 07:00-08:00 بين 99 و 101
function day(after) {
  const rows = [
    ['2026-10-30 06:45:00', 100, 100.5, 99.5, 100],
    ['2026-10-30 07:00:00', 100, 101, 99.5, 100.5],
    ['2026-10-30 07:15:00', 100.5, 100.8, 99, 99.5],
    ['2026-10-30 07:30:00', 99.5, 100.5, 99.2, 100],
    ['2026-10-30 07:45:00', 100, 100.6, 99.6, 100.2],
    ...after,
  ];
  return rows.map(([time, open, high, low, close]) => ({ time, open, high, low, close }));
}

test('إغلاق فوق النطاق بعد الساعة 8 يعطي شراء، والوقف في منتصف النطاق', () => {
  const s = analyzeSessionBreakout(day([['2026-10-30 08:00:00', 100.2, 101.6, 100.1, 101.5]]), london);
  assert.strictEqual(s.side, 'BUY');
  assert.strictEqual(s.stopLoss, 100);
  assert.strictEqual(s.takeProfit1, 103);
  assert.strictEqual(s.takeProfit2, 104.5);
});

test('إغلاق تحت النطاق يعطي بيع', () => {
  const s = analyzeSessionBreakout(day([['2026-10-30 08:15:00', 100, 100.1, 98.4, 98.5]]), london);
  assert.strictEqual(s.side, 'SELL');
  assert.strictEqual(s.stopLoss, 100);
});

test('لا إشارة داخل النطاق، ولا اختراق ثانٍ في نفس اليوم، ولا بعد نهاية وقت الجلسة', () => {
  assert.strictEqual(analyzeSessionBreakout(day([['2026-10-30 08:00:00', 100, 100.9, 99.2, 100.4]]), london), null);
  const second = day([
    ['2026-10-30 08:00:00', 100.2, 101.6, 100.1, 101.5],
    ['2026-10-30 08:15:00', 101.5, 101.6, 98.4, 98.5],
  ]);
  assert.strictEqual(analyzeSessionBreakout(second, london), null);
  assert.strictEqual(analyzeSessionBreakout(day([['2026-10-30 12:00:00', 100.2, 101.6, 100.1, 101.5]]), london), null);
});

test('شموع يوم سابق لا تدخل في نطاق اليوم الحالي', () => {
  const candles = day([]).map((c) => ({ ...c, time: c.time.replace('10-30', '10-29') }));
  candles.push({ time: '2026-10-30 08:00:00', open: 100, high: 102, low: 100, close: 101.8 });
  assert.strictEqual(analyzeSessionBreakout(candles, london), null);
});
