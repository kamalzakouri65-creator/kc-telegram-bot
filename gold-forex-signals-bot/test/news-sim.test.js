const test = require('node:test');
const assert = require('node:assert');
const { nfpDates, nyToUtc, usDst, exposedTo, decide, stats } = require('../src/news-sim');

test('تواريخ NFP: أول جمعة، ويناير الجمعة الثانية، وأشهر الإغلاق الحكومي مستثناة', () => {
  const d = nfpDates('2024-11', '2026-02');
  assert.ok(d.includes('2024-11-01'));
  assert.ok(d.includes('2025-01-10'), 'يناير 2025: الجمعة الثانية');
  assert.ok(d.includes('2025-09-05'));
  assert.ok(!d.some((x) => x.startsWith('2025-10') || x.startsWith('2025-11') || x.startsWith('2025-12')));
  assert.ok(d.includes('2026-01-09'));
  assert.ok(d.includes('2026-02-06'));
});

test('التوقيت الصيفي الأمريكي وتحويل نيويورك إلى UTC', () => {
  assert.strictEqual(usDst('2026-03-07'), false);
  assert.strictEqual(usDst('2026-03-08'), true); // الأحد الثاني من مارس 2026
  assert.strictEqual(usDst('2026-10-31'), true);
  assert.strictEqual(usDst('2026-11-01'), false); // الأحد الأول من نوفمبر 2026
  assert.strictEqual(nyToUtc('2026-02-06', '08:30'), '2026-02-06 13:30:00');
  assert.strictEqual(nyToUtc('2026-07-29', '14:00'), '2026-07-29 18:00:00');
});

test('الصفقة تُحسب "وقت الأخبار" فقط إذا كانت مفتوحة لحظة الخبر', () => {
  const ev = [{ type: 'NFP', at: '2026-02-06 13:30:00' }];
  // إشارة 1h على شمعة 12:00 تُفتح 13:00 وتُغلق في شمعة 15:00
  assert.deepStrictEqual(exposedTo({ interval: '1h', time: '2026-02-06 12:00:00', closedAt: '2026-02-06 15:00:00' }, ev), ['NFP']);
  // إشارة على شمعة 13:00 تُفتح 14:00 بعد الخبر
  assert.deepStrictEqual(exposedTo({ interval: '1h', time: '2026-02-06 13:00:00', closedAt: '2026-02-06 16:00:00' }, ev), []);
  // صفقة أُغلقت قبل الخبر
  assert.deepStrictEqual(exposedTo({ interval: '1h', time: '2026-02-06 09:00:00', closedAt: '2026-02-06 11:00:00' }, ev), []);
});

test('قاعدة القرار مسجلة قبل التشغيل', () => {
  const mk = (n, r) => stats(Array.from({ length: n }, () => ({ r })));
  assert.strictEqual(decide(mk(20, -1), mk(100, 1)).warn, false, 'أقل من 30 صفقة');
  assert.strictEqual(decide(mk(40, -0.2), mk(200, 0.2)).warn, true);
  assert.strictEqual(decide(mk(40, 0.1), mk(200, 0.2)).warn, false);
});
