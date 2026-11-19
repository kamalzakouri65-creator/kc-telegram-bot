const test = require('node:test');
const assert = require('node:assert');
const { config } = require('../src/config');
const { signals } = require('../src/strategy');
const { simulate } = require('../src/backtest');
const { asianRange, byLondonDay } = require('../src/sessions');

// أيام شتوية (لندن = UTC). كل يوم: 96 شمعة 15 دقيقة. trendUp: إغلاق يومي صاعد
function makeDays(n, { lastDay } = {}) {
  const bars = [];
  for (let d = 0; d < n; d++) {
    const date = new Date(Date.UTC(2024, 0, 1 + d));
    const base = 2000 + d * 2; // اتجاه صاعد → الفلتر يسمح بالشراء
    for (let k = 0; k < 96; k++) {
      const ms = date.getTime() + k * 900000;
      let o = base;
      let h = base + 1;
      let l = base - 1;
      let c = base;
      if (d === n - 1 && lastDay) [o, h, l, c] = lastDay(k, base, [o, h, l, c]);
      bars.push({ time: new Date(ms).toISOString().slice(0, 19).replace('T', ' '), ms, open: o, high: h, low: l, close: c });
    }
  }
  return bars;
}

test('الشروط كما سُجّلت', () => {
  assert.deepStrictEqual(config.rule, { asian: { from: 0, to: 8 }, entry: { from: 8, to: 12 }, exitHour: 16, trendDays: 20, stopFrac: 0.5, rr: 1.5, minRange: 3, maxRange: 25 });
  assert.deepStrictEqual(config.costs, { spread: 0.52, slippage: 0.1 });
  assert.deepStrictEqual(config.criteria, { minPf: 1.3, minTrades: 150, minPositive: 7 });
  assert.deepStrictEqual(config.split, { devTo: '2023-12-31', confirmFrom: '2024-01-01' });
});

test('نطاق آسيا من 00:00 إلى 08:00 لندن فقط', () => {
  const bars = makeDays(1, { lastDay: (k, b, x) => (k === 40 ? [b, b + 50, b - 1, b] : x) }); // 10:00 خارج النطاق
  const [day] = byLondonDay(bars);
  const r = asianRange(day.bars, config.rule.asian);
  assert.deepStrictEqual([r.high, r.low], [2001, 1999]);
});

// النطاق 1996–2004 (8$)، كسر صاعد عند 08:30
const breakout = (k, b) => {
  if (k === 10) return [b, b + 4, b - 4, b]; // آسيا: النطاق ±4
  if (k === 34) return [b, b + 5, b, b + 4.5]; // 08:30 إغلاق فوق أعلى النطاق
  if (k === 36) return [b + 4.5, b + 20, b + 4, b + 19]; // 09:00 يصل الهدف
  if (k > 34) return [b + 4.5, b + 5, b + 4, b + 4.5]; // بعد الدخول: فوق الوقف
  return [b, b + 1, b - 1, b];
};

test('الدخول: أول إغلاق فوق النطاق في نافذة 08:00–12:00 مع الفلتر، والوقف منتصف النطاق، والهدف 1.5R', () => {
  const bars = makeDays(25, { lastDay: breakout });
  const sig = signals(bars);
  const s = sig.at(-1);
  const base = 2000 + 24 * 2;
  assert.strictEqual(s.time.slice(11, 16), '08:30');
  assert.strictEqual(s.dir, 1);
  assert.strictEqual(s.stop, base); // منتصف 1996..2004 بالنسبة للأساس
  assert.ok(Math.abs(s.target - (s.entry + 1.5 * (s.entry - s.stop))) < 1e-9);
  const [t] = simulate(bars, [s]);
  assert.strictEqual(t.how, 'هدف');
  assert.ok(Math.abs(t.r - (1.5 * 4.5 - 0.62) / 4.5) < 1e-9);
});

test('لا دخول عكس الفلتر، وأول كسر فقط في اليوم، والخروج بالوقت قبل 16:00', () => {
  const down = (k, b) => (k === 10 ? [b, b + 4, b - 4, b] : k === 34 ? [b, b, b - 5, b - 4.5] : k === 40 ? [b, b + 6, b, b + 5] : [b, b + 1, b - 1, b]);
  assert.strictEqual(signals(makeDays(25, { lastDay: down })).filter((s) => s.day === '2024-01-25').length, 0);
  const flat = (k, b) => (k === 10 ? [b, b + 4, b - 4, b] : k === 34 ? [b, b + 5, b, b + 4.5] : k > 34 ? [b + 4.5, b + 5, b + 4, b + 4.5] : [b, b + 1, b - 1, b]);
  const bars = makeDays(25, { lastDay: flat });
  const [t] = simulate(bars, signals(bars).slice(-1));
  assert.strictEqual(t.how, 'وقت');
  assert.strictEqual(t.exitTime.slice(11, 16), '15:45');
});

test('لا نظر للمستقبل: قطع البيانات لا يغيّر الصفقات المنتهية قبله', () => {
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const bars = [];
  let p = 2000;
  for (let k = 0; k < 96 * 120; k++) {
    const ms = Date.UTC(2024, 0, 1) + k * 900000;
    const n = p + rnd() * 3 + Math.sin(k / 400) * 0.3;
    bars.push({ time: new Date(ms).toISOString().slice(0, 19).replace('T', ' '), ms, open: p, high: Math.max(p, n) + Math.abs(rnd()), low: Math.min(p, n) - Math.abs(rnd()), close: n });
    p = n;
  }
  const full = simulate(bars, signals(bars));
  assert.ok(full.length > 5, 'يجب أن تظهر صفقات');
  for (const cut of [96 * 60, 96 * 90 + 40]) {
    const part = bars.slice(0, cut);
    const last = part.at(-1).time;
    assert.deepStrictEqual(simulate(part, signals(part)).filter((t) => t.exitTime < last && t.how !== 'وقت'), full.filter((t) => t.exitTime < last && t.how !== 'وقت'));
  }
});

test('الفكرة 2: نفس الإشارة بالعكس، والوقف خلف الدخول بنفس المسافة', () => {
  const bars = makeDays(25, { lastDay: breakout });
  const a = signals(bars).at(-1);
  const b = signals(bars, config.rule, { fade: true }).at(-1);
  assert.deepStrictEqual([b.time, b.entry, b.dir, b.risk], [a.time, a.entry, -1, a.risk]);
  assert.ok(Math.abs(b.stop - (a.entry + a.risk)) < 1e-9);
  assert.ok(Math.abs(b.target - (a.entry - 1.5 * a.risk)) < 1e-9);
});

test('الفكرة 3: الشروط كما سُجّلت، ودخول عند RSI(2) منخفض في اتجاه صاعد، ولا نظر للمستقبل', () => {
  const { RULE3, GRID3, idea3Trades } = require('../src/idea3');
  assert.deepStrictEqual(RULE3, { rsiBelow: 10, exitSma: 5, maxBars: 8, stopAtr: 2, minRisk: 3, from: 7, to: 20, trendDays: 20 });
  assert.deepStrictEqual(GRID3, { rsiBelow: [5, 10, 15], exitSma: [3, 5, 8] });
  let seed = 4;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const bars = [];
  let p = 2000;
  for (let k = 0; k < 96 * 80; k++) {
    const ms = Date.UTC(2024, 0, 1) + k * 900000;
    const n = p + rnd() * 3 + 0.02;
    bars.push({ time: new Date(ms).toISOString().slice(0, 19).replace('T', ' '), ms, open: p, high: Math.max(p, n) + Math.abs(rnd()) * 2, low: Math.min(p, n) - Math.abs(rnd()) * 2, close: n });
    p = n;
  }
  const full = idea3Trades(bars);
  assert.ok(full.length > 20, 'يجب أن تظهر صفقات');
  assert.ok(full.every((t) => t.time.slice(0, 10) === t.exitTime.slice(0, 10) || t.how !== 'وقت'));
  const part = bars.slice(0, 96 * 50);
  const last = part.at(-1).time;
  assert.deepStrictEqual(idea3Trades(part).filter((t) => t.exitTime < last && t.how !== 'وقت'), full.filter((t) => t.exitTime < last && t.how !== 'وقت'));
});

test('الفكرة 4: الشروط، وبناء الساعة، والدخول بعد لمس 61.8% وإغلاق فوقه، ولا نظر للمستقبل', () => {
  const { RULE4, GRID4, toH1, idea4Trades } = require('../src/idea4');
  assert.deepStrictEqual(RULE4, { level: 0.618, pivot: 5, minLegAtr: 2, window: 24, stopBufferAtr: 0.1, emaPeriod: 200 });
  assert.deepStrictEqual(GRID4, { level: [0.5, 0.618, 0.786], pivot: [3, 5, 8] });
  const m15 = [0, 1, 2, 3].map((k) => ({ ms: Date.UTC(2024, 0, 2, 10) + k * 900000, open: 10 + k, high: 11 + k, low: 9 + k, close: 10.5 + k }));
  const [h] = toH1(m15);
  assert.deepStrictEqual([h.open, h.high, h.low, h.close], [10, 14, 9, 13.5]);
  let seed = 12;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const bars = [];
  let p = 2000;
  for (let k = 0; k < 8000; k++) {
    const ms = Date.UTC(2023, 0, 2) + k * 3600000;
    const n = p + rnd() * 8 + Math.sin(k / 120) * 1.2;
    bars.push({ ms, time: new Date(ms).toISOString().slice(0, 19).replace('T', ' '), open: p, high: Math.max(p, n) + Math.abs(rnd()) * 3, low: Math.min(p, n) - Math.abs(rnd()) * 3, close: n });
    p = n;
  }
  const full = idea4Trades(bars);
  assert.ok(full.length > 10, 'يجب أن تظهر صفقات');
  assert.ok(full.every((t) => t.rr > 0));
  const part = bars.slice(0, 5000);
  const last = part.at(-1).time;
  assert.deepStrictEqual(idea4Trades(part).filter((t) => t.exitTime < last), full.filter((t) => t.exitTime < last));
});
