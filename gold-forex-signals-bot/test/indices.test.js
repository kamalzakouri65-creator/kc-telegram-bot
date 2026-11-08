const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeRsi2 } = require('../src/rsi2');
const { indexMarkets } = require('../src/indices');
const { dailyStillOpen } = require('../src/yahoo');
const { createTracker } = require('../src/tracker');
const { formatSignal, formatTradeEvent, formatResults } = require('../src/format');

const day = (k) => new Date(Date.UTC(2025, 0, 6) + k * 86400000).toISOString().slice(0, 10) + ' 14:30:00';
// 250 يوماً صاعدة ثم 3 أيام هبوط حاد
function series() {
  const cs = [];
  let p = 20000;
  for (let k = 0; k < 250; k++) {
    const o = p;
    p += k % 2 ? 40 : -10;
    cs.push({ time: day(k), open: o, high: Math.max(o, p) + 30, low: Math.min(o, p) - 30, close: p });
  }
  for (let k = 0; k < 3; k++) {
    const o = p;
    p -= 200;
    cs.push({ time: day(250 + k), open: o, high: o + 10, low: p - 20, close: p });
  }
  return cs;
}
const tmpTracker = () => createTracker(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'idx-')), 't.json'));

test('RSI(2): إشارة شراء بعد هبوط حاد فوق متوسط 200 يوم، ولا إشارة في الصعود', () => {
  const cs = series();
  const s = analyzeRsi2(cs);
  assert.strictEqual(s.side, 'BUY');
  assert.ok(s.rsi < 10 && s.stopLoss < s.entry);
  assert.deepStrictEqual(s.exitRule, { sma: 5, maxBars: 10 });
  assert.strictEqual(analyzeRsi2(cs.slice(0, 250)), null);
});

test('الأسواق الافتراضية، والإيقاف بقيمة فارغة', () => {
  assert.deepStrictEqual(indexMarkets().map((m) => m.symbol), ['NASDAQ 100', 'S&P 500']);
  assert.ok(indexMarkets().every((m) => m.strategies.join() === 'rsi2' && m.onePosition && m.interval === '1day'));
  assert.strictEqual(indexMarkets('').length, 0);
});

test('شمعة اليوم اليومية: مفتوحة قبل إغلاق نيويورك، ومكتملة بعده', () => {
  const today = Date.UTC(2026, 10, 9, 14, 30) / 1000;
  assert.strictEqual(dailyStillOpen(today, new Date(Date.UTC(2026, 10, 9, 18))), true);
  assert.strictEqual(dailyStillOpen(today, new Date(Date.UTC(2026, 10, 9, 21, 30))), false);
  assert.strictEqual(dailyStillOpen(today, new Date(Date.UTC(2026, 10, 10, 8))), false, 'شمعة الأمس مكتملة');
});

test('المتابعة: الخروج عند أول إغلاق فوق متوسط 5 أيام، ورسالة "اخرج الآن"', () => {
  const cs = series();
  const s = analyzeRsi2(cs);
  const t = tmpTracker();
  t.add('NASDAQ 100', '1day', s, 'rsi2');
  assert.strictEqual(t.hasOpen('NASDAQ 100', '1day', 'rsi2'), true);
  const p = cs.at(-1).close;
  const next = [...cs, { time: day(253), open: p, high: p + 50, low: p - 20, close: p + 40 }, { time: day(254), open: p + 40, high: p + 700, low: p + 30, close: p + 650 }];
  const events = t.update('NASDAQ 100', '1day', next);
  assert.deepStrictEqual(events.map((e) => e.type), ['exit']);
  const tr = events[0].trade;
  assert.strictEqual(tr.exitReason, 'sma');
  assert.ok(tr.r > 0);
  assert.match(formatTradeEvent(events[0]), /اخرج الآن: أُغلق السعر فوق متوسط 5 أيام[\s\S]*✅/);
  assert.match(formatResults(t.summary()), /RSI\(2\)/);
});

test('المتابعة: فجوة تحت الوقف تُغلق بسعر الافتتاح، والخروج بعد 10 أيام', () => {
  const cs = series();
  const s = analyzeRsi2(cs);
  const t = tmpTracker();
  t.add('S&P 500', '1day', s, 'rsi2');
  const gap = s.stopLoss - 100;
  const [e] = t.update('S&P 500', '1day', [...cs, { time: day(253), open: gap, high: gap + 10, low: gap - 50, close: gap }]);
  assert.strictEqual(e.type, 'sl');
  assert.strictEqual(e.trade.exit, gap);
  assert.ok(e.trade.r < -1);

  const t2 = tmpTracker();
  t2.add('S&P 500', '1day', s, 'rsi2');
  const p = cs.at(-1).close;
  const flat = Array.from({ length: 10 }, (_, k) => ({ time: day(253 + k), open: p - 5 * k, high: p - 5 * k + 1, low: p - 5 * k - 1, close: p - 5 * (k + 1) }));
  const [e2] = t2.update('S&P 500', '1day', [...cs, ...flat]);
  assert.strictEqual(e2.trade.exitReason, 'time');
  assert.match(formatTradeEvent(e2), /مرت 10 أيام/);
});

test('رسالة إشارة المؤشر: لا أهداف، قاعدة الخروج، واسم XM', () => {
  const text = formatSignal('NASDAQ 100', '1day', analyzeRsi2(series()), 'rsi2', { maxLossUsd: 3 });
  assert.match(text, /NASDAQ 100 — 1day — RSI\(2\)/);
  assert.match(text, /الخروج: عند أول إغلاق يومي فوق متوسط 5 أيام، أو بعد 10 أيام/);
  assert.match(text, /XM: US100Cash — شراء فقط/);
  assert.doesNotMatch(text, /الهدف 1|لوت/);
});
