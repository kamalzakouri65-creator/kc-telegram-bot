const test = require('node:test');
const assert = require('node:assert');
const { fetchCandles } = require('../src/market');
const { parseChart, groupCandles, formatTime } = require('../src/yahoo');

// رد Yahoo لشموع ساعة تبدأ 2026-10-30 08:00 UTC، والشمعة 10:00 بلا تداول (null)
const base = Date.UTC(2026, 9, 30, 8) / 1000;
function chartResponse(hours) {
  const ts = Array.from({ length: hours }, (_, k) => base + k * 3600);
  const price = (k) => 30 + k * 0.1;
  const q = {
    open: ts.map((_, k) => price(k)),
    high: ts.map((_, k) => price(k) + 0.05),
    low: ts.map((_, k) => price(k) - 0.05),
    close: ts.map((_, k) => price(k) + 0.02),
  };
  for (const key of Object.keys(q)) q[key][2] = null;
  return { chart: { result: [{ timestamp: ts, indicators: { quote: [q] } }], error: null } };
}

test('تحويل رد Yahoo إلى شموع يتجاهل الفترات بلا تداول', () => {
  const candles = parseChart(chartResponse(5));
  assert.strictEqual(candles.length, 4);
  assert.strictEqual(formatTime(candles[2].seconds), '2026-10-30 11:00:00');
  assert.throws(() => parseChart({ chart: { result: null, error: { description: 'No data found' } } }), /No data found/);
});

test('تجميع شموع الساعة إلى 4 ساعات بتوقيت UTC', () => {
  const four = groupCandles(parseChart(chartResponse(9)), 4);
  // 08-11 (بدون 10:00) ثم 12-15 ثم 16:00
  assert.deepStrictEqual(four.map((c) => formatTime(c.seconds)), ['2026-10-30 08:00:00', '2026-10-30 12:00:00', '2026-10-30 16:00:00']);
  assert.strictEqual(four[0].open, 30);
  assert.ok(Math.abs(four[0].close - 30.32) < 1e-9);
  assert.ok(Math.abs(four[0].high - 30.35) < 1e-9);
  assert.strictEqual(four[0].low, 29.95);
});

test('الفضة تُجلب من Yahoo والشمعة المفتوحة تُحذف، والذهب يبقى على Twelve Data', async () => {
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    const body = String(url).includes('yahoo') ? chartResponse(9) : { values: [{ datetime: 'a', open: 1, high: 1, low: 1, close: 1 }, { datetime: 'b', open: 1, high: 1, low: 1, close: 1 }] };
    return { ok: true, json: async () => body };
  };
  const silver = await fetchCandles('XAG/USD', '4h', 'key');
  assert.match(urls[0], /query1\.finance\.yahoo\.com\/v8\/finance\/chart\/SI%3DF\?interval=60m/);
  assert.deepStrictEqual(silver.map((c) => c.time), ['2026-10-30 08:00:00', '2026-10-30 12:00:00']);

  const gold = await fetchCandles('XAU/USD', '1h', 'key');
  assert.match(urls[1], /api\.twelvedata\.com/);
  assert.strictEqual(gold.length, 1);

  await assert.rejects(fetchCandles('XAG/USD', '15min', 'key'), /غير مدعوم/);
});
