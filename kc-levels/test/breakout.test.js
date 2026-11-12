const test = require('node:test');
const assert = require('node:assert');
const { analyzeBreakout } = require('../src/breakout');

// تذبذب ثم قمة عند 110 (الشمعة 40) وقاع عند 104 (الشمعة 50)، ثم اختراق 110
function base() {
  const cs = [];
  for (let k = 0; k < 70; k++) {
    let high = 108;
    let low = 104;
    if (k === 40) high = 110;
    if (k === 50) low = 103;
    cs.push({ time: `t${k}`, open: 106, high, low, close: 106 });
  }
  return cs;
}

test('شراء عند أول إغلاق فوق آخر قمة مؤكدة، والوقف تحت آخر قاع', () => {
  const cs = [...base(), { time: 'e', open: 106, high: 111.5, low: 105.8, close: 111 }];
  const s = analyzeBreakout(cs);
  assert.strictEqual(s.side, 'BUY');
  assert.ok(s.stopLoss < 103 && s.stopLoss > 101);
});

test('لا إشارة إذا لم يُغلق فوق القمة، أو إذا كُسرت من قبل', () => {
  assert.strictEqual(analyzeBreakout([...base(), { time: 'e', open: 106, high: 111.5, low: 105.8, close: 109 }]), null);
  const cs = base();
  cs[60] = { time: 't60', open: 106, high: 111, low: 105, close: 110.5 };
  cs[61] = { time: 't61', open: 110, high: 110.2, low: 105, close: 106 };
  assert.strictEqual(analyzeBreakout([...cs, { time: 'e', open: 106, high: 111.5, low: 105.8, close: 111 }]), null);
});

test('البيع: كسر آخر قاع بالعكس', () => {
  const cs = [...base(), { time: 'e', open: 106, high: 111.5, low: 105.8, close: 111 }].map((c) => ({ time: c.time, open: 300 - c.open, high: 300 - c.low, low: 300 - c.high, close: 300 - c.close }));
  const s = analyzeBreakout(cs);
  assert.strictEqual(s.side, 'SELL');
  assert.ok(s.stopLoss > s.entry);
});
