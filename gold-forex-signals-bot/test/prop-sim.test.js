const test = require('node:test');
const assert = require('node:assert');
const { onePerSide, runPhase, simulate, summarize, pathStats } = require('../src/prop-sim');

const T = (day, r, extra = {}) => ({ time: `2026-01-${String(day).padStart(2, '0')} 10:00:00`, closedAt: `2026-01-${String(day).padStart(2, '0')} 18:00:00`, r, symbol: 'XAU/USD', side: 'BUY', ...extra });

test('المرحلة تنجح عند الوصول للهدف، وتفشل عند الخسارة اليومية أو الكلية', () => {
  assert.strictEqual(runPhase([T(1, 2.25), T(2, 2.25), T(3, 2.25), T(4, 2.25)], '2026-01-01 00:00:00', 8, 1).result, 'pass');
  const daily = runPhase([T(5, -1), T(5, -1), T(5, -1), T(5, -1), T(5, -1)], '2026-01-01 00:00:00', 8, 1);
  assert.deepStrictEqual([daily.result, daily.reason], ['fail', 'daily']);
  const max = runPhase(Array.from({ length: 10 }, (_, k) => T(k + 1, -1)), '2026-01-01 00:00:00', 8, 1);
  assert.deepStrictEqual([max.result, max.reason], ['fail', 'max']);
  assert.strictEqual(runPhase([T(1, 1)], '2026-01-01 00:00:00', 8, 1).result, 'open');
});

test('صفقة واحدة في نفس الاتجاه على نفس الرمز', () => {
  const a = { time: '2026-01-01 10:00:00', closedAt: '2026-01-01 20:00:00', symbol: 'XAG/USD', side: 'SELL', r: 1 };
  const b = { ...a, time: '2026-01-01 12:00:00' }; // أثناء a: تُتخطى
  const c = { ...a, time: '2026-01-01 12:00:00', side: 'BUY' }; // اتجاه آخر: تُقبل
  const d = { ...a, time: '2026-01-01 21:00:00' }; // بعد إغلاق a: تُقبل
  assert.deepStrictEqual(onePerSide([b, a, c, d]).map((t) => t.time + t.side), ['2026-01-01 10:00:00SELL', '2026-01-01 12:00:00BUY', '2026-01-01 21:00:00SELL']);
});

test('المحاكاة الأسبوعية والملخص وأسوأ يوم', () => {
  const trades = Array.from({ length: 28 }, (_, k) => T(k + 1, k % 3 === 2 ? -1 : 1.5));
  const s = summarize(simulate(trades, 1).runs);
  assert.ok(s.total >= 1 && s.passRate === 100 && s.medianDays > 0);
  const p = pathStats([T(1, 1), T(2, -1), T(2, -1), T(3, 2)], 1);
  assert.deepStrictEqual([p.worstDay, p.maxDd, p.total], [-2, 2, 1]);
});

test('حد الصفقات في نفس الاتجاه، وأكبر عدد مفتوح معاً', () => {
  const { maxPerSide, peakOpen } = require('../src/prop-sim');
  const t = (h, c, side = 'SELL') => ({ time: `2026-01-01 ${h}:00:00`, closedAt: `2026-01-01 ${c}:00:00`, symbol: 'XAG/USD', side, r: 1 });
  const all = [t('10', '20'), t('11', '20'), t('12', '20'), t('13', '20', 'BUY')];
  assert.strictEqual(maxPerSide(all, 1).length, 2);
  assert.strictEqual(maxPerSide(all, 2).length, 3);
  assert.strictEqual(maxPerSide(all, Infinity).length, 4);
  assert.strictEqual(peakOpen(all), 4);
  assert.strictEqual(peakOpen([t('10', '11'), t('11', '12')]), 1, 'صفقة تُغلق في نفس لحظة فتح أخرى لا تُحسب معها');
});
