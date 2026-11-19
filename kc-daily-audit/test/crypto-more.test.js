const test = require('node:test');
const assert = require('node:assert');
const { SPEC, judge, thirds } = require('../src/crypto-more');

function daily(n, seed0, from = '2019-01-01') {
  let seed = seed0;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const out = [];
  let p = 1;
  for (let k = 0; k < n; k++) {
    const next = p * (1 + rnd() * 0.06 + 0.001);
    out.push({ time: `${new Date(Date.parse(from) + k * 86400000).toISOString().slice(0, 10)} 00:00:00`, open: p, high: Math.max(p, next) * 1.02, low: Math.min(p, next) * 0.98, close: next });
    p = next;
  }
  return out;
}

test('الشروط كما سُجّلت', () => {
  assert.deepStrictEqual(SPEC.pairs, ['XRPUSDT', 'ADAUSDT', 'DOTUSDT', 'LTCUSDT', 'LINKUSDT', 'BCHUSDT', 'XLMUSDT', 'DOGEUSDT', 'UNIUSDT', 'TRXUSDT']);
  assert.deepStrictEqual(SPEC.criteria, { minPositivePairs: 7, minPf: 1.2, minTrades: 60 });
  assert.ok(Math.abs(SPEC.costPct - 0.3) < 1e-9);
});

test('الأثلاث تبدأ بعد التسخين وتغطي حتى النهاية', () => {
  const c = daily(1000, 5);
  const b = thirds(c);
  assert.strictEqual(b[0], c[210].time.slice(0, 10));
  assert.strictEqual(b[3], c.at(-1).time.slice(0, 10));
});

test('الحكم يعمل على مجموعة ويعدّ العملات الرابحة', () => {
  const byPair = Object.fromEntries(SPEC.pairs.map((p, k) => [p, daily(1500, 7 + k)]));
  const j = judge(byPair);
  assert.strictEqual(j.rows.length, 10);
  assert.ok(j.m.n > 0);
  assert.strictEqual(j.positive, j.rows.filter((r) => r.m.net > 0).length);
});
