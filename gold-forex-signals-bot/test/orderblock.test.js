const test = require('node:test');
const assert = require('node:assert');
const { analyzeOrderBlock } = require('../src/orderblock');
const { backtest } = require('../src/backtest');

const candle = (open, high, low, close, i) => ({ time: `t${i}`, open, high, low, close });
const bar = (close, prev) => {
  const open = prev;
  return { open, close, high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5 };
};

// قمة عند 104، ثم شمعة هابطة (البلوك) عند القاع، ثم اندفاع يكسر القمة، ثم عودة للبلوك
function bullishSetup() {
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push({ open: 100, high: 100.5, low: 99.5, close: 100 });
  let prev = 100;
  for (const close of [101, 102, 103, 104, 103, 102, 101, 100.5]) {
    rows.push(bar(close, prev));
    prev = close;
  }
  rows.push({ open: 100.5, high: 100.8, low: 98.8, close: 99 }); // Order Block
  prev = 99;
  for (const close of [101, 103, 105, 106, 107, 105, 103, 102]) {
    rows.push(bar(close, prev));
    prev = close;
  }
  return rows;
}
const retest = { open: 101.2, high: 101.8, low: 100.2, close: 101.6 };

const toCandles = (rows) => rows.map((r, i) => candle(r.open, r.high, r.low, r.close, i));
const mirror = (rows) =>
  rows.map((r) => ({ open: 200 - r.open, high: 200 - r.low, low: 200 - r.high, close: 200 - r.close }));

test('عودة السعر لأول مرة إلى Order Block صاعد مع شمعة رفض تعطي شراء', () => {
  const s = analyzeOrderBlock(toCandles([...bullishSetup(), retest]));
  assert.ok(s, 'يجب أن تظهر إشارة');
  assert.strictEqual(s.side, 'BUY');
  assert.deepStrictEqual(s.zone, { top: 100.8, bottom: 98.8 });
  assert.ok(s.stopLoss < 98.8);
  const risk = s.entry - s.stopLoss;
  assert.ok(Math.abs(s.takeProfit1 - (s.entry + 2 * risk)) < 1e-9);
  assert.ok(Math.abs(s.takeProfit2 - (s.entry + 3 * risk)) < 1e-9);
});

test('لا إشارة قبل أن يعود السعر إلى البلوك', () => {
  assert.strictEqual(analyzeOrderBlock(toCandles(bullishSetup())), null);
});

test('البلوك يُستهلك بعد أول لمسة، فلا تتكرر الإشارة', () => {
  assert.strictEqual(analyzeOrderBlock(toCandles([...bullishSetup(), retest, retest])), null);
});

test('لا إشارة إذا أغلقت الشمعة هابطة داخل البلوك (لا يوجد رفض)', () => {
  const noRejection = { open: 101.2, high: 101.3, low: 99.2, close: 99.5 };
  assert.strictEqual(analyzeOrderBlock(toCandles([...bullishSetup(), noRejection])), null);
});

test('الإعداد المعكوس يعطي بيع على Order Block هابط', () => {
  const s = analyzeOrderBlock(toCandles(mirror([...bullishSetup(), retest])));
  assert.ok(s);
  assert.strictEqual(s.side, 'SELL');
  assert.ok(s.stopLoss > s.zone.top && s.takeProfit1 < s.entry);
});

test('الاختبار التاريخي يحسب نصف الصفقة عند الهدف 1 والنصف الآخر عند الوقف', () => {
  const rows = [100, 100, 100, 102.5, 98].map((c) => ({ open: c, high: c + 0.1, low: c - 0.1, close: c }));
  // إشارة شراء واحدة عند الشمعة الثالثة: وقف 99 (مخاطرة 1)، أهداف 102 و 103
  const fn = (cs) =>
    cs.length === 3
      ? { side: 'BUY', time: 't2', entry: 100, stopLoss: 99, takeProfit1: 102, takeProfit2: 103 }
      : null;
  const s = backtest(toCandles(rows), fn);
  assert.strictEqual(s.count, 1);
  assert.strictEqual(s.trades[0].r, 0.5); // (2R + -1R) / 2
  assert.strictEqual(s.wins, 1);

  // سبريد 0.25 مع مخاطرة 1 يخصم 0.25R من الصفقة
  const withSpread = backtest(toCandles(rows), fn, { spread: 0.25 });
  assert.strictEqual(withSpread.trades[0].r, 0.25);
});
