const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { run, metrics, nightsHeld } = require('../src/engine');
const { cleanH1, group, h1FromM1 } = require('../src/data');
const { backtest } = require('../../gold-forex-signals-bot/src/backtest');
const { analyze } = require('../../gold-forex-signals-bot/src/strategy');
const { analyzePullback } = require('../../gold-forex-signals-bot/src/pullback');

// بيانات H1 عشوائية ثابتة في أيام التداول
function series(n = 3000) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const out = [];
  let p = 2000;
  for (let k = 0; out.length < n; k++) {
    const ms = Date.parse('2021-03-01T00:00:00Z') + k * 3600000;
    const d = new Date(ms).getUTCDay();
    if (d === 0 || d === 6) continue;
    const next = p + rnd() * 8 + Math.sin(k / 90) * 1.5;
    out.push({ ms, time: new Date(ms).toISOString().slice(0, 19).replace('T', ' '), open: p, high: Math.max(p, next) + Math.abs(rnd()) * 4, low: Math.min(p, next) - Math.abs(rnd()) * 4, close: next });
    p = next;
  }
  return out;
}

test('المحرك يطابق اختبار البوت بالضبط (نافذة 500، سبريد فقط)', () => {
  const cs = series();
  for (const fn of [analyze, analyzePullback]) {
    const bot = backtest(cs, fn, { spread: 0.35 }).trades;
    const mine = run(cs, fn, { window: 500, spread: 0.35 });
    assert.ok(bot.length > 5, 'يجب أن تظهر صفقات حتى تكون المقارنة مفيدة');
    assert.deepStrictEqual(mine.map((t) => [t.time, t.closedAt, t.side, +t.r.toFixed(10)]), bot.map((t) => [t.time, t.closedAt, t.side, +t.r.toFixed(10)]));
  }
});

test('التكاليف: الانزلاق و Swap يُنقصان النتيجة، ولا تُحسب صفقات قبل بداية الفترة', () => {
  const cs = series();
  const a = metrics(run(cs, analyze, { spread: 0.24 })).net;
  const b = metrics(run(cs, analyze, { spread: 0.24, slippage: 0.1, swapPctPerNight: 0.02 })).net;
  assert.ok(b < a);
  const late = run(cs, analyze, { from: cs[2000].time });
  assert.ok(late.every((t) => t.time >= cs[2000].time));
});

test('عدد الليالي (21:00 UTC)', () => {
  const ms = (s) => Date.parse(s + 'Z');
  assert.strictEqual(nightsHeld(ms('2024-03-04T10:00:00'), ms('2024-03-04T20:59:00')), 0);
  assert.strictEqual(nightsHeld(ms('2024-03-04T10:00:00'), ms('2024-03-05T10:00:00')), 1);
  assert.strictEqual(nightsHeld(ms('2024-03-04T22:00:00'), ms('2024-03-07T22:00:00')), 3);
});

test('حذف شموع الإغلاق، و H4 من 00:00 UTC، و H1 من M1', () => {
  const h = (t) => ({ time: t, open: 1, high: 2, low: 0.5, close: 1.5 });
  // السبت كله مغلق، والأحد 22:00 UTC (17:00 نيويورك شتاءً) مغلق، و 23:00 مفتوح
  const c = cleanH1([h('2024-01-06 12:00:00'), h('2024-01-07 22:00:00'), h('2024-01-07 23:00:00'), h('2024-01-08 10:00:00')]);
  assert.deepStrictEqual(c.map((x) => x.time), ['2024-01-07 23:00:00', '2024-01-08 10:00:00']);
  const g = group(cleanH1([h('2024-01-08 08:00:00'), h('2024-01-08 09:00:00'), h('2024-01-08 12:00:00')]), 4);
  assert.deepStrictEqual(g.map((x) => x.time), ['2024-01-08 08:00:00', '2024-01-08 12:00:00']);
  const m = h1FromM1([{ time: '2024-01-08 10:00:00', open: 1, high: 3, low: 1, close: 2 }, { time: '2024-01-08 10:59:00', open: 2, high: 2, low: 0, close: 1 }]);
  assert.deepStrictEqual([m.length, m[0].high, m[0].low, m[0].close], [1, 3, 0, 1]);
});

test('لا يغيّر أي ملف في البوت ولا يحتوي كود تداول', () => {
  const dir = path.join(__dirname, '..', 'src');
  for (const f of fs.readdirSync(dir)) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/writeFileSync\([^)]*gold-forex-signals-bot/.test(t), f);
    for (const p of [/order_send|placeOrder|createOrder|OrderSend/i, /metaapi/i, /withdraw/i]) assert.ok(!p.test(t), `${f}: ${p}`);
  }
});
