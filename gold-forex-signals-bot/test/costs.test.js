const test = require('node:test');
const assert = require('node:assert');
const { costR, netR, netTotal, nightsHeld } = require('../src/costs');
const { formatResults, formatWeekly } = require('../src/format');

const gold = { symbol: 'XAU/USD', interval: '4h', strategy: 'pullback', side: 'SELL', time: '2026-11-11 16:00:00', closedAt: '2026-11-11 20:00:00', entry: 4000, stopLoss: 4010, r: 2.25 };

test('تكلفة الذهب: سبريد + انزلاق، و Swap عند المرور بـ 21:00 UTC', () => {
  // الدخول عند إغلاق شمعة 16:00 (أي 20:00)، والخروج داخل شمعة 20:00–24:00: مرور بـ 21:00 = ليلة واحدة
  assert.ok(Math.abs(costR(gold) - (0.34 + 4000 * 0.0002) / 10) < 1e-9);
  assert.ok(Math.abs(costR({ ...gold, closedAt: '2026-11-11 16:00:00', time: '2026-11-11 12:00:00' }) - 0.034) < 1e-9, 'بدون ليلة');
});

test('عدد الليالي', () => {
  const h = (s) => Date.parse(s + 'Z');
  assert.strictEqual(nightsHeld(h('2026-11-11T20:00:00'), h('2026-11-11T20:59:59')), 0);
  assert.strictEqual(nightsHeld(h('2026-11-11T20:00:00'), h('2026-11-12T10:00:00')), 1);
});

test('تكلفة الفضة والكريبتو والمؤشرات، وسوق غير معروف = null', () => {
  const silver = { ...gold, symbol: 'XAG/USD', interval: '1h', time: '2026-11-11 10:00:00', closedAt: '2026-11-11 12:00:00', entry: 50, stopLoss: 50.5 };
  assert.ok(Math.abs(costR(silver) - 0.08 / 0.5) < 1e-9);
  const btc = { symbol: 'BTC/USDT', interval: '1day', time: '2026-11-01 00:00:00', closedAt: '2026-11-09 00:00:00', entry: 100000, stopLoss: 95000, r: 1 };
  assert.ok(Math.abs(costR(btc) - (100000 * 0.3) / 100 / 5000) < 1e-9);
  const spx = { symbol: 'S&P 500', interval: '1day', time: '2026-11-18 14:30:00', closedAt: '2026-11-20 14:30:00', entry: 6000, stopLoss: 5880, r: 0.5 };
  assert.ok(Math.abs(costR(spx) - (6000 * (0.01 + 2 * 0.02)) / 100 / 120) < 1e-9);
  assert.strictEqual(costR({ ...gold, symbol: 'EUR/USD' }), null);
  assert.deepStrictEqual(netTotal([gold, { ...gold, symbol: 'EUR/USD', r: 1 }]).unknown, 1);
  assert.ok(Math.abs(netR(gold) - (2.25 - 0.114)) < 1e-9);
});

test('/results والملخص الأسبوعي يعرضان النتيجة قبل التكاليف وبعدها، وكل سوق', () => {
  const loss = { ...gold, symbol: 'XAG/USD', interval: '4h', time: '2026-11-10 12:00:00', closedAt: '2026-11-10 16:00:00', entry: 50, stopLoss: 50.5, r: -1 };
  const s = { closed: 2, wins: 1, losses: 1, totalR: 1.25, byStrategy: { pullback: { closed: 2, wins: 1, totalR: 1.25 } }, bySide: { SELL: { closed: 2, wins: 1, totalR: 1.25 }, BUY: { closed: 0 } }, open: [], recent: [gold, loss], closedTrades: [gold, loss] };
  const text = formatResults(s);
  assert.match(text, /المجموع: \+1\.25R قبل التكاليف \| \+0\.98R بعد التكاليف \(تقديري\)/);
  assert.match(text, /• الذهب: 1 مغلقة \| رابحة 1 \| \+2\.14R/);
  assert.match(text, /• الفضة: 1 مغلقة \| رابحة 0 \| -1\.16R/);
  assert.match(text, /• المؤشرات: 0 مغلقة/);
  assert.match(text, /→ -1\.00R \(بعد التكاليف -1\.16R\)/);
  assert.doesNotMatch(text, /النتائج بدون السبريد/);
  const weekly = formatWeekly([gold, loss], [], '2026-11-06 22:00:00', s);
  assert.match(weekly, /المجموع: \+1\.25R \(بعد التكاليف \+0\.98R\)/);
  assert.match(weekly, /منذ البداية: 2 مغلقة \| \+1\.25R \(بعد التكاليف \+0\.98R\)/);
});
