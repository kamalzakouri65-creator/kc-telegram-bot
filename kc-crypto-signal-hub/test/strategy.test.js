const test = require('node:test');
const assert = require('node:assert');
const { buildScenario, M5 } = require('./helpers/scenario');
const { runBacktest } = require('../src/backtest/engine');
const { ema, atr, sma } = require('../src/strategy/indicators');
const { closedOnly } = require('../src/data/candles');
const { fetchRecent } = require('../src/data/binance');

const types = (r) => r.events.filter((e) => e.type !== 'dayEnd').map((e) => e.type);
const flip = (cs) => cs.map((c) => ({ ...c, open: 400 - c.open, close: 400 - c.close, high: 400 - c.low, low: 400 - c.high }));

test('السيناريو الكامل: إعداد ثم إشارة شراء ثم دخول ثم الهدف', () => {
  const sc = buildScenario();
  const r = runBacktest({ BTCUSDT: sc.data });
  assert.deepStrictEqual(types(r), ['setup', 'signal', 'filled', 'closed']);
  const sig = r.events.find((e) => e.type === 'signal').signal;
  assert.strictEqual(sig.pattern, 'engulfing');
  assert.strictEqual(sig.structure, 'CHoCH');
  assert.ok(sig.stopLoss < sc.B - 1.4, 'الوقف تحت قاع سحب السيولة');
  assert.ok(Math.abs(sig.netRewardRisk - 2) < 1e-9, 'العائد الصافي = 2 × المخاطرة الصافية');
  assert.strictEqual(r.trades[0].outcome, 'target');
});

test('بدون حجم كافٍ على شمعة التأكيد لا توجد إشارة، وينتهي الإعداد مرة واحدة', () => {
  const r = runBacktest({ BTCUSDT: buildScenario({ volumeSpike: 100 }).data });
  assert.deepStrictEqual(types(r), ['setup', 'setupExpired']);
});

test('Spot فقط: في اتجاه هابط لا توجد أي إشارة (لا بيع على المكشوف)', () => {
  const { data } = buildScenario();
  const r = runBacktest({ BTCUSDT: { h1: flip(data.h1), m15: flip(data.m15), m5: flip(data.m5) } });
  assert.deepStrictEqual(types(r), []);
});

test('لا إعادة رسم ولا نظر للمستقبل: قطع البيانات عند أي وقت يعطي نفس الأحداث حتى ذلك الوقت', () => {
  const sc = buildScenario();
  const full = runBacktest({ BTCUSDT: sc.data }).events;
  const signalTime = full.find((e) => e.type === 'signal').time;
  const key = (e) => JSON.stringify(e);
  // نقاط قطع حول الإعداد والإشارة والدخول والخروج
  for (let T = signalTime - 30 * M5; T <= signalTime + 20 * M5; T += M5) {
    const cut = (cs) => cs.filter((c) => c.closeTime <= T);
    const partial = runBacktest({ BTCUSDT: { h1: cut(sc.data.h1), m15: cut(sc.data.m15), m5: cut(sc.data.m5) } }).events;
    assert.deepStrictEqual(partial.map(key), full.filter((e) => e.time <= T).map(key), `اختلاف عند القطع ${new Date(T).toISOString()}`);
  }
});

test('تغيير الأسعار المستقبلية لا يغيّر الإشارة', () => {
  const sc = buildScenario();
  const crash = buildScenario({ afterBars: [[sc.B + 0.9, sc.B + 1, sc.B - 20, sc.B - 19], [sc.B - 19, sc.B - 18, sc.B - 30, sc.B - 29]] });
  const sigA = runBacktest({ BTCUSDT: sc.data }).events.find((e) => e.type === 'signal');
  const sigB = runBacktest({ BTCUSDT: crash.data }).events.find((e) => e.type === 'signal');
  assert.deepStrictEqual(sigA, sigB);
});

test('المؤشرات سببية: قيمتها لا تتغير بإضافة شموع بعدها', () => {
  const values = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.1);
  const candles = values.map((v) => ({ open: v, close: v + 0.5, high: v + 1, low: v - 1 }));
  for (const n of [210, 250, 299]) {
    assert.deepStrictEqual(ema(values.slice(0, n), 200), ema(values, 200).slice(0, n));
    assert.deepStrictEqual(sma(values.slice(0, n), 20), sma(values, 20).slice(0, n));
    assert.deepStrictEqual(atr(candles.slice(0, n), 14), atr(candles, 14).slice(0, n));
  }
});

test('الشموع المفتوحة لا تُستعمل أبداً', async () => {
  const now = Date.UTC(2026, 0, 1, 12, 7);
  const kline = (open) => [open, '1', '2', '0.5', '1.5', '10', open + 5 * 60 * 1000 - 1];
  const closedA = kline(Date.UTC(2026, 0, 1, 11, 55));
  const closedB = kline(Date.UTC(2026, 0, 1, 12, 0));
  const open = kline(Date.UTC(2026, 0, 1, 12, 5)); // تُغلق 12:09:59
  global.fetch = async () => ({ ok: true, json: async () => [closedA, closedB, open] });
  const candles = await fetchRecent('BTCUSDT', '5m', 10, now);
  assert.deepStrictEqual(candles.map((c) => c.openTime), [closedA[0], closedB[0]]);
  assert.strictEqual(closedOnly([{ closeTime: now }], now).length, 0, 'شمعة تُغلق في نفس اللحظة لم تكتمل بعد');
});
