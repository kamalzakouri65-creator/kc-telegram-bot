const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { marketClosed, usDst, toMs } = require('../src/hours');
const { checkQuality, fetchHistory } = require('../src/data');
const { config } = require('../src/config');

test('ساعات السوق: العطلة والاستراحة اليومية بتوقيت نيويورك', () => {
  assert.strictEqual(usDst(toMs('2026-07-01 12:00:00')), true);
  assert.strictEqual(usDst(toMs('2026-12-01 12:00:00')), false);
  assert.strictEqual(marketClosed(toMs('2026-11-13 21:59:00')), false, 'الجمعة 16:59 نيويورك');
  assert.strictEqual(marketClosed(toMs('2026-11-13 22:00:00')), true, 'الجمعة 17:00 نيويورك');
  assert.strictEqual(marketClosed(toMs('2026-11-15 22:59:00')), true, 'الأحد 17:59 نيويورك');
  assert.strictEqual(marketClosed(toMs('2026-11-15 23:00:00')), false, 'الأحد 18:00 نيويورك');
  assert.strictEqual(marketClosed(toMs('2026-11-17 22:30:00')), true, 'الاستراحة اليومية');
  assert.strictEqual(marketClosed(toMs('2026-11-17 14:30:00')), false);
});

test('فحص الجودة: مكرر، وفجوة في وقت التداول، وشمعة في العطلة، وقفزة', () => {
  const c = (time, p = 4000) => ({ time, open: p, high: p + 1, low: p - 1, close: p });
  const cs = [c('2026-11-17 14:00:00'), c('2026-11-17 14:00:00'), c('2026-11-17 14:01:00'), c('2026-11-17 14:05:00', 4040), c('2026-11-14 12:00:00')];
  const q = checkQuality(cs);
  assert.strictEqual(q.duplicates, 1);
  assert.strictEqual(q.missingInOpenHours, 3);
  assert.strictEqual(q.inClosedHours, 1);
  assert.strictEqual(q.jumps.length, 1);
});

test('التحميل: GET بتوقيت UTC، والحفظ بعد كل صفحة، والمفتاح لا يظهر في الأخطاء', async () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kgs-'));
  config.paths.data = tmp;
  process.env.TWELVE_DATA_API_KEY = 'secret-key';
  const urls = [];
  global.fetch = async (url, opts) => {
    urls.push(new URL(url));
    assert.strictEqual(opts.method, 'GET');
    return { ok: true, json: async () => ({ values: [{ datetime: '2026-11-13 10:00:00', open: '1', high: '1', low: '1', close: '1' }] }) };
  };
  const { candles } = await fetchHistory({ pauseMs: 0, now: new Date('2026-11-15T00:00:00Z') });
  assert.strictEqual(candles.length, 1);
  assert.strictEqual(urls[0].searchParams.get('timezone'), 'UTC');
  assert.strictEqual(urls[0].searchParams.get('interval'), '1min');
  assert.ok(fs.existsSync(path.join(tmp, 'xau-m1.json')));
  global.fetch = async () => ({ ok: true, json: async () => ({ status: 'error', message: 'limit' }) });
  fs.rmSync(path.join(tmp, 'xau-m1.json'));
  await assert.rejects(fetchHistory({ pauseMs: 0 }), (e) => !e.message.includes('secret-key'));
});

test('لا يوجد أي كود تداول أو اتصال بحساب', () => {
  const dir = path.join(__dirname, '..', 'src');
  for (const f of fs.readdirSync(dir)) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const p of [/order_send|placeOrder|createOrder|OrderSend/i, /metaapi/i, /withdraw/i, /require\([^)]*gold-forex-signals-bot/]) assert.ok(!p.test(t), `${f}: ${p}`);
  }
});
