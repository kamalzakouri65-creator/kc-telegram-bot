const test = require('node:test');
const assert = require('node:assert');
const { parseDisabled, isEnabled, describe, DEFAULT_DISABLED } = require('../src/setups');

test('الافتراضي يوقف الفضة 1h Pullback فقط', () => {
  const { set, invalid } = parseDisabled(DEFAULT_DISABLED);
  assert.deepStrictEqual(invalid, []);
  assert.strictEqual(isEnabled(set, 'XAG/USD', '1h', 'pullback'), false);
  for (const [s, i, k] of [['XAG/USD', '1h', 'ema-macd'], ['XAG/USD', '4h', 'pullback'], ['XAU/USD', '1h', 'pullback'], ['XAU/USD', '4h', 'ema-macd']])
    assert.strictEqual(isEnabled(set, s, i, k), true, `${s} ${i} ${k}`);
  assert.deepStrictEqual(describe(set), ['XAG/USD 1h Pullback']);
});

test('فارغ = لا شيء موقوف، وأكثر من إعداد مفصولة بفواصل', () => {
  assert.strictEqual(parseDisabled('').set.size, 0);
  const { set } = parseDisabled(' XAG/USD:1h:pullback , XAU/USD:4h:ema-macd ');
  assert.strictEqual(set.size, 2);
  assert.strictEqual(isEnabled(set, 'XAU/USD', '4h', 'ema-macd'), false);
});

test('صيغة خاطئة أو استراتيجية غير معروفة تُرفض', () => {
  assert.deepStrictEqual(parseDisabled('XAG/USD:1h:pulback,XAU/USD').invalid, ['XAG/USD:1h:pulback', 'XAU/USD']);
});
