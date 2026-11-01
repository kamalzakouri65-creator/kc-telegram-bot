// نختبر معالج الطلبات مباشرة بطلبات وهمية، دون تشغيل أي خادم
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { createWebhookHandler, MAX_BYTES } = require('../src/server/webhook');
const { validateAlert } = require('../src/server/validator');

const SECRET = 'a-long-random-shared-secret-123';
const pairs = ['BTCUSDT', 'ETHUSDT'];

function call(handler, { method = 'POST', url = '/webhook', body }) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    Object.assign(req, { method, url, destroy() {} });
    const res = {
      writeHead(status) {
        this.status = status;
      },
      end(text) {
        resolve({ status: this.status, body: JSON.parse(text) });
      },
    };
    handler(req, res);
    if (body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    req.emit('end');
  });
}

test('سر صحيح: يقبل التنبيه ويطلب فحص الزوج فقط', async () => {
  const alerts = [];
  const h = createWebhookHandler({ secret: SECRET, allowedPairs: pairs, onAlert: (p) => alerts.push(p) });
  const res = await call(h, { body: { secret: SECRET, pair: 'BTC/USDT' } });
  assert.strictEqual(res.status, 202);
  assert.deepStrictEqual(alerts, ['BTCUSDT']);
});

test('سر خاطئ أو مفقود: 401 ولا شيء يحدث', async () => {
  const alerts = [];
  const h = createWebhookHandler({ secret: SECRET, allowedPairs: pairs, onAlert: (p) => alerts.push(p) });
  assert.strictEqual((await call(h, { body: { secret: 'wrong', pair: 'BTCUSDT' } })).status, 401);
  assert.strictEqual((await call(h, { body: { pair: 'BTCUSDT' } })).status, 401);
  assert.deepStrictEqual(alerts, []);
});

test('طلبات غير صالحة: مسار أو طريقة خاطئة، JSON تالف، زوج غير مدعوم، حجم كبير', async () => {
  const h = createWebhookHandler({ secret: SECRET, allowedPairs: pairs, onAlert: () => assert.fail('لا يجب أن يُستدعى') });
  assert.strictEqual((await call(h, { method: 'GET' })).status, 404);
  assert.strictEqual((await call(h, { url: '/other', body: {} })).status, 404);
  assert.strictEqual((await call(h, { body: '{not json' })).status, 400);
  assert.strictEqual((await call(h, { body: { secret: SECRET, pair: 'DOGEUSDT' } })).status, 400);
  assert.strictEqual((await call(h, { body: 'x'.repeat(MAX_BYTES + 1) })).status, 413);
});

test('بدون سر قوي في الإعدادات يرفض كل شيء (503)', () => {
  assert.strictEqual(validateAlert({ secret: '', pair: 'BTCUSDT' }, { secret: '', allowedPairs: pairs }).status, 503);
  assert.strictEqual(validateAlert({ secret: 'short', pair: 'BTCUSDT' }, { secret: 'short', allowedPairs: pairs }).status, 503);
});

test('التنبيه لا يحمل أي أمر: الحقول الإضافية (مثل order أو qty) تُتجاهل', async () => {
  const alerts = [];
  const h = createWebhookHandler({ secret: SECRET, allowedPairs: pairs, onAlert: (...args) => alerts.push(args) });
  await call(h, { body: { secret: SECRET, pair: 'ETHUSDT', side: 'BUY', qty: 1, order: 'market' } });
  assert.deepStrictEqual(alerts, [['ETHUSDT']]);
});
