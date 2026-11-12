const test = require('node:test');
const assert = require('node:assert');
const { inSession, sessionOnly, SPREAD } = require('../src/scalp');

test('الجلسات بتوقيت نيويورك: لندن 03:00–06:00 ونيويورك 08:30–11:30', () => {
  const at = (h) => ({ time: `2026-03-02 ${h}:00` });
  assert.strictEqual(inSession(at('02:55')), false);
  assert.strictEqual(inSession(at('03:00')), true);
  assert.strictEqual(inSession(at('05:55')), true);
  assert.strictEqual(inSession(at('06:00')), false);
  assert.strictEqual(inSession(at('08:30')), true);
  assert.strictEqual(inSession(at('11:30')), false);
  assert.strictEqual(SPREAD, 0.57);
});

test('الإشارة خارج الجلسة تُتجاهل', () => {
  const fn = sessionOnly(() => ({ side: 'BUY' }));
  assert.strictEqual(fn([{ time: '2026-03-02 14:00:00' }]), null);
  assert.deepStrictEqual(fn([{ time: '2026-03-02 09:00:00' }]), { side: 'BUY' });
});
