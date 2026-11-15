const test = require('node:test');
const assert = require('node:assert');
const { status, forwardTrades } = require('../src/forward');

const tr = (o) => ({ symbol: 'XAU/USD', interval: '4h', strategy: 'pullback', side: 'BUY', time: '2026-11-17 08:00:00', closedAt: '2026-11-17 12:00:00', entry: 4000, stopLoss: 3990, closed: true, r: 2.25, ...o });

test('تُحسب فقط صفقات الذهب 4h للإعدادين وبعد تاريخ البداية، مع خصم التكاليف', () => {
  const all = [tr({}), tr({ time: '2026-11-15 20:00:00' }), tr({ interval: '1h' }), tr({ symbol: 'XAG/USD' }), tr({ strategy: 'rsi2' }), tr({ closed: false })];
  const f = forwardTrades(all);
  assert.strictEqual(f.length, 1);
  assert.ok(Math.abs(f[0].r - (2.25 - 0.34 / 10)) < 1e-9, 'بدون ليلة: سبريد + انزلاق فقط');
  const night = forwardTrades([tr({ closedAt: '2026-11-18 12:00:00' })])[0];
  assert.ok(Math.abs(night.r - (2.25 - (0.34 + 0.8) / 10)) < 1e-9, 'ليلة واحدة: 0.02% من 4000 = 0.8');
});

test('لا حكم قبل 30 صفقة، والحكم على أول 30 فقط', () => {
  const at = (k) => `2027-01-${String(1 + k).padStart(2, '0')} 08:00:00`;
  const at2 = (k) => `2027-01-${String(1 + k).padStart(2, '0')} 12:00:00`;
  const few = Array.from({ length: 10 }, (_, k) => tr({ time: at(k), closedAt: at2(k) }));
  assert.strictEqual(status(few).verdict, 'جارٍ');
  const ok = [];
  for (let k = 0; k < 30; k++) ok.push(tr({ strategy: k % 2 ? 'pullback' : 'ema-macd', time: at(k), closedAt: at2(k), r: k % 4 < 2 ? 2.25 : -1 }));
  const s = status(ok);
  assert.strictEqual(s.judged.length, 30);
  assert.strictEqual(s.verdict, 'نجح', s.reasons.join(' | '));
});

test('إيقاف مبكر عند تراجع 10R', () => {
  const losses = Array.from({ length: 12 }, (_, k) => tr({ time: `2027-01-${String(1 + k).padStart(2, '0')} 08:00:00`, closedAt: `2027-01-${String(1 + k).padStart(2, '0')} 12:00:00`, r: -1 }));
  const s = status(losses);
  assert.strictEqual(s.verdict, 'فشل');
  assert.match(s.reasons[0], /إيقاف مبكر/);
});
