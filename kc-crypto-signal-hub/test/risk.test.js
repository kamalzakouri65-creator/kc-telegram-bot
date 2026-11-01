const test = require('node:test');
const assert = require('node:assert');
const { config } = require('../src/config');
const { sizePosition, floorToStep } = require('../src/risk/positionSizing');
const risk = require('../src/risk/riskManager');

const btc = config.pairs.BTCUSDT;
const size = (entry, stopLoss, balance = 50) =>
  sizePosition({ balance, entry, stopLoss, pair: btc, risk: config.risk, rewardRisk: config.strategy.rewardRisk });

test('الخسارة الصافية عند الوقف (مع الرسوم والانزلاق) لا تتجاوز 0.5% من الرصيد', () => {
  const s = size(100000, 99000); // وقف 1%
  assert.ok(s.ok, s.reasons.join());
  assert.ok(s.lossAtStop <= 0.25 + 1e-9 && s.lossAtStop > 0.24, `الخسارة ${s.lossAtStop}`);
  assert.strictEqual(s.qty, floorToStep(s.qty, btc.stepSize), 'الحجم مقرّب للأسفل لوحدة Binance');
  assert.ok(s.notional >= 5 && s.notional <= 50);
});

test('الهدف يعطي ربحاً صافياً = 2 × الخسارة الصافية بعد كل الرسوم', () => {
  const s = size(100000, 99000);
  const fee = config.risk.feeRate;
  const slip = config.risk.slippagePct / 100;
  const net = s.qty * (s.takeProfit - 100000) - s.qty * 100000 * (fee + slip) - s.qty * s.takeProfit * fee;
  assert.ok(Math.abs(net / s.lossAtStop - 2) < 1e-9);
  assert.ok(Math.abs(s.netRewardRisk - 2) < 1e-9);
});

test('رفض: الوقف قريب جداً فالرسوم أكبر من 35% من المخاطرة والصفقة أكبر من الرصيد', () => {
  const s = size(100000, 99900); // وقف 0.1%
  assert.ok(!s.ok);
  assert.ok(s.reasons.some((r) => r.includes('غير مجدية')));
  assert.ok(s.reasons.some((r) => r.includes('أكثر من الرصيد')));
});

test('رفض: الصفقة أقل من الحد الأدنى لـ Binance (لا نرفع الحجم إجبارياً)', () => {
  const s = size(100000, 90000, 50); // وقف 10%: الحجم ≈ 2.4$
  assert.ok(!s.ok);
  assert.ok(s.reasons.some((r) => r.includes('أقل من الحد الأدنى')));
  assert.ok(s.qty > 0 && s.notional < 5, 'الحجم لم يُرفع');
});

test('رفض: الحجم أصغر من أقل وحدة، أو وقف فوق الدخول', () => {
  assert.ok(size(100000, 50000, 1).reasons.some((r) => r.includes('أقل وحدة')));
  assert.ok(!size(100, 101).ok);
});

test('حدود اليوم: صفقتان كحد أقصى، وإشارة نشطة واحدة فقط', () => {
  const st = risk.createRiskState(50);
  risk.rollDay(st, Date.UTC(2026, 0, 1, 1));
  assert.ok(risk.canOpen(st, config.risk).ok);
  risk.onOpened(st, 'a');
  assert.ok(risk.canOpen(st, config.risk).reasons.some((r) => r.includes('إشارة نشطة')));
  risk.onClosed(st, 0.5);
  risk.onOpened(st, 'b');
  risk.onClosed(st, 0.5);
  assert.ok(risk.canOpen(st, config.risk).reasons.some((r) => r.includes('للحد اليومي')));
  risk.rollDay(st, Date.UTC(2026, 0, 2, 1));
  assert.ok(risk.canOpen(st, config.risk).ok, 'يوم جديد يعيد الحدود');
});

test('خسارتان متتاليتان = حد الخسارة اليومي 1% = توقف حتى الغد', () => {
  const st = risk.createRiskState(50);
  risk.rollDay(st, Date.UTC(2026, 0, 1, 1));
  for (const id of ['a', 'b']) {
    risk.onOpened(st, id);
    risk.onClosed(st, -0.25);
  }
  const blocked = risk.canOpen(st, config.risk);
  assert.ok(blocked.reasons.some((r) => r.includes('حد الخسارة اليومي')));
  assert.ok(blocked.reasons.some((r) => r.includes('خسائر متتالية')));
  assert.strictEqual(st.balance, 49.5);
});

test('إشارة لم تُنفّذ لا تُحسب ضمن صفقات اليوم', () => {
  const st = risk.createRiskState(50);
  risk.rollDay(st, Date.UTC(2026, 0, 1, 1));
  risk.onOpened(st, 'a');
  risk.onCancelled(st);
  assert.strictEqual(st.tradesToday, 0);
  assert.strictEqual(st.activeId, null);
});

test('المخاطرة لا ترتفع بعد الخسائر', () => {
  const before = size(100000, 99000, 50).lossAtStop;
  const after = size(100000, 99000, 49.5).lossAtStop;
  assert.ok(after <= before);
  assert.strictEqual(config.risk.riskPct, 0.5);
});
