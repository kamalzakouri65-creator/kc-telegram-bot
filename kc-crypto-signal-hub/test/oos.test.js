const test = require('node:test');
const assert = require('node:assert');
const { config } = require('../src/config');
const { buildScenario } = require('./helpers/scenario');
const { runBacktest } = require('../src/backtest/engine');
const { PREREGISTERED, evaluate } = require('../src/backtest/oos');

const withRally = (pct) => ({ ...config, strategy: { ...config.strategy, maxRally24hPct: pct } });
const signals = (r) => r.events.filter((e) => e.type === 'signal').length;

test('الفلتر متوقف افتراضياً، وعند تفعيله يمنع الشراء بعد صعود قوي خلال 24 ساعة', () => {
  // السيناريو صعد حوالي 3% خلال آخر 24 ساعة قبل الإعداد
  const { data } = buildScenario();
  assert.strictEqual(config.strategy.maxRally24hPct, null);
  assert.strictEqual(signals(runBacktest({ BTCUSDT: data })), 1);
  assert.strictEqual(signals(runBacktest({ BTCUSDT: data }, withRally(1.5))), 0);
  assert.strictEqual(signals(runBacktest({ BTCUSDT: data }, withRally(10))), 1);
});

test('البيانات خارج العينة قبل البيانات التي اكتُشفت منها الفرضية ولا تتداخل معها', () => {
  assert.ok(PREREGISTERED.to <= Date.UTC(2025, 9, 12));
  assert.ok(PREREGISTERED.to - PREREGISTERED.from >= 700 * 24 * 60 * 60 * 1000, 'سنتان تقريباً');
  assert.strictEqual(PREREGISTERED.maxRally24hPct, 1.5);
});

const t = (pair, pnl) => ({ pair, pnl, r: pnl / 0.25 });

test('شروط النجاح: كلها مطلوبة', () => {
  const pairs = ['BTCUSDT', 'ETHUSDT'];
  const base = [...Array(20).fill(t('BTCUSDT', -0.25)), ...Array(20).fill(t('ETHUSDT', -0.25))];
  // نجاح: لكل زوج 8 رابحة (+0.5$) و 8 خاسرة (-0.25$) = 32 صفقة ومعامل ربح 2، وتحسن على الزوجين
  const perPair = (pair) => [...Array(8).fill(t(pair, 0.5)), ...Array(8).fill(t(pair, -0.25))];
  const good = [...perPair('BTCUSDT'), ...perPair('ETHUSDT')];
  const ok = evaluate(base, good, 50, pairs);
  assert.ok(ok.filtered.profitFactor > 1.2 && ok.filtered.totalTrades >= 30, JSON.stringify(ok.checks));
  assert.strictEqual(ok.passed, true);

  // فشل: صفقات قليلة
  assert.strictEqual(evaluate(base, good.slice(0, 20), 50, pairs).checks[1].ok, false);
  // فشل: زوج لم يتحسن
  const worseEth = [...good.filter((x) => x.pair === 'BTCUSDT'), ...Array(30).fill(t('ETHUSDT', -0.25))];
  const r = evaluate(base, worseEth, 50, pairs);
  assert.strictEqual(r.checks[2].ok, false);
  assert.strictEqual(r.passed, false);
});
