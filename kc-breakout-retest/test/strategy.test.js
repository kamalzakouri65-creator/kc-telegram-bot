const test = require('node:test');
const assert = require('node:assert');
const { config } = require('../src/config');
const { buildScenario, r, M15 } = require('./helpers/scenario');
const { runBacktest, sizeTrade } = require('../src/engine');
const { findZones, breakoutAt } = require('../src/zones');
const { atr, swings } = require('../src/indicators');
const { metrics } = require('../src/report');

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const run = (opts) => runBacktest({ BTCUSDT: buildScenario(opts).data });

test('السيناريو الكامل: مقاومة بلمستين ثم اختراق ثم إعادة اختبار ثم دخول ثم الهدف', () => {
  const res = run();
  assert.strictEqual(res.trades.length, 1);
  const t = res.trades[0];
  assert.strictEqual(t.outcome, 'target');
  assert.strictEqual(t.zone.touches, 2);
  assert.ok(close(t.zone.level, 25.05));
  assert.ok(t.breakout.volumeRatio >= 1.5 && t.breakout.bodyPct >= 60);
  // الدخول عند قمة شمعة التأكيد (25.8) مع انزلاق 0.05%
  assert.ok(close(t.entry, 25.8 * 1.0005));
  // الوقف تحت قاع إعادة الاختبار (25.1) بـ 0.2 ATR(M15)
  assert.ok(t.stopLoss < 25.1 && t.stopLoss > 24.9);
  assert.ok(close(t.takeProfit, t.entry + 2 * (t.entry - t.stopLoss)));
});

test('دقة الحساب: الحجم والمخاطرة والرسوم والانزلاق تطابق الحساب اليدوي', () => {
  const t = run().trades[0];
  const fee = config.risk.feeRate;
  assert.ok(close(t.riskAmount, 0.5), 'المخاطرة 1% من 50$');
  assert.ok(t.qty <= 0.5 / (t.entry - t.stopLoss) && t.qty > 0.5 / (t.entry - t.stopLoss) - 0.00001);
  const exit = t.takeProfit * (1 - 0.0005);
  const pnl = t.qty * (exit - t.entry) - fee * t.qty * (t.entry + exit);
  assert.ok(close(t.exit, exit));
  assert.ok(close(t.pnl, pnl));
  assert.ok(t.r < 2 && t.r > 1.85, 'الرسوم والانزلاق تنقص النتيجة عن 2R');
});

test('بدون لمسة ثانية لا توجد مقاومة ولا صفقة', () => {
  const res = run({ secondTouch: false });
  assert.strictEqual(res.trades.length + res.skipped.length, 0);
});

test('حجم الاختراق أقل من 1.5 × المتوسط: لا اختراق', () => {
  assert.strictEqual(run({ breakoutVolume: 140 }).trades.length, 0);
});

test('اللمسة لا تُحسب إذا لم يبتعد السعر 0.5 ATR بين اللمستين', () => {
  const { data } = buildScenario();
  // البيانات الأصلية تعطي منطقة بلمستين عند الشمعة 41
  const original = findZones(data.h1, atr(data.h1, 14), swings(data.h1, 2).highs, 41);
  assert.strictEqual(original.length, 1);
  assert.deepStrictEqual(original[0].touches, [33, 38]);
  // نفس البيانات لكن السعر بين اللمستين لم ينزل تحت الحد السفلي بـ 0.5 ATR
  const h1 = data.h1.map((c, i) => (i >= 34 && i <= 37 ? { ...c, low: Math.max(c.low, 24.9) } : c));
  const z = findZones(h1, atr(h1, 14), swings(h1, 2).highs, 41);
  assert.strictEqual(z.length, 0);
});

test('إلغاء: إغلاق M15 تحت منتصف المنطقة قبل التأكيد', () => {
  const res = run({ retest: [r(6.0, 6.2, 5.6, 5.7), r(5.7, 5.8, 4.9, 4.95)] });
  assert.strictEqual(res.trades.length, 0);
  assert.match(res.skipped[0].reason, /تحت منتصف المنطقة قبل التأكيد/);
});

test('تخطي: شمعة التأكيد قبل أن يتأكد قاع M15', () => {
  const res = run({ retest: [r(6.0, 6.2, 5.6, 5.7), r(5.7, 5.8, 5.1, 5.3), r(5.3, 5.8, 5.28, 5.75)] });
  assert.strictEqual(res.trades.length, 0);
  assert.match(res.skipped[0].reason, /لا يوجد قاع M15 مؤكد/);
});

test('تخطي: قمة التأكيد لم تُخترق خلال 4 شموع', () => {
  const flat = Array(4).fill(r(5.6, 5.7, 5.5, 5.6));
  const res = run({ retest: [r(6.0, 6.2, 5.6, 5.7), r(5.7, 5.8, 5.1, 5.3), r(5.3, 5.45, 5.2, 5.25), r(5.25, 5.4, 5.22, 5.3), r(5.3, 5.8, 5.28, 5.75), ...flat], after: [] });
  assert.match(res.skipped[0].reason, /خلال 4 شموع/);
});

test('تخطي: لم يرجع السعر للمنطقة خلال 12 ساعة (لا مطاردة)', () => {
  const away = Array(52).fill(r(6.5, 6.7, 6.4, 6.6));
  const res = run({ retest: away, after: [] });
  assert.strictEqual(res.trades.length, 0);
  assert.match(res.skipped[0].reason, /لم يرجع السعر للمنطقة خلال 12 ساعة/);
});

test('الوقف والهدف في نفس الشمعة = وقف، ولمس الوقف في شمعة الدخول = وقف', () => {
  const both = run({ after: [r(5.95, 9, 4, 6)] }).trades[0];
  assert.strictEqual(both.outcome, 'stop');
  const fillCandleStop = run({
    retest: [r(6.0, 6.2, 5.6, 5.7), r(5.7, 5.8, 5.1, 5.3), r(5.3, 5.45, 5.2, 5.25), r(5.25, 5.4, 5.22, 5.3), r(5.3, 5.8, 5.28, 5.75), r(5.75, 5.9, 4.9, 5.85)],
    after: [r(5.85, 8, 5.8, 7.9)],
  }).trades[0];
  assert.strictEqual(fillCandleStop.outcome, 'stop');
});

test('الحجم: يُتخطى إذا كانت الصفقة أكبر من الرصيد أو أقل من الحد الأدنى، ولا يُعدّل أبداً', () => {
  const pair = config.pairs.BTCUSDT;
  const big = sizeTrade({ balance: 50, entry: 100000, stopLoss: 99800, pair, risk: config.risk });
  assert.deepStrictEqual([big.ok, big.reason], [false, 'قيمة الصفقة أكبر من الرصيد']);
  const tiny = sizeTrade({ balance: 50, entry: 100000, stopLoss: 80000, pair, risk: config.risk });
  assert.strictEqual(tiny.ok, false);
  assert.match(tiny.reason, /الحد الأدنى/);
  const ok = sizeTrade({ balance: 50, entry: 100000, stopLoss: 98000, pair, risk: config.risk });
  assert.ok(ok.ok && ok.notional <= 50 && ok.qty * 2000 <= 0.5 + 1e-9);
});

test('حدود الحساب: صفقة نشطة واحدة للعملتين معاً، والثانية تُتخطى مع السبب', () => {
  const { data } = buildScenario();
  const res = runBacktest({ BTCUSDT: data, ETHUSDT: data });
  assert.strictEqual(res.trades.length, 1);
  assert.match(res.skipped.find((s) => s.pair === 'ETHUSDT').reason, /توجد صفقة نشطة/);
});

test('لا إعادة رسم ولا نظر للمستقبل: قطع البيانات عند أي وقت يعطي نفس النتائج حتى ذلك الوقت', () => {
  const { data } = buildScenario();
  const full = runBacktest({ BTCUSDT: data });
  const key = (x) => JSON.stringify(x);
  for (let T = data.m15[150].closeTime; T <= data.m15.at(-1).closeTime; T += M15) {
    const cut = (cs) => cs.filter((c) => c.closeTime <= T);
    const part = runBacktest({ BTCUSDT: { h1: cut(data.h1), m15: cut(data.m15) } });
    assert.deepStrictEqual(part.trades.map(key), full.trades.filter((t) => t.exitTime <= T).map(key), new Date(T).toISOString());
    assert.deepStrictEqual(part.skipped.map(key), full.skipped.filter((s) => s.time <= T).map(key));
  }
});

test('تغيير الأسعار بعد الدخول لا يغيّر الدخول ولا الوقف ولا الهدف', () => {
  const a = run().trades[0];
  const b = run({ after: [r(5.95, 6, 3, 3.1)] }).trades[0];
  for (const k of ['entry', 'stopLoss', 'takeProfit', 'qty', 'signalTime']) assert.strictEqual(a[k], b[k], k);
});

test('الاختراق يُقيّم على المناطق كما كانت قبل شمعة الاختراق فقط', () => {
  const { data } = buildScenario();
  const a = atr(data.h1, 14);
  const sw = swings(data.h1, 2).highs;
  const hits = data.h1.map((_, i) => breakoutAt(data.h1, a, sw, i)).filter(Boolean);
  assert.strictEqual(hits.length, 1);
  assert.deepStrictEqual(hits[0].zone.touches, [33, 38]);
  assert.ok(hits[0].zone.touches.every((i) => i + 2 < hits[0].index), 'القمتان مؤكدتان قبل الاختراق');
});

test('المقاييس: نسبة الربح ومعامل الربح والتراجع وRR الفعلي وسلسلة الخسائر', () => {
  const t = (pnl, r) => ({ pnl, r });
  const m = metrics([t(1, 2), t(-0.5, -1), t(-0.5, -1), t(1, 2)], 50);
  assert.strictEqual(m.total, 4);
  assert.strictEqual(m.winRate, 50);
  assert.strictEqual(m.profitFactor, 2);
  assert.strictEqual(m.net, 1);
  assert.strictEqual(m.maxDd, 1);
  assert.strictEqual(m.longestLosingStreak, 2);
  assert.strictEqual(m.avgWinR / -m.avgLossR, 2);
});
