const test = require('node:test');
const assert = require('node:assert');
const { runRsi2, metrics, judge, sma, rsiWilder, nights } = require('../src/engine');
const { parseDaily } = require('../src/data');

const day = (k) => new Date(Date.UTC(2021, 0, 4) + k * 86400000).toISOString().slice(0, 10);
// 250 يوماً صاعدة بهدوء، ثم 3 أيام هبوط حاد، ثم ارتداد
function series({ crash = true, gapBelowStop = false } = {}) {
  const cs = [];
  let p = 100;
  for (let k = 0; k < 250; k++) {
    const o = p;
    p += k % 2 ? 0.3 : -0.1;
    cs.push({ time: day(k), open: o, high: Math.max(o, p) + 0.3, low: Math.min(o, p) - 0.3, close: p });
  }
  if (crash) for (let k = 0; k < 3; k++) {
    const o = p;
    p -= 1.5;
    cs.push({ time: day(250 + k), open: o, high: o + 0.1, low: p - 0.2, close: p });
  }
  const o = p;
  if (gapBelowStop) cs.push({ time: day(253), open: p - 10, high: p - 9, low: p - 11, close: p - 10 });
  else for (let k = 0; k < 3; k++) {
    p += 2;
    cs.push({ time: day(253 + k), open: p - 2, high: p + 0.2, low: p - 2.1, close: p });
  }
  return cs;
}

test('المؤشرات: SMA و RSI(2)', () => {
  assert.deepStrictEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  const r = rsiWilder([10, 11, 12, 11, 10, 9, 8], 2);
  assert.deepStrictEqual(r, [null, null, 100, 50, 25, 12.5, 6.25]);
});

test('RSI(2): شراء بعد هبوط حاد في سوق صاعد، والخروج عند الإغلاق فوق متوسط 5 أيام', () => {
  const trades = runRsi2(series(), { from: '2021-01-01', spreadPct: 0 });
  assert.strictEqual(trades.length, 1);
  const t = trades[0];
  assert.ok(t.r > 0, 'الارتداد رابح');
  assert.ok(t.time >= day(250) && t.closedAt > t.time);
});

test('RSI(2): فجوة تحت الوقف تُغلق بسعر الافتتاح (خسارة أكبر من 1R)', () => {
  const [t] = runRsi2(series({ gapBelowStop: true }), { from: '2021-01-01', spreadPct: 0 });
  assert.ok(t.r < -1);
});

test('لا صفقات خارج الفترة، و Swap عن كل ليلة', () => {
  assert.strictEqual(runRsi2(series(), { from: '2030-01-01', spreadPct: 0 }).length, 0);
  assert.strictEqual(nights('2026-11-06', '2026-11-09'), 3, 'الجمعة → الإثنين = 3 ليالٍ');
  const free = runRsi2(series(), { from: '2021-01-01', spreadPct: 0 })[0].r;
  const paid = runRsi2(series(), { from: '2021-01-01', spreadPct: 0.01 })[0].r;
  assert.ok(paid < free);
});

test('الحكم: Nasdaq يجتاز و S&P موجب', () => {
  const ok = { count: 25, profitFactor: 1.5, totalR: 8 };
  assert.strictEqual(judge(ok, { totalR: 2 }).pass, true);
  assert.match(judge(ok, { totalR: -1 }).reasons.join(), /S&P 500 غير رابح/);
  assert.match(judge({ count: 10, profitFactor: 2, totalR: 5 }, { totalR: 1 }).reasons.join(), /أقل من 20/);
  assert.strictEqual(metrics([]).count, 0);
});

test('قراءة بيانات Yahoo اليومية وتجاهل القيم الناقصة والمكررة', () => {
  const ts = [Date.UTC(2026, 0, 2) / 1000, Date.UTC(2026, 0, 5) / 1000, Date.UTC(2026, 0, 5) / 1000 + 3600];
  const json = { chart: { result: [{ timestamp: ts, indicators: { quote: [{ open: [1, null, 3], high: [1, 2, 3], low: [1, 2, 3], close: [1, 2, 3] }] } }] } };
  assert.deepStrictEqual(parseDaily(json).map((c) => c.time), ['2026-01-02', '2026-01-05']);
});
