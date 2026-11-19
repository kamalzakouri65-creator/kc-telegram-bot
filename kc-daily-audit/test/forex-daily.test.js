const test = require('node:test');
const assert = require('node:assert');
const { SPEC, fxRun } = require('../src/forex-daily');
const { runRsi2 } = require('../../kc-nasdaq-daily/src/engine');

function daily(n = 2500) {
  let seed = 31;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const out = [];
  let p = 1.1;
  for (let k = 0; out.length < n; k++) {
    const d = new Date(Date.parse('2010-01-04') + k * 86400000);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const next = p * (1 + rnd() * 0.012 + 0.0002);
    out.push({ time: d.toISOString().slice(0, 10), open: p, high: Math.max(p, next) * 1.002, low: Math.min(p, next) * 0.998, close: next });
    p = next;
  }
  return out;
}

test('الشروط كما سُجّلت', () => {
  assert.deepStrictEqual(SPEC.pairs.map((p) => [p.name, p.spreadPips]), [['EUR/USD', 1.6], ['GBP/USD', 2.5], ['USD/JPY', 2.5], ['USD/CHF', 2.5], ['AUD/USD', 2.5], ['USD/CAD', 2.5], ['NZD/USD', 2.5]]);
  assert.deepStrictEqual([SPEC.swapPipsPerNight, SPEC.minPf, SPEC.minTrades, SPEC.grid.minPositive, SPEC.maxFlat], [0.5, 1.2, 20, 7, 0.05]);
});

test('نفس الدخول والخروج كمحرك kc-nasdaq-daily، والتكلفة بالنقاط', () => {
  const c = daily();
  const a = runRsi2(c, { from: '0000', spreadPct: 0 });
  const pair = SPEC.pairs[0];
  const b = fxRun(c, pair);
  assert.ok(a.length > 10);
  assert.deepStrictEqual(b.map((t) => [t.time, t.closedAt]), a.map((t) => [t.time, t.closedAt]));
  const free = fxRun(c, { ...pair, spreadPips: 0 });
  assert.ok(b.reduce((s, t) => s + t.r, 0) < free.reduce((s, t) => s + t.r, 0));
});
