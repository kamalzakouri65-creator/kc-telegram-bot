const test = require('node:test');
const assert = require('node:assert');
const { runTrend, judge } = require('../src/trend');

const day = (k) => new Date(Date.UTC(2022, 0, 3) + k * 86400000).toISOString().slice(0, 10);
const flat = (n) => Array.from({ length: n }, (_, k) => ({ time: day(k), open: 100, high: 101, low: 99, close: 100 }));
const sig = (when, side) => (cs) => (cs.at(-1).time === when ? { side, entry: 100, stopLoss: side === 'BUY' ? 95 : 105, takeProfit1: side === 'BUY' ? 107.5 : 92.5, takeProfit2: side === 'BUY' ? 115 : 85 } : null);

test('بيع: الهدفان = +2.25R ناقص السبريد والـ Swap', () => {
  const cs = flat(20);
  Object.assign(cs[6], { low: 92, high: 100 });
  Object.assign(cs[7], { low: 84, high: 93 });
  const [t] = runTrend(cs, sig(day(5), 'SELL'), { from: '2022-01-01', spreadPct: 0.1, swapPct: 0.02 });
  // التكلفة: (0.1% + ليلتان × 0.02%) من 100 = 0.14، على مخاطرة 5 = 0.028R
  assert.strictEqual(t.side, 'SELL');
  assert.ok(Math.abs(t.r - (2.25 - 0.028)) < 1e-9);
});

test('شراء: الوقف والهدف في نفس الشمعة = وقف، ولا صفقات خارج الفترة', () => {
  const cs = flat(20);
  Object.assign(cs[6], { low: 90, high: 120 });
  assert.strictEqual(runTrend(cs, sig(day(5), 'BUY'), { from: '2022-01-01', spreadPct: 0, swapPct: 0 })[0].r, -1);
  assert.strictEqual(runTrend(cs, sig(day(5), 'BUY'), { from: day(10), spreadPct: 0 }).length, 0);
});

test('الحكم: الذهب يجتاز والفضة رابحة', () => {
  assert.strictEqual(judge({ count: 20, profitFactor: 1.5, totalR: 6 }, { totalR: 1 }).pass, true);
  assert.match(judge({ count: 20, profitFactor: 1.5, totalR: 6 }, { totalR: -1 }).reasons.join(), /الفضة غير رابحة/);
  assert.match(judge({ count: 10, profitFactor: 2, totalR: 6 }, { totalR: 1 }).reasons.join(), /أقل من 15/);
});

test('شراء فقط: إشارة البيع تُتجاهل', () => {
  const cs = flat(20);
  Object.assign(cs[6], { low: 84, high: 100 });
  assert.strictEqual(runTrend(cs, sig(day(5), 'SELL'), { from: '2022-01-01', spreadPct: 0, longOnly: true }).length, 0);
  assert.strictEqual(runTrend(cs, sig(day(5), 'SELL'), { from: '2022-01-01', spreadPct: 0 }).length, 1);
});
