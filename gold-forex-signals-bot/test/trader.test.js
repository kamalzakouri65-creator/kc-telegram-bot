const test = require('node:test');
const assert = require('node:assert');
const { toMtSymbol, quoteToAccountRate, lotSize, orderLevels, splitVolume } = require('../src/risk');
const { createTrader } = require('../src/trader');

test('تحويل اسم الرمز إلى صيغة MT5', () => {
  assert.strictEqual(toMtSymbol('XAU/USD'), 'XAUUSD');
  assert.strictEqual(toMtSymbol('EUR/USD', 'm'), 'EURUSDm');
});

test('تحويل عملة التسعير إلى عملة الحساب', () => {
  assert.strictEqual(quoteToAccountRate('EUR/USD', 1.1, 'USD'), 1);
  assert.strictEqual(quoteToAccountRate('USD/JPY', 150, 'USD'), 1 / 150);
  assert.throws(() => quoteToAccountRate('EUR/GBP', 0.85, 'USD'));
});

const gold = { contractSize: 100, minVolume: 0.01, maxVolume: 50, volumeStep: 0.01 };

test('حجم اللوت يحقق نسبة المخاطرة', () => {
  // 1% من 10000 = 100$، ووقف 10$ في الذهب = 1000$ للوت، إذن 0.1 لوت
  assert.strictEqual(lotSize({ ...gold, balance: 10000, riskPercent: 1, slDistance: 10, rate: 1 }), 0.1);
  // يُقرّب للأسفل ولا يتجاوز المخاطرة
  assert.strictEqual(lotSize({ ...gold, balance: 10000, riskPercent: 1, slDistance: 7, rate: 1 }), 0.14);
});

test('لا صفقة إذا كان أقل حجم يتجاوز المخاطرة، والحجم لا يتجاوز الحد الأقصى', () => {
  assert.strictEqual(lotSize({ ...gold, balance: 50, riskPercent: 1, slDistance: 10, rate: 1 }), 0);
  assert.strictEqual(lotSize({ ...gold, balance: 1e9, riskPercent: 1, slDistance: 1, rate: 1 }), 50);
});

test('مستويات الأمر تُقاس من سعر التنفيذ', () => {
  const signal = { side: 'SELL', entry: 2000, stopLoss: 2010, takeProfit1: 1985, takeProfit2: 1970 };
  assert.deepStrictEqual(orderLevels(signal, 1999.5, 2), {
    slDistance: 10,
    stopLoss: 2009.5,
    takeProfit1: 1984.5,
    takeProfit2: 1969.5,
  });
});

test('تقسيم الحجم على هدفين', () => {
  assert.deepStrictEqual(splitVolume(0.1, 0.01, 0.01), [0.05, 0.05]);
  assert.deepStrictEqual(splitVolume(0.03, 0.01, 0.01), [0.01, 0.02]);
  assert.deepStrictEqual(splitVolume(0.01, 0.01, 0.01), [0.01]);
});

// واجهة MetaApi وهمية لاختبار المنفّذ دون شبكة
function mockMetaApi({ type = 'ACCOUNT_TRADE_MODE_DEMO', positions = [] } = {}) {
  const trades = [];
  global.fetch = async (url, opts = {}) => {
    const path = new URL(url).pathname.split('/accounts/acc')[1];
    let body;
    if (path === '/account-information') body = { type, balance: 10000, currency: 'USD', equity: 10000 };
    else if (path === '/positions') body = positions;
    else if (path.endsWith('/specification')) body = { ...gold, digits: 2 };
    else if (path.endsWith('/current-price')) body = { bid: 2000, ask: 2000.5 };
    else if (path === '/trade') {
      trades.push(JSON.parse(opts.body));
      body = { numericCode: 10009, stringCode: 'TRADE_RETCODE_DONE', positionId: String(trades.length) };
    }
    return { ok: true, text: async () => JSON.stringify(body) };
  };
  return trades;
}

const buy = { side: 'BUY', entry: 2000, stopLoss: 1990, takeProfit1: 2015, takeProfit2: 2030 };
const newTrader = (opts = {}) => createTrader({ token: 't', accountId: 'acc', ...opts });

test('ينفّذ صفقتي شراء بنصف الحجم لكل هدف', async () => {
  const trades = mockMetaApi();
  const report = await newTrader().execute('XAU/USD', buy);
  assert.match(report, /✅/);
  assert.deepStrictEqual(
    trades.map((t) => [t.actionType, t.symbol, t.volume, t.stopLoss, t.takeProfit]),
    [
      ['ORDER_TYPE_BUY', 'XAUUSD', 0.05, 1990.5, 2015.5],
      ['ORDER_TYPE_BUY', 'XAUUSD', 0.05, 1990.5, 2030.5],
    ]
  );
});

test('يرفض التداول على حساب حقيقي افتراضياً', async () => {
  const trades = mockMetaApi({ type: 'ACCOUNT_TRADE_MODE_REAL' });
  await assert.rejects(newTrader().execute('XAU/USD', buy), /حقيقي/);
  assert.strictEqual(trades.length, 0);
});

test('لا يفتح صفقة ثانية على نفس الرمز ويحترم الحد الأقصى', async () => {
  let trades = mockMetaApi({ positions: [{ symbol: 'XAUUSD' }] });
  assert.match(await newTrader().execute('XAU/USD', buy), /توجد صفقة مفتوحة/);
  trades = mockMetaApi({ positions: [{ symbol: 'EURUSD' }, { symbol: 'GBPUSD' }] });
  assert.match(await newTrader({ maxOpenPositions: 2 }).execute('XAU/USD', buy), /للحد الأقصى/);
  assert.strictEqual(trades.length, 0);
});
