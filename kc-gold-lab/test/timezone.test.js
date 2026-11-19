const test = require('node:test');
const assert = require('node:assert');
const { london } = require('../src/timezone');

test('توقيت لندن: شتاء UTC+0، وصيف UTC+1، والانتقال في آخر أحد من مارس وأكتوبر', () => {
  assert.deepStrictEqual(london(Date.parse('2024-01-15T07:30:00Z')), { day: '2024-01-15', hour: 7, minute: 30 });
  assert.deepStrictEqual(london(Date.parse('2024-07-15T07:30:00Z')), { day: '2024-07-15', hour: 8, minute: 30 });
  assert.strictEqual(london(Date.parse('2024-03-31T00:59:00Z')).hour, 0, 'قبل الانتقال');
  assert.strictEqual(london(Date.parse('2024-03-31T01:00:00Z')).hour, 2, 'بعد الانتقال');
  assert.strictEqual(london(Date.parse('2024-10-27T00:59:00Z')).hour, 1);
  assert.strictEqual(london(Date.parse('2024-10-27T01:00:00Z')).hour, 1);
  assert.strictEqual(london(Date.parse('2024-07-15T23:30:00Z')).day, '2024-07-16', 'منتصف الليل في لندن صيفاً = 23:00 UTC');
});
