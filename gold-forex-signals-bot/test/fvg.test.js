const test = require('node:test');
const assert = require('node:assert');
const { analyzeFvg } = require('../src/fvg');

// ترند صاعد هادئ (EMA50 فوق EMA200) ثم فجوة صاعدة ثم رجوع لها
function scenario({ retest = true, earlyTouch = false, breakBelow = false } = {}) {
  const cs = [];
  let p = 100;
  for (let i = 0; i < 230; i++) {
    const o = p;
    p += 0.1;
    cs.push({ time: `t${i}`, open: o, high: p + 0.2, low: o - 0.2, close: p });
  }
  // الشمعة 230: k-2، قمتها H
  const H = p + 0.2;
  cs.push({ time: 'k-2', open: p, high: H, low: p - 0.2, close: p + 0.1 });
  // اندفاع قوي
  cs.push({ time: 'k-1', open: p + 0.1, high: p + 3.2, low: p, close: p + 3 });
  // الشمعة k: قاعها أعلى من H بـ 1.5 (الفجوة 1.5)
  const near = H + 1.5;
  cs.push({ time: 'k', open: p + 3, high: p + 3.6, low: near, close: p + 3.4 });
  // شموع تبقى فوق الفجوة
  for (let j = 0; j < 3; j++) cs.push({ time: `a${j}`, open: p + 3.4, high: p + 3.7, low: earlyTouch && j === 1 ? near - 0.1 : near + 0.3, close: breakBelow && j === 2 ? H - 0.5 : p + 3.4 });
  // الرجوع: القاع يلمس أعلى الفجوة والإغلاق صاعد فوقها
  if (retest) cs.push({ time: 'entry', open: near + 0.2, high: near + 1, low: near - 0.4, close: near + 0.8 });
  return { cs, H, near };
}

test('شراء عند أول رجوع للفجوة مع إغلاق صاعد فوقها، والوقف تحت الفجوة', () => {
  const { cs, H, near } = scenario();
  const s = analyzeFvg(cs);
  assert.ok(s, 'يجب أن تظهر إشارة');
  assert.strictEqual(s.side, 'BUY');
  assert.strictEqual(s.entry, near + 0.8);
  assert.ok(s.stopLoss < H && s.stopLoss > H - 1, 'الوقف تحت أسفل الفجوة بهامش صغير');
  const risk = s.entry - s.stopLoss;
  assert.ok(Math.abs(s.takeProfit1 - (s.entry + 1.5 * risk)) < 1e-9);
  assert.ok(Math.abs(s.takeProfit2 - (s.entry + 3 * risk)) < 1e-9);
  assert.deepStrictEqual(s.zone, { bottom: H, top: near });
});

test('لا إشارة قبل الرجوع، ولا إذا لُمست الفجوة من قبل، ولا إذا أُغلق تحتها', () => {
  assert.strictEqual(analyzeFvg(scenario({ retest: false }).cs), null);
  assert.strictEqual(analyzeFvg(scenario({ earlyTouch: true }).cs), null, 'الرجوع الأول فقط');
  assert.strictEqual(analyzeFvg(scenario({ breakBelow: true }).cs), null, 'الفجوة أُلغيت بالإغلاق تحتها');
});

test('البيع هو الشراء بالعكس تماماً', () => {
  const { cs } = scenario();
  const mirror = cs.map((c) => ({ time: c.time, open: 400 - c.open, high: 400 - c.low, low: 400 - c.high, close: 400 - c.close }));
  const buy = analyzeFvg(cs);
  const sell = analyzeFvg(mirror);
  assert.strictEqual(sell.side, 'SELL');
  assert.ok(Math.abs(sell.entry - (400 - buy.entry)) < 1e-9);
  assert.ok(Math.abs(sell.stopLoss - (400 - buy.stopLoss)) < 1e-9);
});

test('بدون ترند صاعد (EMA50 تحت EMA200) لا شراء', () => {
  const { cs } = scenario();
  // نجعل الشموع الأولى أعلى بكثير حتى يصبح الترند هابطاً
  const down = cs.map((c, i) => (i < 200 ? { ...c, open: c.open + 60 - i * 0.3, high: c.high + 60 - i * 0.3, low: c.low + 60 - i * 0.3, close: c.close + 60 - i * 0.3 } : c));
  const s = analyzeFvg(down);
  assert.ok(!s || s.side !== 'BUY');
});
