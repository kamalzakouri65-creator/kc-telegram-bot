const test = require('node:test');
const assert = require('node:assert');
const { evaluate, formatRow, CANDIDATES } = require('../src/scan-pairs');

// شموع وهمية وإشارة شراء كل 20 شمعة: الوقف 1 تحت الدخول والهدفان +1.5 و+3
function series(n, winning) {
  return Array.from({ length: n }, (_, i) => {
    const day = String(1 + Math.floor(i / 24)).padStart(3, '0');
    const time = `2026-${day} ${String(i % 24).padStart(2, '0')}:00:00`;
    const k = i % 20;
    const p = 100;
    // بعد الإشارة: إما يصعد للهدفين أو ينزل للوقف
    if (k === 1) return winning ? { idx: i, time, open: p, high: p + 3.5, low: p - 0.2, close: p + 3 } : { idx: i, time, open: p, high: p + 0.2, low: p - 1.5, close: p - 1 };
    return { idx: i, time, open: p, high: p + 0.1, low: p - 0.1, close: p };
  });
}
// النافذة في الاختبار التاريخي محدودة بـ 500 شمعة، لذلك نعتمد على رقم الشمعة لا طول المصفوفة
const signalEvery20 = (cs) => (cs.at(-1).idx % 20 === 0 ? { side: 'BUY', time: cs.at(-1).time, entry: 100, stopLoss: 99, takeProfit1: 101.5, takeProfit2: 103 } : null);

test('زوج رابح بما يكفي من الصفقات يجتاز الشروط', () => {
  const r = evaluate(series(800, true), signalEvery20, 0);
  assert.strictEqual(r.count, 40);
  assert.ok(r.pass, r.reasons.join());
  assert.ok(r.oosCount > 0 && r.oosR > 0);
  assert.match(formatRow('EUR/USD', '1h', 'Pullback', r), /^✅ EUR\/USD 1h Pullback\n.*40 صفقة.*PF ∞/);
});

test('زوج خاسر يفشل مع ذكر الأسباب، والسبريد يُخصم', () => {
  const r = evaluate(series(800, false), signalEvery20, 0.1);
  assert.strictEqual(r.pass, false);
  assert.ok(Math.abs(r.trades[0].r - -1.1) < 1e-9, 'سبريد 0.1 على مخاطرة 1 = −0.1R إضافية');
  assert.match(formatRow('GBP/JPY', '4h', 'EMA + MACD', r), /السبب: معامل الربح أقل من 1\.2، الفترة الأخيرة غير رابحة/);
});

test('عدد صفقات قليل يفشل حتى لو كانت رابحة', () => {
  const r = evaluate(series(300, true), signalEvery20, 0);
  assert.ok(r.count < 30);
  assert.deepStrictEqual(r.reasons, ['صفقات أقل من 30']);
});

test('كل المرشحين لهم رمز Yahoo وسبريد', () => {
  for (const c of CANDIDATES) assert.ok(c.ticker && c.spread > 0, c.symbol);
});
