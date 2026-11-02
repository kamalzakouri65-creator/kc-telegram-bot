// جودة البيانات، وإثبات عدم وجود أي كود تداول
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { checkQuality, publicGet, fetchHistory, ALLOWED_PATHS } = require('../src/data');

const ROOT = path.join(__dirname, '..');
const sources = fs.readdirSync(path.join(ROOT, 'src')).map((f) => ({ f, text: fs.readFileSync(path.join(ROOT, 'src', f), 'utf8') }));

test('فحص الجودة يكتشف الشموع المفقودة والمكررة دون تعديلها', () => {
  const H = 3600000;
  const cs = [0, 1, 1, 2, 5, 6].map((k) => ({ openTime: k * H }));
  const q = checkQuality(cs, H);
  assert.strictEqual(q.duplicates, 1);
  assert.strictEqual(q.gaps.length, 1);
  assert.strictEqual(q.missingTotal, 2);
  assert.strictEqual(cs.length, 6, 'البيانات لم تُعدّل');
});

test('لا يوجد في الكود أي واجهة تداول أو حساب أو سحب أو توقيع', () => {
  const forbidden = [/\/api\/v3\/order/i, /\/api\/v3\/account/i, /\/sapi\//i, /\/fapi\//i, /withdraw/i, /X-MBX-APIKEY/i, /createHmac|signature=/i, /api[_-]?secret/i];
  for (const { f, text } of sources) for (const p of forbidden) assert.ok(!p.test(text), `${f}: ${p}`);
});

test('كل طلبات Binance هي GET لشموع السوق العامة فقط', async () => {
  assert.deepStrictEqual(ALLOWED_PATHS, ['/api/v3/klines']);
  await assert.rejects(publicGet('/api/v3/order', {}), /غير مسموح/);
  const seen = [];
  global.fetch = async (url, opts) => {
    seen.push({ url: new URL(url), opts });
    return { ok: true, json: async () => [] };
  };
  await fetchHistory('BTCUSDT', '1h', Date.now() - 7200000, Date.now());
  assert.ok(seen.length >= 1);
  for (const { url, opts } of seen) {
    assert.strictEqual(url.origin, 'https://data-api.binance.vision');
    assert.strictEqual(url.pathname, '/api/v3/klines');
    assert.strictEqual(opts.method, 'GET');
    assert.ok(!opts.headers && !opts.body);
  }
});

test('لا اعتماديات خارجية', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(pkg.dependencies ?? {}), []);
});
