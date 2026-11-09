const test = require('node:test');
const assert = require('node:assert');
const { dropWeekendCandles, closedForWeekend, usDst } = require('../src/market-hours');
const { fetchCandles } = require('../src/market');

const H = 3600 * 1000;
const at = (s) => Date.parse(s + 'Z');

test('إغلاق العطلة: الجمعة 22:00 UTC → الأحد 23:00 UTC في الشتاء، وساعة أبكر في الصيف', () => {
  assert.strictEqual(usDst(at('2026-11-08T12:00:00')), false);
  assert.strictEqual(usDst(at('2026-07-05T12:00:00')), true);
  // شتاء: الجمعة 6 نوفمبر و الأحد 8 نوفمبر 2026
  assert.strictEqual(closedForWeekend(at('2026-11-06T21:00:00'), H), false, 'آخر ساعة قبل الإغلاق');
  assert.strictEqual(closedForWeekend(at('2026-11-06T22:00:00'), H), true);
  assert.strictEqual(closedForWeekend(at('2026-11-08T22:00:00'), H), true, 'الأحد 22:00 ما زال مغلقاً');
  assert.strictEqual(closedForWeekend(at('2026-11-08T23:00:00'), H), false, 'الفتح 23:00');
  // شمعة 4h تحتوي ساعة الفتح تبقى
  assert.strictEqual(closedForWeekend(at('2026-11-08T20:00:00'), 4 * H), false);
  // صيف: الفتح 22:00 UTC
  assert.strictEqual(closedForWeekend(at('2026-07-05T21:00:00'), H), true);
  assert.strictEqual(closedForWeekend(at('2026-07-05T22:00:00'), H), false);
});

test('Twelve Data: الطلب بتوقيت UTC، وشموع العطلة المجمّدة تُحذف', async () => {
  const urls = [];
  const times = ['2026-11-06 20:00:00', '2026-11-06 21:00:00', '2026-11-07 12:00:00', '2026-11-08 14:00:00', '2026-11-08 22:00:00', '2026-11-08 23:00:00', '2026-11-09 00:00:00', '2026-11-09 01:00:00'];
  global.fetch = async (url) => {
    urls.push(new URL(url));
    return { ok: true, json: async () => ({ values: times.map((t) => ({ datetime: t, open: '1', high: '1', low: '1', close: '1' })) }) };
  };
  const cs = await fetchCandles('XAU/USD', '1h', 'key');
  assert.strictEqual(urls[0].searchParams.get('timezone'), 'UTC');
  assert.deepStrictEqual(cs.map((c) => c.time), ['2026-11-06 20:00:00', '2026-11-06 21:00:00', '2026-11-08 23:00:00', '2026-11-09 00:00:00'], 'آخر شمعة (المفتوحة) محذوفة أيضاً');
});

test('الشموع العادية لا تتأثر، والإطار غير المعروف يمر كما هو', () => {
  const cs = [{ time: '2026-11-10 10:00:00' }, { time: '2026-11-10 11:00:00' }];
  assert.deepStrictEqual(dropWeekendCandles(cs, '1h'), cs);
  assert.deepStrictEqual(dropWeekendCandles([{ time: '2026-11-07 12:00:00' }], '1day').length, 1);
});
