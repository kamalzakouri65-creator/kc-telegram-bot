const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { config } = require('../src/config');
const { pivots, trades, nightsHeld } = require('../src/strategy');
const { clean, fxClosed } = require('../src/data');
const { periodsFor } = require('../src/main');

const bar = (i, o, h, l, cl) => ({ time: new Date(Date.parse('2024-03-04T00:00:00Z') + i * 3600000).toISOString().slice(0, 19).replace('T', ' '), ms: Date.parse('2024-03-04T00:00:00Z') + i * 3600000, open: o, high: h, low: l, close: cl });

test('الشروط كما سُجّلت', () => {
  assert.deepStrictEqual(config.rule, { pivot: 3, rr: 2.5, stopBufferAtr: 0.1, minStopPips: 10 });
  assert.deepStrictEqual(config.costs, { spreadPips: 1.6, slippagePips: 0.2, swapPipsPerNight: 0.5 });
  assert.deepStrictEqual([config.criteria.minTradesPerPeriod, config.criteria.minProfitFactor, config.grid.minPositive], [50, 1.2, 7]);
});

test('القمة لا تُعرف قبل إغلاق الشمعة j+L', () => {
  const c = [1, 2, 3, 5, 3, 2, 1, 2, 3].map((v, i) => bar(i, v, v + 0.1, v - 0.1, v));
  const { highs } = pivots(c, 3);
  assert.deepStrictEqual(highs.map((h) => [h.j, h.known]), [[3, 6]]);
});

test('لا نظر للمستقبل: قطع البيانات لا يغيّر الصفقات المنتهية قبله', () => {
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const c = [];
  let p = 1.1;
  for (let i = 0; i < 6000; i++) {
    const n = p + rnd() * 0.004 + Math.sin(i / 150) * 0.0006;
    c.push(bar(i, p, Math.max(p, n) + Math.abs(rnd()) * 0.0015, Math.min(p, n) - Math.abs(rnd()) * 0.0015, n));
    p = n;
  }
  const full = trades(c);
  assert.ok(full.length > 10, 'يجب أن تظهر صفقات');
  for (const k of [3000, 4500]) {
    const part = trades(c.slice(0, k)).filter((t) => t.closedAt < c[k - 1].time);
    assert.deepStrictEqual(part, full.filter((t) => t.closedAt < c[k - 1].time));
  }
});

test('الليالي، وأوقات إغلاق الفوركس، والفترات البديلة', () => {
  const h = (s) => Date.parse(s + 'Z');
  assert.strictEqual(nightsHeld(h('2024-03-04T20:00:00'), h('2024-03-05T10:00:00')), 1);
  assert.strictEqual(fxClosed(h('2024-03-09T12:00:00')), true, 'السبت');
  assert.strictEqual(fxClosed(h('2024-03-10T22:00:00')), false, 'الأحد بعد 17:00 نيويورك');
  const c = clean([{ time: '2024-03-09 12:00:00', open: 1, high: 1, low: 1, close: 1 }, { time: '2024-03-11 10:00:00', open: 1, high: 1, low: 1, close: 1 }]);
  assert.deepStrictEqual(c.map((x) => x.time), ['2024-03-11 10:00:00']);
  const late = Array.from({ length: 300 }, (_, i) => bar(i, 1, 1, 1, 1));
  assert.strictEqual(periodsFor(late).fallback, true);
});

test('لا كود تداول', () => {
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'src'))) {
    const t = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    for (const p of [/order_send|placeOrder|createOrder|OrderSend/i, /metaapi/i, /withdraw/i]) assert.ok(!p.test(t), `${f}: ${p}`);
  }
});
