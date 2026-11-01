const test = require('node:test');
const assert = require('node:assert');
const { buildScenario } = require('./helpers/scenario');
const { runBacktest } = require('../src/backtest/engine');
const { diagnose, formatDiagnosis, efficiency } = require('../src/backtest/diagnose');

const run = (afterBars) => {
  const sc = buildScenario({ afterBars });
  return diagnose({ BTCUSDT: sc.data }, runBacktest({ BTCUSDT: sc.data }));
};
const { B } = buildScenario();
const rel = (o, h, l, c) => [B + o, B + h, B + l, B + c];

test('صفقة رابحة: موقع الدخول في الحركة وأقصى تقدم محسوبان بدقة', () => {
  const [d] = run();
  assert.strictEqual(d.outcome, 'target');
  // من قاع السحب (B-1.4) إلى قمة الحركة (B+2.6): الدخول عند 161.03 = 60.8%
  assert.ok(Math.abs(d.legPct - 60.8) < 0.1, `${d.legPct}`);
  assert.ok(d.mfe >= 2, 'وصل للهدف');
  assert.strictEqual(d.directStop, false);
  assert.strictEqual(d.session, 'نيويورك (13-21)');
});

test('وقف مباشر ثم وصول السعر للهدف بعده يُكتشفان', () => {
  const [d] = run([rel(0.9, 1.3, -5, -4), rel(-4, 9, -4.5, 8.9)]);
  assert.strictEqual(d.outcome, 'stop');
  assert.strictEqual(d.directStop, true);
  assert.strictEqual(d.targetAfterStop, true);
  assert.ok(d.mfe < 0.5);
  assert.ok(d.mfeBeforeExit < d.tpR, 'لم يصل للهدف قبل الوقف');
  assert.ok(d.tpR > 2, `الهدف بوحدة R السعرية ${d.tpR}`);
});

test('شمعة واحدة تلمس الهدف والوقف معاً تُصنّف بوضوح، والمحرك لا يتجاهل هدفاً سابقاً', () => {
  // شمعة M5 واحدة (أول شمعة بعد الدخول) مداها من تحت الوقف إلى فوق الهدف
  const sc = buildScenario({ afterBars: [rel(0.9, 1, 0.8, 0.95)] });
  Object.assign(sc.data.m5[sc.engulfIndex + 2], { high: B + 20, low: B - 5 });
  const [d] = diagnose({ BTCUSDT: sc.data }, runBacktest({ BTCUSDT: sc.data }));
  assert.strictEqual(d.outcome, 'stop');
  assert.ok(d.mfe >= d.tpR && d.mfeBeforeExit < d.tpR);
  assert.match(formatDiagnosis([d]), /لمست الهدف والوقف معاً \(احتُسبت وقفاً\): 1/);
  assert.match(formatDiagnosis([d]), /قبل شمعة الخروج: 0/);
});

test('كفاءة الحركة: 1 في الاتجاه النظيف، وقريبة من 0 في التذبذب', () => {
  const trend = Array.from({ length: 30 }, (_, i) => ({ close: 100 + i }));
  const chop = Array.from({ length: 30 }, (_, i) => ({ close: 100 + (i % 2) }));
  assert.strictEqual(efficiency(trend, 29, 24), 1);
  assert.ok(efficiency(chop, 29, 24) < 0.1);
});

test('التقرير يجيب على الأسئلة الست', () => {
  const text = formatDiagnosis(run([rel(0.9, 1.3, -5, -4), rel(-4, 9, -4.5, 8.9)]));
  for (const part of ['وقف مباشر', 'موقع الدخول', 'تحت البلوك', 'الجلسة', 'الزوج × حالة السوق', 'عرضي أم اتجاه']) assert.ok(text.includes(part), part);
});
