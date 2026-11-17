const test = require('node:test');
const assert = require('node:assert');
const { rsi2Trades, dollarSim, tomTrades, SIM, GRID, TOM } = require('../src/research');
const { runRsi2 } = require('../../kc-nasdaq-daily/src/engine');

function daily(n = 2500, from = '2010-01-04') {
  let seed = 13;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const out = [];
  let p = 1000;
  for (let k = 0; out.length < n; k++) {
    const d = new Date(Date.parse(from) + k * 86400000);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const next = p * (1 + rnd() * 0.025 + 0.0005);
    out.push({ time: d.toISOString().slice(0, 10), open: p, high: Math.max(p, next) * 1.004, low: Math.min(p, next) * 0.996, close: next });
    p = next;
  }
  return out;
}

test('الشروط كما سُجّلت', () => {
  assert.deepStrictEqual([SIM.start, SIM.stopRule, SIM.bigLoss, SIM.spreadPts, SIM.lots], [500, 100, 20, 0.4, [0.1, 0.14]]);
  assert.deepStrictEqual([GRID.entry, GRID.exit, GRID.minPositive], [[5, 10, 15], [3, 5, 10], 7]);
  assert.deepStrictEqual([TOM.minTrades, TOM.minPf, TOM.maxFlat], [20, 1.2, 0.05]);
});

test('صفقات RSI(2) بالتفاصيل تطابق محرك kc-nasdaq-daily (نفس الدخول والخروج)', () => {
  const c = daily();
  const a = runRsi2(c, { from: '0000', spreadPct: 0.01 });
  const b = rsi2Trades(c);
  assert.ok(a.length > 10);
  assert.deepStrictEqual(b.map((t) => [t.time, t.closedAt]), a.map((t) => [t.time, t.closedAt]));
});

test('محاكاة الدولار: الربح والتكاليف وقاعدة الـ 100$', () => {
  const t = { time: '2026-01-05', closedAt: '2026-01-07', entry: 7000, stop: 6800, exit: 7100 };
  const s = dollarSim([t], 0.1);
  // 0.1 × 100 − 0.1 × 0.4 − 0.1 × 7000 × 0.02% × 2 ليلة = 10 − 0.04 − 0.28
  assert.ok(Math.abs(s.end - (500 + 10 - 0.04 - 0.28)) < 1e-9);
  assert.ok(Math.abs(s.stopMax - 20) < 1e-9, 'الخسارة عند الوقف = 0.1 × 200');
  const losses = Array.from({ length: 6 }, (_, k) => ({ time: `2026-02-${10 + k}`, closedAt: `2026-02-${10 + k}`, entry: 7000, stop: 6800, exit: 6800 }));
  assert.strictEqual(dollarSim(losses, 0.1).stopHitAt, '2026-02-14', 'الخسارة الخامسة تصل −100$');
  assert.strictEqual(dollarSim(losses, 0.1, { skipAbove: 19 }).n, 0);
});

test('بداية الشهر: الدخول قبل آخر يوم بيوم، والخروج في اليوم الثالث من الشهر الجديد', () => {
  const c = daily(120, '2026-01-01');
  const t = tomTrades(c, { spreadPct: 0 });
  const jan = c.filter((x) => x.time.startsWith('2026-01'));
  const feb = c.filter((x) => x.time.startsWith('2026-02'));
  const first = t.find((x) => x.time.startsWith('2026-01'));
  assert.strictEqual(first.time, jan.at(-2).time);
  assert.ok(first.closedAt <= feb[2].time);
});
