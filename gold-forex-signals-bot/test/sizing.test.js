const test = require('node:test');
const assert = require('node:assert');
const { suggestLot, timeframeLabel } = require('../src/sizing');
const { formatSignal } = require('../src/format');

const sig = (entry, stopLoss) => ({ side: 'BUY', entry, stopLoss, takeProfit1: entry + 1, takeProfit2: entry + 2, rsi: 55, atr: 1, time: '2026-11-05 12:00:00' });

test('الذهب Micro: 1 لوت = 1 أونصة، وأكبر حجم لا يتجاوز 3$', () => {
  assert.deepStrictEqual(suggestLot('XAU/USD', 4090, 4075, 3), { ok: true, distance: 15, lot: 0.2, loss: 3 });
  const s = suggestLot('XAU/USD', 4090, 4068.5, 3);
  assert.strictEqual(s.lot, 0.1);
  assert.ok(Math.abs(s.loss - 2.15) < 1e-9);
  assert.strictEqual(suggestLot('XAU/USD', 4090, 4120.5, 3).ok, false, 'وقف 30.5$ أكبر من الحد');
});

test('الفضة Micro: 0.1 لوت = 5 أونصات، وإشارة 4h بوقف 1.953 تُتخطى', () => {
  assert.strictEqual(suggestLot('XAG/USD', 50.395, 51.008, 3).ok, false);
  const ok = suggestLot('XAG/USD', 50.0, 50.5, 3);
  assert.deepStrictEqual([ok.ok, ok.lot], [true, 0.1]);
  const far = suggestLot('XAG/USD', 51.765, 53.718, 3);
  assert.strictEqual(far.ok, false);
  assert.ok(Math.abs(far.minLoss - 9.765) < 1e-9);
});

test('رمز غير معروف أو حد 0: لا يوجد سطر حجم', () => {
  assert.strictEqual(suggestLot('EUR/USD', 1.1, 1.09, 3), null);
  assert.strictEqual(suggestLot('XAU/USD', 4090, 4080, 0), null);
});

test('رسالة الإشارة تذكر الإطار والحجم أو التخطي', () => {
  const ok = formatSignal('XAU/USD', '1h', sig(4090.2, 4068.5), 'pullback', { maxLossUsd: 3 });
  assert.match(ok, /⏱️ الإطار: ساعة واحدة \(H1\) — افتح الشارت على H1/);
  assert.match(ok, /✅ مناسبة لحسابك: الحجم 0\.1 لوت ← خسارة ~2\.17\$ عند الوقف/);
  const far = formatSignal('XAG/USD', '4h', sig(51.765, 53.718), 'pullback', { maxLossUsd: 3 });
  assert.match(far, /الإطار: 4 ساعات \(H4\) — افتح الشارت على H4/);
  assert.match(far, /❌ الوقف بعيد \(1\.953\): أصغر حجم 0\.1 يخسر ~9\.77\$ \(أكثر من 3\$\) — تخطَّها/);
  assert.doesNotMatch(formatSignal('XAU/USD', '1h', sig(4090, 4080)), /مناسبة|تخطَّها/, 'بدون حد لا يظهر سطر الحجم');
  assert.strictEqual(timeframeLabel('2h'), '2h');
});
