const test = require('node:test');
const assert = require('node:assert');
const { entryAt, simulate } = require('../src/obtarget');

const bar = (close, prev) => ({ open: prev, close, high: Math.max(prev, close) + 0.5, low: Math.min(prev, close) - 0.5 });

// نفس إعداد اختبار order-block: بلوك صاعد بين 98.8 و 100.8، ثم اندفاع يكسر القمة
function bullishSetup() {
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push({ open: 100, high: 100.5, low: 99.5, close: 100 });
  let prev = 100;
  for (const close of [101, 102, 103, 104, 103, 102, 101, 100.5]) {
    rows.push(bar(close, prev));
    prev = close;
  }
  rows.push({ open: 100.5, high: 100.8, low: 98.8, close: 99 });
  prev = 99;
  for (const close of [101, 103, 105, 106, 107, 105, 103, 102]) {
    rows.push(bar(close, prev));
    prev = close;
  }
  return rows;
}
const toCandles = (rows) => rows.map((r, i) => ({ time: `t${i}`, ...r }));
const retest = { open: 101.2, high: 101.8, low: 100.2, close: 101.6 };

test('وضع اللمس يدخل عند حافة البلوك، ووضع الرفض يدخل عند الإغلاق', () => {
  const candles = toCandles([...bullishSetup(), retest]);
  const touch = entryAt(candles, 'touch');
  assert.strictEqual(touch.side, 'BUY');
  assert.strictEqual(touch.entry, 100.8);
  assert.ok(touch.stopLoss < 98.8);
  assert.strictEqual(touch.stoppedNow, false);
  assert.strictEqual(entryAt(candles, 'reject').entry, 101.6);
});

test('هدف 10$ يتحقق فيُحسب الربح بعد خصم السبريد', () => {
  const after = { open: 101.6, high: 111, low: 101, close: 110 };
  const s = simulate(toCandles([...bullishSetup(), retest, after]), { mode: 'touch', target: 10, spread: 0.35 });
  assert.strictEqual(s.count, 1);
  assert.strictEqual(s.wins, 1);
  assert.ok(Math.abs(s.totalUsd - 9.65) < 1e-9);
});

test('شمعة الدخول التي تلمس الوقف تُحسب خسارة فوراً', () => {
  const crash = { open: 101.2, high: 101.4, low: 97, close: 97.5 };
  const s = simulate(toCandles([...bullishSetup(), crash]), { mode: 'touch', target: 10 });
  assert.strictEqual(s.count, 1);
  assert.strictEqual(s.wins, 0);
  assert.ok(s.totalUsd < -2);
});
