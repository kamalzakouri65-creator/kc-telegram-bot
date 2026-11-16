const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runRsi2Windowed, runCryptoWindowed } = require('../src/engine');
const { runRsi2 } = require('../../kc-nasdaq-daily/src/engine');
const { runLongOnly } = require('../../kc-crypto-daily/src/engine');
const { analyze } = require('../../gold-forex-signals-bot/src/strategy');

// شموع يومية عشوائية ثابتة مع اتجاه صاعد وتراجعات
function daily(n = 1500, fmt = (d) => d) {
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const out = [];
  let p = 1000;
  for (let k = 0; k < n; k++) {
    const day = new Date(Date.parse('2010-01-04T00:00:00Z') + k * 86400000).toISOString().slice(0, 10);
    const next = p * (1 + rnd() * 0.03 + 0.0006 + Math.sin(k / 70) * 0.004);
    out.push({ time: fmt(day), open: p, high: Math.max(p, next) * (1 + Math.abs(rnd()) * 0.01), low: Math.min(p, next) * (1 - Math.abs(rnd()) * 0.01), close: next });
    p = next;
  }
  return out;
}

test('RSI(2) بكل التاريخ يطابق محرك kc-nasdaq-daily بالضبط', () => {
  const c = daily();
  const a = runRsi2(c, { from: '2010-09-01', spreadPct: 0.007 });
  const b = runRsi2Windowed(c, { from: '2010-09-01', spreadPct: 0.007 });
  assert.ok(a.length > 10, 'يجب أن تظهر صفقات');
  assert.deepStrictEqual(b.map((t) => [t.time, t.closedAt, +t.r.toFixed(10)]), a.map((t) => [t.time, t.closedAt, +t.r.toFixed(10)]));
});

test('الكريبتو بنافذة 500 يطابق محرك kc-crypto-daily بالضبط', () => {
  const c = daily(1500, (d) => `${d} 00:00:00`);
  const a = runLongOnly(c, analyze, { from: '0000' });
  const b = runCryptoWindowed(c, analyze, { window: 500 });
  assert.ok(a.length > 3, 'يجب أن تظهر صفقات');
  assert.deepStrictEqual(b.map((t) => [t.time, t.closedAt, +t.r.toFixed(10)]), a.map((t) => [t.time, t.closedAt, +t.r.toFixed(10)]));
});

test('لا يكتب في أي مشروع آخر ولا يحتوي كود تداول', () => {
  const dir = path.join(__dirname, '..', 'src');
  for (const f of fs.readdirSync(dir)) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/(yahoo|binance)\.save\(/.test(t), `${f}: يجب الحفظ في مجلد هذا المشروع فقط`);
    for (const p of [/order_send|placeOrder|createOrder|OrderSend/i, /metaapi/i, /withdraw/i, /\/api\/v3\/order/]) assert.ok(!p.test(t), `${f}: ${p}`);
  }
});
