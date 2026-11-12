const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { silverBullet, previousDayLevels } = require('../src/strategies');
const { evaluate } = require('../src/report');

const pad = (n) => String(n).padStart(2, '0');
// شموع 5 دقائق هادئة ليوم كامل حول السعر p
function quietDay(date, p = 100, step = 5) {
  const out = [];
  for (let m = 0; m < 24 * 60; m += step) out.push({ time: `${date} ${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`, open: p, high: p + 0.1, low: p - 0.1, close: p });
  return out;
}
const at = (cs, clock) => cs.findIndex((c) => c.time.slice(11, 16) === clock);
const set = (cs, clock, bar) => Object.assign(cs[at(cs, clock)], bar);

test('Silver Bullet: فجوة صاعدة في نافذة 10:00، رجوع إليها، ثم الهدف 2R', () => {
  const cs = quietDay('2026-03-02');
  set(cs, '10:00', { open: 100, high: 100.1, low: 99.9, close: 100 }); // k-2
  set(cs, '10:05', { open: 100, high: 101.5, low: 99.95, close: 101.4 }); // اندفاع
  set(cs, '10:10', { open: 101.4, high: 101.8, low: 100.6, close: 101.7 }); // k: قاعه 100.6 > 100.1
  for (const c of cs.slice(at(cs, '10:15'), at(cs, '10:30'))) Object.assign(c, { open: 101.7, high: 101.9, low: 101, close: 101.7 });
  set(cs, '10:30', { open: 101, high: 101.1, low: 100.55, close: 100.9 }); // الرجوع يلمس 100.6
  set(cs, '10:35', { open: 100.9, high: 101.2, low: 100.8, close: 101 });
  set(cs, '10:40', { open: 100.9, high: 103, low: 100.8, close: 102.9 }); // الهدف 100.6 + 2 × 0.7 = 102
  const [t] = silverBullet(cs, undefined, 0);
  assert.deepStrictEqual([t.side, t.window, t.entry, t.stopLoss, t.outcome], ['BUY', '10:00', 100.6, 99.9, 'target']);
  assert.ok(Math.abs(t.target - 102) < 1e-9);
  assert.ok(Math.abs(t.r - 2) < 1e-9);
});

test('Silver Bullet: فجوة خارج النوافذ لا تُحسب، ولمس الوقف في شمعة التنفيذ = وقف', () => {
  const out = quietDay('2026-03-03');
  set(out, '12:00', { high: 100.1 });
  set(out, '12:05', { open: 100, high: 101.5, low: 99.95, close: 101.4 });
  set(out, '12:10', { open: 101.4, high: 101.8, low: 100.6, close: 101.7 });
  assert.strictEqual(silverBullet(out, undefined, 0).length, 0);

  const cs = quietDay('2026-03-03');
  set(cs, '10:05', { open: 100, high: 101.5, low: 99.95, close: 101.4 });
  set(cs, '10:10', { open: 101.4, high: 101.8, low: 100.6, close: 101.7 });
  for (const c of cs.slice(at(cs, '10:15'), at(cs, '10:30'))) Object.assign(c, { open: 101.7, high: 101.9, low: 101, close: 101.7 });
  set(cs, '10:30', { open: 101, high: 101.1, low: 99.5, close: 99.6 }); // ينزل من الفجوة إلى تحت الوقف في نفس الشمعة
  const [t] = silverBullet(cs, undefined, 0);
  assert.strictEqual(t.outcome, 'stop');
  assert.ok(Math.abs(t.r + 1) < 1e-9);
});

test('Previous Day: سحب قمة الأمس ثم إغلاق تحتها = بيع، والوقف فوق قمة الشمعة', () => {
  const y = quietDay('2026-03-04', 100, 15);
  set(y, '13:00', { high: 101 }); // قمة الأمس 101
  const t0 = quietDay('2026-03-05', 100, 15);
  set(t0, '09:00', { open: 100.5, high: 101.4, low: 100.4, close: 100.6 }); // سحب ثم إغلاق تحت 101
  set(t0, '10:00', { open: 100.4, high: 100.5, low: 98, close: 98.2 });
  const { trades } = previousDayLevels([...y, ...t0], undefined, 0);
  assert.strictEqual(trades.length, 1);
  const t = trades[0];
  assert.deepStrictEqual([t.side, t.level, t.entry], ['SELL', 101, 100.6]);
  assert.ok(t.stopLoss > 101.4 && t.stopLoss < 101.5);
  assert.strictEqual(t.outcome, 'target');
});

test('Previous Day: يوم قصير (افتتاح الأحد) لا يصلح مرجعاً، ولا دخول قبل 02:00 أو بعد 12:00', () => {
  const sunday = quietDay('2026-03-08', 100, 15).filter((c) => c.time.slice(11, 16) >= '18:00'); // 24 شمعة فقط
  set(sunday, '19:00', { high: 100.3 });
  const monday = quietDay('2026-03-09', 100, 15);
  set(monday, '09:00', { open: 100.2, high: 100.5, low: 100.1, close: 100.2 });
  assert.strictEqual(previousDayLevels([...sunday, ...monday], undefined, 0).trades.length, 0);

  const y = quietDay('2026-03-10', 100, 15);
  set(y, '13:00', { high: 101 });
  const late = quietDay('2026-03-11', 100, 15);
  set(late, '01:00', { high: 101.5, close: 100.5 });
  set(late, '12:00', { high: 101.5, close: 100.5 });
  assert.strictEqual(previousDayLevels([...y, ...late], undefined, 0).trades.length, 0);
});

test('التقييم: يتطلب الفترتين موجبتين', () => {
  const days = Array.from({ length: 10 }, (_, k) => `2026-04-${pad(k + 1)}`);
  const trades = days.flatMap((d, k) => Array.from({ length: 12 }, () => ({ date: d, r: k < 7 ? 1 : -0.5 })));
  const ev = evaluate(trades, days);
  assert.deepStrictEqual(ev.reasons, ['الفترة الأخيرة غير رابحة']);
});

test('مستقل عن البوت: لا يستورد أي ملف منه، ولا يوجد كود تداول', () => {
  const dir = path.join(__dirname, '..', 'src');
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    // مسموح فقط قراءة الاستراتيجيات ومحرك الاختبار من البوت (بدون أي كتابة فيه)
    const imports = [...text.matchAll(/require\('([^']*gold-forex-signals-bot[^']*)'\)/g)].map((m) => m[1].split('/').pop());
    for (const name of imports) assert.ok(['strategy', 'pullback', 'backtest'].includes(name), `${f} يستورد ${name} من البوت`);
    assert.ok(!/writeFileSync\([^)]*gold-forex-signals-bot/.test(text), `${f} يكتب في البوت`);
    for (const p of [/order_send|placeOrder|createOrder/i, /metaapi/i, /withdraw/i]) assert.ok(!p.test(text), `${f}: ${p}`);
  }
});
