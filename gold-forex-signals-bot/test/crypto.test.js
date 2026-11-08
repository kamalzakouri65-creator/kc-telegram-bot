const test = require('node:test');
const assert = require('node:assert');
const { fetchBinanceCandles, isCrypto } = require('../src/binance');
const { fetchCandles } = require('../src/market');
const { cryptoMarkets, marketSignals, DEFAULT_CRYPTO } = require('../src/crypto');
const { formatSignal } = require('../src/format');

const DAY = 86400000;
const kline = (t, p) => [t, String(p), String(p + 1), String(p - 1), String(p + 0.5), '0', t + DAY - 1];

test('Binance: GET عام لـ BTCUSDT يومي، والشمعة المفتوحة تُحذف', async () => {
  const urls = [];
  const now = Date.UTC(2026, 10, 8, 12);
  global.fetch = async (url, opts) => {
    urls.push(new URL(url));
    assert.strictEqual(opts.method, 'GET');
    return { ok: true, json: async () => [kline(Date.UTC(2026, 10, 6), 100), kline(Date.UTC(2026, 10, 7), 101), kline(Date.UTC(2026, 10, 8), 102)] };
  };
  const cs = await fetchBinanceCandles('BTC/USDT', '1day', 300, now);
  assert.strictEqual(urls[0].origin + urls[0].pathname, 'https://data-api.binance.vision/api/v3/klines');
  assert.deepStrictEqual([urls[0].searchParams.get('symbol'), urls[0].searchParams.get('interval')], ['BTCUSDT', '1d']);
  assert.strictEqual(urls[0].searchParams.get('apikey'), null);
  assert.deepStrictEqual(cs.map((c) => c.time), ['2026-11-06 00:00:00', '2026-11-07 00:00:00']);
  assert.strictEqual(cs[1].close, 101.5);
});

test('التوجيه: العملات الرقمية إلى Binance فقط، والذهب لا يتغير', async () => {
  assert.strictEqual(isCrypto('ETH/USDT'), true);
  assert.strictEqual(isCrypto('XAU/USD'), false);
  const hosts = [];
  global.fetch = async (url) => {
    hosts.push(new URL(url).host);
    return { ok: true, json: async () => (String(url).includes('binance') ? [] : { values: [] }) };
  };
  await fetchCandles('SOL/USDT', '1day', 'key');
  await fetchCandles('XAU/USD', '1h', 'key');
  assert.deepStrictEqual(hosts, ['data-api.binance.vision', 'api.twelvedata.com']);
});

test('الأسواق الافتراضية، والإيقاف بقيمة فارغة', () => {
  assert.deepStrictEqual(cryptoMarkets().map((m) => m.symbol), DEFAULT_CRYPTO.split(','));
  assert.ok(cryptoMarkets().every((m) => m.interval === '1day' && m.longOnly && m.strategies.join() === 'ema-macd'));
  assert.strictEqual(cryptoMarkets('').length, 0);
});

test('شراء فقط: إشارة البيع تُتجاهل في العملات الرقمية، ولا تُتجاهل في الذهب', () => {
  const { STRATEGIES } = require('../src/strategies');
  const original = STRATEGIES['ema-macd'].analyze;
  STRATEGIES['ema-macd'].analyze = () => ({ side: 'SELL' });
  try {
    assert.strictEqual(marketSignals(cryptoMarkets('BTC/USDT')[0], []).length, 0);
    assert.strictEqual(marketSignals({ symbol: 'XAU/USD', interval: '1h', strategies: ['ema-macd'], longOnly: false }, []).length, 1);
    STRATEGIES['ema-macd'].analyze = () => ({ side: 'BUY' });
    assert.strictEqual(marketSignals(cryptoMarkets('BTC/USDT')[0], []).length, 1);
    assert.strictEqual(marketSignals(cryptoMarkets('BTC/USDT')[0], [], () => false).length, 0, 'الإيقاف يعمل أيضاً');
  } finally {
    STRATEGIES['ema-macd'].analyze = original;
  }
});

test('رسالة إشارة العملة الرقمية: يومي، Binance، بدون سطر حجم XM', () => {
  const text = formatSignal('BTC/USDT', '1day', { side: 'BUY', entry: 98765.4321, stopLoss: 95000, takeProfit1: 104413, takeProfit2: 110061, rsi: 58, atr: 2500, time: '2026-11-07 00:00:00' }, 'ema-macd', { maxLossUsd: 3 });
  assert.match(text, /BTC\/USDT — 1day — EMA \+ MACD/);
  assert.match(text, /الدخول: 98765\.43/);
  assert.match(text, /الإطار: يوم واحد \(D1\)/);
  assert.match(text, /Binance Spot — شراء فقط، بدون رافعة/);
  assert.doesNotMatch(text, /لوت|تخطَّها/);
});
