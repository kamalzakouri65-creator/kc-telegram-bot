const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createOutbox } = require('../src/outbox');

const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-')), 'outbox.json');
const gatewayError = () => Object.assign(new Error('ETELEGRAM: 504 Gateway Timeout'), { response: { statusCode: 504 } });

function fakeTelegram() {
  const delivered = [];
  let down = false;
  return {
    delivered,
    setDown: (v) => (down = v),
    send: async (chatId, text) => {
      if (down) throw gatewayError();
      delivered.push(text);
    },
  };
}

test('الرسالة تصل فوراً إذا كان الاتصال سليماً', async () => {
  const tg = fakeTelegram();
  const outbox = createOutbox(tempFile(), tg.send);
  await outbox.send(1, 'إشارة');
  assert.deepStrictEqual(tg.delivered, ['إشارة']);
  assert.strictEqual(outbox.pending(), 0);
});

test('عند تعطل تيليغرام تُحفظ الرسائل وتصل بنفس الترتيب عند عودة الاتصال، مع تنبيه التأخير', async () => {
  const tg = fakeTelegram();
  let clock = 0;
  const outbox = createOutbox(tempFile(), tg.send, { now: () => clock });
  tg.setDown(true);
  await outbox.send(1, 'إشارة بيع');
  await outbox.send(1, 'الهدف 1');
  assert.strictEqual(outbox.pending(), 2);

  clock = 20 * 60 * 1000;
  tg.setDown(false);
  await outbox.flush();
  assert.strictEqual(outbox.pending(), 0);
  assert.strictEqual(tg.delivered.length, 2);
  assert.match(tg.delivered[0], /متأخرة 20 دقيقة[\s\S]*إشارة بيع$/);
  assert.match(tg.delivered[1], /الهدف 1$/);
});

test('الرسائل المحفوظة لا تضيع بعد إعادة تشغيل البوت', async () => {
  const file = tempFile();
  const tg = fakeTelegram();
  tg.setDown(true);
  await createOutbox(file, tg.send).send(1, 'إشارة');
  tg.setDown(false);
  const restarted = createOutbox(file, tg.send);
  assert.strictEqual(restarted.pending(), 1);
  await restarted.flush();
  assert.deepStrictEqual(tg.delivered, ['إشارة']);
});

test('خطأ دائم (مثل 400) لا يوقف بقية الرسائل', async () => {
  const delivered = [];
  const send = async (chatId, text) => {
    if (text === 'سيئة') throw Object.assign(new Error('400 Bad Request'), { response: { statusCode: 400 } });
    delivered.push(text);
  };
  const outbox = createOutbox(tempFile(), send);
  await outbox.send(1, 'سيئة');
  await outbox.send(1, 'جيدة');
  assert.deepStrictEqual(delivered, ['جيدة']);
  assert.strictEqual(outbox.pending(), 0);
});
