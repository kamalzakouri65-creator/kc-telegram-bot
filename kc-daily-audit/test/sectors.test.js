const test = require('node:test');
const assert = require('node:assert');
const { SPEC, rsi2Run } = require('../src/sectors');
const { runRsi2 } = require('../../kc-nasdaq-daily/src/engine');

function daily(n = 2500) {
  let seed = 21;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const out = [];
  let p = 100;
  for (let k = 0; out.length < n; k++) {
    const d = new Date(Date.parse('2010-01-04') + k * 86400000);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const o = p * (1 + rnd() * 0.004);
    const next = p * (1 + rnd() * 0.025 + 0.0005);
    out.push({ time: d.toISOString().slice(0, 10), open: o, high: Math.max(o, next) * 1.004, low: Math.min(o, next) * 0.996, close: next });
    p = next;
  }
  return out;
}

test('الشروط كما سُجّلت', () => {
  assert.deepStrictEqual(SPEC.tickers.map((t) => t[0]), ['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLB', 'XLU']);
  assert.deepStrictEqual([SPEC.spreadPct, SPEC.swapPctPerNight, SPEC.minPf, SPEC.minTrades, SPEC.grid.minPositive], [0.05, 0.02, 1.2, 20, 7]);
});

test('وضع الإغلاق يطابق محرك kc-nasdaq-daily (نفس الدخول والخروج)', () => {
  const c = daily();
  const a = runRsi2(c, { from: '0000', spreadPct: 0.05 });
  const b = rsi2Run(c);
  assert.ok(a.length > 10);
  assert.deepStrictEqual(b.map((t) => [t.time, t.closedAt]), a.map((t) => [t.time, t.closedAt]));
});

test('وضع افتتاح اليوم التالي: الدخول بعد يوم الإشارة، ولا دخول قبل معرفة الإشارة', () => {
  const c = daily();
  const signal = rsi2Run(c);
  const next = rsi2Run(c, { mode: 'nextOpen' });
  assert.ok(next.length > 10);
  const days = c.map((x) => x.time);
  for (const t of next) assert.ok(t.closedAt > t.time, 'الخروج بعد الدخول');
  // أول صفقة: يوم الدخول = اليوم التالي لأول إشارة
  assert.strictEqual(days.indexOf(next[0].time), days.indexOf(signal[0].time) + 1);
});
