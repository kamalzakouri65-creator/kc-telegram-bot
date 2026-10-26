const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTracker } = require('../src/tracker');
const { formatTradeEvent, formatResults } = require('../src/format');

// شراء من 100، وقف 99 (مخاطرة 1)، الهدف 1 = 101.5 والهدف 2 = 103
const signal = { side: 'BUY', time: '2026-10-27 10:00:00', entry: 100, stopLoss: 99, takeProfit1: 101.5, takeProfit2: 103 };
const bar = (time, low, high) => ({ time, open: low, high, low, close: high });

function tempTracker() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-')), 'trades.json');
  return { file, tracker: createTracker(file) };
}

test('الهدف 1 ثم الهدف 2: رسالتان والنتيجة +2.25R', () => {
  const { tracker } = tempTracker();
  tracker.add('XAU/USD', '1h', signal);
  const candles = [
    bar('2026-10-27 10:00:00', 99.5, 100.5), // شمعة الإشارة نفسها لا تُحسب
    bar('2026-10-27 11:00:00', 100, 101.6),
    bar('2026-10-27 12:00:00', 101, 103.2),
  ];
  const events = tracker.update('XAU/USD', '1h', candles);
  assert.deepStrictEqual(events.map((e) => e.type), ['tp1', 'tp2']);
  assert.strictEqual(events[1].trade.r, 2.25);
  assert.match(formatTradeEvent(events[1]), /الهدف 2.*\n.*\+2\.25R/);
});

test('ضرب الوقف بعد الهدف 1 يعطي +0.25R، ولا تتكرر الأحداث عند إعادة الفحص', () => {
  const { tracker } = tempTracker();
  tracker.add('XAU/USD', '1h', signal);
  const candles = [bar('2026-10-27 11:00:00', 100, 101.6), bar('2026-10-27 12:00:00', 98.5, 100.5)];
  assert.deepStrictEqual(tracker.update('XAU/USD', '1h', candles).map((e) => e.type), ['tp1', 'sl']);
  assert.deepStrictEqual(tracker.update('XAU/USD', '1h', candles), []);
  const s = tracker.summary();
  assert.strictEqual(s.closed, 1);
  assert.strictEqual(s.totalR, 0.25);
});

test('الوقف والهدف في نفس الشمعة يُحسب وقفاً (-1R)', () => {
  const { tracker } = tempTracker();
  tracker.add('XAU/USD', '1h', signal);
  const [e] = tracker.update('XAU/USD', '1h', [bar('2026-10-27 11:00:00', 98.5, 101.6)]);
  assert.strictEqual(e.type, 'sl');
  assert.strictEqual(e.trade.r, -1);
  assert.match(formatResults(tracker.summary()), /خاسرة: 1/);
});

test('الإشارات تبقى محفوظة بعد إعادة تشغيل البوت، ولا تُضاف مرتين', () => {
  const { file, tracker } = tempTracker();
  tracker.add('XAU/USD', '1h', signal);
  const reloaded = createTracker(file);
  assert.ok(reloaded.has('XAU/USD', '1h', signal));
  assert.strictEqual(reloaded.summary().open.length, 1);
  // رمز أو إطار مختلف لا يتأثر
  assert.deepStrictEqual(reloaded.update('EUR/USD', '1h', [bar('2026-10-27 11:00:00', 0, 1000)]), []);
});
