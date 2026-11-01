// إثبات صريح أنه لا يوجد أي كود تنفيذ صفقات أو سحب أو استعمال لمفاتيح Binance
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const listJs = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? listJs(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []));
const sources = listJs(path.join(ROOT, 'src')).map((file) => ({ file: path.relative(ROOT, file), text: fs.readFileSync(file, 'utf8') }));

test('لا توجد في الكود أي واجهة تداول أو سحب أو توقيع لطلبات Binance', () => {
  const forbidden = [
    /\/api\/v3\/order/i, // وضع/إلغاء/تعديل الطلبات
    /\/api\/v3\/openOrders/i,
    /\/api\/v3\/account/i,
    /\/api\/v3\/myTrades/i,
    /\/sapi\//i, // السحب والمحفظة
    /\/fapi\//i, // العقود الآجلة
    /\/dapi\//i,
    /withdraw/i,
    /X-MBX-APIKEY/i, // مفتاح API
    /createHmac|signature=/i, // توقيع الطلبات الخاصة
    /api[_-]?secret|secret[_-]?key/i,
    /BINANCE_API/i,
    /newOrder|placeOrder|cancelOrder|marketBuy|limitBuy/i,
  ];
  for (const { file, text } of sources) {
    for (const pattern of forbidden) assert.ok(!pattern.test(text), `${file} يحتوي ${pattern}`);
  }
});

test('الاتصال بـ Binance في ملف واحد فقط، وبطلبات GET لبيانات السوق العامة فقط', async () => {
  const binanceFiles = sources.filter(({ text }) => /binance\.(com|vision)/i.test(text)).map((s) => s.file);
  assert.deepStrictEqual(binanceFiles.sort(), ['src/config.js'], 'عنوان Binance معرّف في الإعدادات فقط');
  const callers = sources.filter(({ text }) => /config\.binance/.test(text)).map((s) => s.file);
  assert.deepStrictEqual(callers.sort(), ['src/data/binance.js']);

  const { publicGet, fetchRecent, fetchHistory, ALLOWED_PATHS } = require('../src/data/binance');
  assert.deepStrictEqual(ALLOWED_PATHS, ['/api/v3/klines']);
  await assert.rejects(publicGet('/api/v3/order', {}), /غير مسموح/);

  const requests = [];
  global.fetch = async (url, opts) => {
    requests.push({ url: String(url), opts });
    return { ok: true, json: async () => [] };
  };
  await fetchRecent('BTCUSDT', '5m', 10);
  await fetchHistory('ETHUSDT', '1h', Date.now() - 3600000);
  assert.ok(requests.length >= 2);
  for (const { url, opts } of requests) {
    const u = new URL(url);
    assert.strictEqual(u.origin, 'https://data-api.binance.vision');
    assert.strictEqual(u.pathname, '/api/v3/klines');
    assert.strictEqual(opts.method, 'GET');
    assert.ok(!opts.headers && !opts.body, 'بدون رؤوس ولا مفاتيح ولا جسم');
  }
});

test('لا توجد اعتماديات خارجية، والإعدادات لا تطلب أي مفتاح Binance', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(pkg.dependencies ?? {}), []);
  assert.deepStrictEqual(Object.keys(pkg.devDependencies ?? {}), []);
  const env = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const keys = env.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split('=')[0]);
  assert.deepStrictEqual(keys.sort(), ['LIVE_MONITORING_APPROVED', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'WEBHOOK_SECRET']);
});

test('لا توجد دالة تنفيذ في أي وحدة', () => {
  for (const { file } of sources) {
    if (file.endsWith('main.js')) continue; // نقطة الدخول تشغّل الأوامر عند تحميلها
    const mod = require(path.join(ROOT, file));
    for (const name of Object.keys(mod)) assert.ok(!/order(?!block)|execut|withdraw|^(buy|sell)|(place|open|submit|send)Trade/i.test(name), `${file} يصدّر ${name}`);
  }
});

test('المراقبة الحية ترفض العمل بدون موافقة صريحة', () => {
  const { spawnSync } = require('child_process');
  const run = (args, env) => spawnSync(process.execPath, [path.join(ROOT, 'src', 'main.js'), 'monitor', ...args], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  for (const [args, env] of [
    [[], {}],
    [['--i-approve-live-monitoring'], {}],
    [[], { LIVE_MONITORING_APPROVED: 'yes' }],
  ]) {
    const r = run(args, env);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /المراقبة الحية متوقفة/);
  }
});
