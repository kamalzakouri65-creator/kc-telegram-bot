const test = require('node:test');
const assert = require('node:assert');
const { simulate, weekendClosed, group } = require('../src/lows');

const t = (k) => `2026-03-03 ${String(Math.floor(k / 4)).padStart(2, '0')}:${String((k % 4) * 15).padStart(2, '0')}:00`;
// تذبذب حول 4010، قاع عند 4000 (الشمعة 10)، ثم رجوع للقاع (الشمعة 30)
function series(after) {
  const cs = [];
  for (let k = 0; k < 40; k++) cs.push({ time: t(k), open: 4010, high: 4012, low: 4008, close: 4010 });
  cs[10] = { time: t(10), open: 4010, high: 4011, low: 4000, close: 4006 };
  cs[30] = { time: t(30), open: 4008, high: 4009, low: 3999.5, close: 4003 };
  for (const [k, c] of Object.entries(after)) cs[k] = { time: t(Number(k)), ...c };
  return cs;
}

test('شراء عند لمس القاع السابق، والهدف 15$ = +2.89R بعد السبريد', () => {
  const { trades } = simulate(series({ 32: { open: 4005, high: 4016, low: 4004, close: 4015 } }));
  assert.strictEqual(trades.length, 1);
  assert.strictEqual(trades[0].outcome, 'target');
  assert.ok(Math.abs(trades[0].r - (15 - 0.57) / 5) < 1e-9);
});

test('الوقف 5$ = −1.11R، ولمس الوقف في شمعة التنفيذ = خسارة', () => {
  const lose = simulate(series({ 31: { open: 4003, high: 4004, low: 3994, close: 3995 } })).trades[0];
  assert.strictEqual(lose.outcome, 'stop');
  assert.ok(Math.abs(lose.r - (-5 - 0.57) / 5) < 1e-9);
  const same = simulate(series({ 30: { open: 4008, high: 4009, low: 3994, close: 3996 } })).trades[0];
  assert.strictEqual(same.outcome, 'stop');
});

test('قاع مكسور بإغلاق تحته لا يُستعمل', () => {
  const { trades } = simulate(series({ 20: { open: 4008, high: 4009, low: 3998, close: 3999 }, 30: { open: 4008, high: 4009, low: 3999.5, close: 4003 } }));
  assert.ok(trades.every((x) => x.time !== t(30)));
});

test('العطلة والتجميع إلى ساعة', () => {
  assert.strictEqual(weekendClosed('2026-03-06 17:00:00'), true);
  assert.strictEqual(weekendClosed('2026-03-08 18:00:00'), false);
  assert.strictEqual(weekendClosed('2026-03-04 10:00:00'), false);
  const h = group([{ time: '2026-03-04 10:00:00', open: 1, high: 2, low: 0.5, close: 1.5 }, { time: '2026-03-04 10:15:00', open: 1.5, high: 3, low: 1, close: 2 }], 4);
  assert.deepStrictEqual(h, [{ time: '2026-03-04 10:00:00', open: 1, high: 3, low: 0.5, close: 2 }]);
});
