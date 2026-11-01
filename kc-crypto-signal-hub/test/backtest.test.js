const test = require('node:test');
const assert = require('node:assert');
const { config } = require('../src/config');
const { buildScenario } = require('./helpers/scenario');
const { runBacktest, splitTrades } = require('../src/backtest/engine');
const { computeMetrics } = require('../src/backtest/metrics');
const { buildReport } = require('../src/backtest/report');

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('دقة الحساب: الدخول والخروج والرسوم والربح تطابق الحساب اليدوي', () => {
  const r = runBacktest({ BTCUSDT: buildScenario().data });
  const [t] = r.trades;
  const fee = config.risk.feeRate;
  const slip = config.risk.slippagePct / 100;
  // الدخول على افتتاح الشمعة التالية (داخل المنطقة) مع الانزلاق، والخروج على الهدف
  assert.ok(close(t.entry, t.zoneBottom * (1 + slip)));
  assert.ok(close(t.exit, t.takeProfit));
  const pnl = t.qty * (t.exit - t.entry) - t.qty * t.entry * fee - t.qty * t.exit * fee;
  assert.ok(close(t.pnl, pnl));
  assert.ok(close(t.r, pnl / t.riskAmount));
  assert.ok(close(r.finalBalance, config.risk.initialBalance + pnl));
});

test('الوقف: الخسارة الصافية لا تتجاوز 0.5% من الرصيد (1R)، والوقف يُحسب قبل الهدف في نفس الشمعة', () => {
  const sc = buildScenario({ afterBars: [] });
  const B = sc.B;
  // شمعة واحدة تلمس الوقف والهدف معاً
  const both = buildScenario({ afterBars: [[B + 0.9, B + 20, B - 5, B + 1]] });
  const r = runBacktest({ BTCUSDT: both.data });
  const [t] = r.trades;
  assert.strictEqual(t.outcome, 'stop');
  // الحجم محسوب على أسوأ سعر في المنطقة، فالدخول الأفضل يعطي خسارة أقل من 1R وليس أكثر أبداً
  assert.ok(t.pnl < 0 && t.pnl >= -0.25, `الخسارة ${t.pnl}`);
  assert.ok(t.r >= -1 && t.r < -0.8, `R = ${t.r}`);
});

test('نقل الوقف للتعادل (اختياري) بعد 1R، ولا يُوسّع الوقف أبداً', () => {
  const sc = buildScenario({ afterBars: [] });
  const B = sc.B;
  const data = buildScenario({ afterBars: [[B + 0.9, B + 4.2, B + 0.8, B + 4], [B + 4, B + 4.1, B - 5, B - 4]] }).data;
  const cfg = { ...config, strategy: { ...config.strategy, breakEven: true } };
  const [t] = runBacktest({ BTCUSDT: data }, cfg).trades;
  assert.strictEqual(t.outcome, 'breakeven');
  assert.ok(Math.abs(t.pnl) < 0.01, `النتيجة ${t.pnl}`);
  assert.ok(t.stop > t.stopLoss, 'الوقف تحرك للأعلى فقط');
  const [plain] = runBacktest({ BTCUSDT: data }).trades;
  assert.strictEqual(plain.outcome, 'stop', 'بدون الخيار يبقى الوقف الأصلي');
});

test('لا دخول مكرر: الزوجان بنفس الإعداد في نفس اللحظة = إشارة واحدة والثانية مرفوضة', () => {
  const { data } = buildScenario();
  const r = runBacktest({ BTCUSDT: data, ETHUSDT: data });
  assert.strictEqual(r.events.filter((e) => e.type === 'signal').length, 1);
  const rejected = r.events.find((e) => e.type === 'rejected');
  assert.strictEqual(rejected.pair, 'ETHUSDT');
  assert.ok(rejected.reasons.some((x) => x.includes('إشارة نشطة')));
  assert.strictEqual(r.trades.length, 1);
});

test('نفس البلوك لا يعطي إشارة ثانية', () => {
  const sc = buildScenario({ afterBars: [] });
  const B = sc.B;
  // بعد الهدف يعود السعر إلى نفس البلوك مرة أخرى
  const back = [[B + 0.9, B + 9, B + 0.8, B + 8.9], [B + 8.9, B + 9, B - 0.5, B + 0.2], [B + 0.2, B + 1, B, B + 0.9]];
  const r = runBacktest({ BTCUSDT: buildScenario({ afterBars: back }).data });
  assert.strictEqual(r.events.filter((e) => e.type === 'signal').length, 1);
});

test('المقاييس: نسبة الربح ومعامل الربح والتراجع وسلسلة الخسائر والتوقع', () => {
  const trades = [{ pnl: 0.5, r: 2 }, { pnl: -0.25, r: -1 }, { pnl: -0.25, r: -1 }, { pnl: 0.5, r: 2 }, { pnl: -0.25, r: -1 }];
  const m = computeMetrics(trades, 50);
  assert.strictEqual(m.totalTrades, 5);
  assert.strictEqual(m.winRate, 40);
  assert.ok(close(m.profitFactor, 1 / 0.75));
  assert.ok(close(m.netProfit, 0.25));
  assert.ok(close(m.maxDrawdown, 0.5));
  assert.strictEqual(m.longestLosingStreak, 2);
  assert.ok(close(m.avgR, 0.2));
  assert.ok(close(m.expectancy, 0.05));
});

test('التقسيم الزمني داخل/خارج العينة، والتقرير يذكر الجزأين', () => {
  const result = { start: 0, end: 100, trades: [{ filledAt: 10 }, { filledAt: 69 }, { filledAt: 70 }, { filledAt: 99 }], events: [] };
  const { train, test: oos } = splitTrades(result, 0.7);
  assert.deepStrictEqual(train.map((t) => t.filledAt), [10, 69]);
  assert.deepStrictEqual(oos.map((t) => t.filledAt), [70, 99]);

  const report = buildReport(runBacktest({ BTCUSDT: buildScenario().data }), config);
  assert.match(report, /داخل العينة/);
  assert.match(report, /خارج العينة/);
  assert.match(report, /الرسوم: 0.1%/);
});

test('الاختبار قابل للتكرار: نفس البيانات تعطي نفس النتيجة', () => {
  const { data } = buildScenario();
  assert.deepStrictEqual(runBacktest({ BTCUSDT: data }), runBacktest({ BTCUSDT: data }));
});
