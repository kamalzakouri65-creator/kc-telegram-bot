const test = require('node:test');
const assert = require('node:assert');
const { ema, rsi, macd, atr } = require('../src/indicators');
const { analyze, snapshot } = require('../src/strategy');

const toCandles = (closes) =>
  closes.map((c, i) => ({ time: `t${i}`, open: c, high: c + 1, low: c - 1, close: c }));

test('EMA لسلسلة ثابتة تساوي القيمة نفسها', () => {
  const out = ema(new Array(30).fill(5), 10);
  assert.strictEqual(out[8], null);
  assert.strictEqual(out[29], 5);
});

test('RSI = 100 لسلسلة صاعدة فقط، و 0 لسلسلة هابطة فقط', () => {
  const up = Array.from({ length: 30 }, (_, i) => i);
  const down = up.map((x) => 100 - x);
  assert.strictEqual(rsi(up)[29], 100);
  assert.strictEqual(rsi(down)[29], 0);
});

test('RSI يطابق قيمة مرجعية معروفة (مثال Wilder)', () => {
  const closes = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61,
    46.28, 46.28,
  ];
  assert.ok(Math.abs(rsi(closes)[14] - 70.53) < 0.1);
});

test('MACD وخط الإشارة يبدآن في الموضع الصحيح', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5);
  const m = macd(closes);
  assert.strictEqual(m.line[24], null);
  assert.notStrictEqual(m.line[25], null);
  assert.strictEqual(m.signal[32], null);
  assert.notStrictEqual(m.signal[33], null);
});

test('ATR لشموع مداها ثابت يساوي ذلك المدى', () => {
  const out = atr(toCandles(new Array(30).fill(10)), 14);
  assert.strictEqual(out[29], 2);
});

test('لا إشارة عند نقص البيانات', () => {
  assert.strictEqual(analyze(toCandles(new Array(100).fill(1))), null);
  assert.strictEqual(snapshot(toCandles(new Array(100).fill(1))), null);
});

// اتجاه صاعد طويل ثم تصحيح ثم ارتداد: يجب أن يعطي تقاطع MACD صاعداً
function uptrendWithPullback() {
  const closes = [];
  for (let i = 0; i < 230; i++) closes.push(1800 + i * 2);
  let p = closes[closes.length - 1];
  for (let i = 0; i < 12; i++) closes.push((p -= 3));
  for (let i = 0; i < 40; i++) closes.push((p += 2.5));
  return closes;
}

test('اتجاه صاعد مع ارتداد يعطي إشارة شراء صحيحة في مكان ما', () => {
  const closes = uptrendWithPullback();
  let signal = null;
  for (let n = 215; n <= closes.length && !signal; n++) signal = analyze(toCandles(closes.slice(0, n)));
  assert.ok(signal, 'يجب أن تظهر إشارة');
  assert.strictEqual(signal.side, 'BUY');
  assert.ok(signal.stopLoss < signal.entry);
  assert.ok(signal.takeProfit1 > signal.entry && signal.takeProfit2 > signal.takeProfit1);
});

test('الاتجاه الهابط المعكوس يعطي إشارة بيع فقط', () => {
  const closes = uptrendWithPullback().map((c) => 5000 - c);
  const sides = new Set();
  for (let n = 215; n <= closes.length; n++) {
    const s = analyze(toCandles(closes.slice(0, n)));
    if (s) sides.add(s.side);
  }
  assert.deepStrictEqual([...sides], ['SELL']);
});
