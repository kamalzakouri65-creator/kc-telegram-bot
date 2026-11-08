const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runLongOnly, judge, metrics } = require('../src/engine');
const data = require('../src/data');

// شموع يومية هادئة حول 100، وإشارة شراء وهمية في يوم محدد
const day = (k) => new Date(Date.UTC(2023, 0, 1) + k * 86400000).toISOString().slice(0, 10) + ' 00:00:00';
const flat = (n) => Array.from({ length: n }, (_, k) => ({ time: day(k), open: 100, high: 101, low: 99, close: 100 }));
const signalOn = (when, side = 'BUY') => (cs) => (cs.at(-1).time === when ? { side, time: when, entry: 100, stopLoss: 95, takeProfit1: 107.5, takeProfit2: 115 } : null);

test('شراء ثم الهدفان = +2.25R ناقص التكاليف', () => {
  const cs = flat(30);
  Object.assign(cs[11], { high: 108, low: 99 });
  Object.assign(cs[12], { high: 116, low: 107 });
  const [t] = runLongOnly(cs, signalOn(day(10)), { from: '2023-01-01', costPct: 0.3 });
  // التكلفة 0.3% من 100 = 0.3، على مخاطرة 5 = 0.06R
  assert.ok(Math.abs(t.r - (2.25 - 0.06)) < 1e-9);
});

test('الوقف والهدف في نفس الشمعة = وقف، وإشارات البيع تُتجاهل', () => {
  const cs = flat(30);
  Object.assign(cs[11], { high: 120, low: 90 });
  assert.strictEqual(runLongOnly(cs, signalOn(day(10)), { from: '2023-01-01', costPct: 0 })[0].r, -1);
  assert.strictEqual(runLongOnly(cs, signalOn(day(10), 'SELL'), { from: '2023-01-01' }).length, 0);
});

test('لا صفقات قبل بداية الفترة أو بعد نهايتها (حماية بيانات التأكيد)', () => {
  const cs = flat(30);
  Object.assign(cs[11], { low: 94 });
  assert.strictEqual(runLongOnly(cs, signalOn(day(10)), { from: day(15) }).length, 0);
  assert.strictEqual(runLongOnly(cs, signalOn(day(10)), { from: '2023-01-01', to: day(5) }).length, 0);
  assert.strictEqual(runLongOnly(cs, signalOn(day(10)), { from: '2023-01-01' }).length, 1);
});

test('الحكم: 3 عملات رابحة من 4، و PF ≥ 1.2، و 30 صفقة', () => {
  const t = (r, n) => Array.from({ length: n }, (_, k) => ({ r, closedAt: day(k) }));
  const good = { A: [...t(2, 8), ...t(-1, 6)], B: [...t(2, 8), ...t(-1, 6)], C: [...t(2, 8), ...t(-1, 6)], D: t(-1, 4) };
  assert.strictEqual(judge(good).pass, true);
  const twoOnly = { A: t(2, 20), B: t(2, 20), C: t(-1, 5), D: t(-1, 5) };
  assert.match(judge(twoOnly).reasons.join(), /على 2 عملات/);
  assert.strictEqual(metrics([]).count, 0);
});

test('بيانات Binance العامة فقط', async () => {
  assert.deepStrictEqual(data.ALLOWED_PATHS, ['/api/v3/klines']);
  await assert.rejects(data.publicGet('/api/v3/order', {}), /غير مسموح/);
  const src = fs.readdirSync(path.join(__dirname, '..', 'src')).map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).join('\n');
  for (const p of [/X-MBX-APIKEY/i, /signature=/i, /api[_-]?secret/i, /\/sapi\//i, /withdraw/i]) assert.ok(!p.test(src), String(p));
});
