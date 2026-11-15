const test = require('node:test');
const assert = require('node:assert');
const { bullishSetups, findSetups } = require('../src/strategy');
const { simulate } = require('../src/engine');
const { aggregate, prepareM1 } = require('../src/bars');

// سيناريو شراء مبني يدوياً: اتجاه M15 صاعد، قاع M5 عند 99، Sweep إلى 98.8، كسر M1 فوق 100.8 بشمعة Displacement، FVG، ثم إعادة اختبار
function scenario(over = {}) {
  const m1 = Array.from({ length: 140 }, (_, k) => ({ open: 100, high: 100.5, low: 99.5, close: k % 2 ? 100.2 : 99.8 }));
  m1[105] = { open: 100, high: 100.5, low: 99.6, close: 100 };
  m1[106] = { open: 100, high: 101.6, low: 99.95, close: 101.5 }; // Displacement يكسر 100.8
  m1[107] = { open: 101.5, high: 102, low: 101.2, close: 101.8 }; // FVG: 100.5 → 101.2
  m1[108] = { open: 101.8, high: 102.2, low: 101.5, close: 102 };
  m1[109] = { open: 101.6, high: 101.7, low: 101.1, close: 101.4 }; // إعادة الاختبار
  for (const [k, c] of Object.entries(over.m1 ?? {})) m1[k] = { ...m1[k], ...c };
  const m5 = Array.from({ length: 28 }, (_, k) => ({ low: 99.5, close: 100, firstIdx: 5 * k, availIdx: 5 * k + 4 }));
  m5[10].low = 99;
  m5[20] = { ...m5[20], low: 98.8, close: 99.5, ...(over.sweep ?? {}) };
  const d = {
    m1,
    m5,
    atrM1: m1.map(() => 1),
    pivM1: { highs: [{ j: 95, price: 101, confirmIdx: 98 }, { j: 100, price: 100.8, confirmIdx: 103 }], lows: [] },
    pivM5: { highs: [], lows: [{ j: 10, price: 99, confirmIdx: m5[13].availIdx }] },
    pivM15: over.pivM15 ?? { highs: [{ price: 100, confirmIdx: 0 }, { price: 101, confirmIdx: 0 }], lows: [{ price: 98, confirmIdx: 0 }, { price: 98.5, confirmIdx: 0 }] },
  };
  return d;
}

test('شراء كامل: Sweep ثم CHoCH بشمعة Displacement ثم FVG ثم إعادة الاختبار', () => {
  const [s] = bullishSetups(scenario());
  assert.ok(s, 'يجب أن يظهر إعداد');
  assert.deepStrictEqual([s.fillIdx, s.entry, s.kind, s.breakIdx], [109, 101.2, 'CHoCH', 106]);
  assert.ok(Math.abs(s.stop - 98.6) < 1e-9, 'الوقف تحت قاع الـ Sweep بـ 0.2 ATR');
});

test('لا إشارة إذا لم يكن اتجاه M15 صاعداً', () => {
  const flat = { highs: [{ price: 101, confirmIdx: 0 }, { price: 100, confirmIdx: 0 }], lows: [{ price: 98, confirmIdx: 0 }, { price: 98.5, confirmIdx: 0 }] };
  assert.strictEqual(bullishSetups(scenario({ pivM15: flat })).length, 0);
});

test('لا إشارة بدون Sweep حقيقي (الإغلاق تحت المستوى)', () => {
  assert.strictEqual(bullishSetups(scenario({ sweep: { close: 98.9 } })).length, 0);
});

test('لا إشارة إذا كانت شمعة الكسر ضعيفة (ليست Displacement)', () => {
  assert.strictEqual(bullishSetups(scenario({ m1: { 106: { open: 100.7, high: 101.6, low: 99.95, close: 100.9 } } })).length, 0);
});

test('لا إشارة بدون FVG صالحة', () => {
  assert.strictEqual(bullishSetups(scenario({ m1: { 107: { low: 100.6 } } })).length, 0);
});

test('تُلغى الإشارة إذا لم يرجع السعر للـ FVG خلال 30 شمعة', () => {
  const away = {};
  for (let k = 109; k < 140; k++) away[k] = { open: 102, high: 102.5, low: 101.6, close: 102.1 };
  assert.strictEqual(bullishSetups(scenario({ m1: away })).length, 0);
});

test('قاع جديد تحت الـ Sweep قبل الكسر يُلغي الإعداد', () => {
  assert.strictEqual(bullishSetups(scenario({ m1: { 105: { low: 98.7 } } })).length, 0);
});

// --- المحرك ---
const t = (iso) => ({ time: iso.replace('T', ' ').slice(0, 19), ms: Date.parse(iso.slice(0, 19) + 'Z') });
// يوم تداول: من 08:00 UTC (03:00 نيويورك شتاءً) حتى 18:10 UTC (13:10 نيويورك)
function day(date = '2026-11-17', base = 4000) {
  return Array.from({ length: 610 }, (_, k) => ({ ...t(new Date(Date.parse(`${date}T08:00:00Z`) + k * 60000).toISOString()), open: base, high: base + 0.5, low: base - 0.5, close: base }));
}
const setup = (fillIdx, extra = {}) => ({ fillIdx, dir: 1, entry: 4000, stop: 3995, risk: 5, kind: 'BOS', ...extra });

test('المحرك: الهدف 2R بعد التكاليف، و Break Even عند 1R', () => {
  const m1 = day();
  m1[12] = { ...m1[12], high: 4010.5 };
  const [win] = simulate(m1, [setup(10)]).trades;
  assert.strictEqual(win.how, 'هدف');
  assert.ok(Math.abs(win.r - (10 - 0.34) / 5) < 1e-9);
  const m2 = day();
  m2[12] = { ...m2[12], high: 4005.5 };
  m2[13] = { ...m2[13], low: 3999 };
  const [be] = simulate(m2, [setup(10)]).trades;
  assert.strictEqual(be.how, 'تعادل');
  assert.ok(Math.abs(be.r - -0.34 / 5) < 1e-9);
});

test('المحرك: لمس الوقف في شمعة التنفيذ = خسارة، والإغلاق 13:00 نيويورك', () => {
  const m1 = day();
  m1[10] = { ...m1[10], low: 3994 };
  assert.strictEqual(simulate(m1, [setup(10)]).trades[0].how, 'وقف');
  const [late] = simulate(day(), [setup(10)]).trades;
  assert.strictEqual(late.how, 'وقت');
  assert.strictEqual(late.exitTime, '2026-11-17 17:59:00', 'آخر شمعة قبل 13:00 نيويورك (18:00 UTC شتاءً)');
});

test('المحرك: خارج الجلسات، و NFP، وحد 3 صفقات، وأصغر حجم أكبر من 1%', () => {
  const m1 = day();
  assert.strictEqual(simulate(m1, [setup(600)]).skipped['خارج الجلسات'], 1, '13:00 نيويورك خارج الجلسات');
  const nfp = day('2026-11-06');
  assert.strictEqual(simulate(nfp, [setup(60)]).trades.length, 1, '04:00 نيويورك يوم NFP: مسموح');
  const nfpAt = nfp.findIndex((c) => c.time === '2026-11-06 13:30:00');
  assert.strictEqual(simulate(nfp, [setup(nfpAt)]).skipped['أخبار NFP'], 1);
  const many = day();
  const hits = [10, 20, 30, 40].map((k) => {
    many[k + 1] = { ...many[k + 1], low: 3994 };
    return setup(k);
  });
  const r = simulate(many, hits);
  assert.strictEqual(r.trades.length, 3);
  assert.strictEqual(r.skipped['3 صفقات في اليوم'], 1);
  const usd = simulate(day(), [setup(10, { stop: 3990, risk: 10 })], { mode: 'usd' });
  assert.strictEqual(usd.skipped['أصغر حجم أكبر من 1%'], 1, '0.01 لوت × 100 أونصة × 10$ = 10$ > 5$');
});

// --- لا إعادة رسم ولا نظر للمستقبل، على بيانات عشوائية ثابتة ---
function randomRaw(days = 40) {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const out = [];
  let p = 4000;
  for (let ms = Date.parse('2026-03-02T00:00:00Z'); ms < Date.parse('2026-03-02T00:00:00Z') + days * 86400000; ms += 60000) {
    // قفزات ±3$ نادرة تصنع Sweeps وشموع Displacement حتى تظهر إعدادات حقيقية في الاختبار
    const n = p + rnd() * 1.2 + Math.sin(ms / 4e6) * 0.015 + (rnd() > 0.497 ? (rnd() > 0 ? 3 : -3) : 0);
    out.push({ time: new Date(ms).toISOString().slice(0, 19).replace('T', ' '), open: p, high: Math.max(p, n) + Math.abs(rnd()) * 0.6, low: Math.min(p, n) - Math.abs(rnd()) * 0.6, close: n });
    p = n;
  }
  return out;
}

test('لا إعادة رسم: قطع البيانات عند أي وقت لا يغيّر الصفقات المنتهية قبله', () => {
  const raw = randomRaw();
  const full = findSetups(raw);
  const fullTrades = simulate(full.m1, full.setups).trades;
  assert.ok(full.setups.length > 0, 'يجب أن تظهر إعدادات في البيانات العشوائية حتى يكون الاختبار مفيداً');
  for (const frac of [0.3, 0.5, 0.7, 0.9]) {
    const cut = raw[Math.floor(raw.length * frac)].time;
    const part = findSetups(raw.filter((c) => c.time <= cut));
    const partTrades = simulate(part.m1, part.setups).trades.filter((x) => x.exitTime < cut && x.how !== 'وقت');
    const expected = fullTrades.filter((x) => x.exitTime < cut && x.how !== 'وقت');
    assert.deepStrictEqual(partTrades.map((x) => JSON.stringify(x)), expected.map((x) => JSON.stringify(x)), `القطع عند ${cut}`);
  }
});

test('البيع عكس الشراء تماماً: قلب الأسعار يقلب الإشارات', () => {
  const raw = randomRaw(10);
  const a = findSetups(raw).setups;
  const mirrored = raw.map((c) => ({ time: c.time, open: 8000 - c.open, high: 8000 - c.low, low: 8000 - c.high, close: 8000 - c.close }));
  const b = findSetups(mirrored).setups;
  assert.strictEqual(a.length, b.length);
  assert.deepStrictEqual(a.map((s) => s.dir).sort(), b.map((s) => -s.dir).sort());
});

test('الشمعة الأعلى لا تُستعمل قبل إغلاقها', () => {
  const m1 = prepareM1(randomRaw(1));
  const m5 = aggregate(m1, 5);
  for (const b of m5.slice(0, -1)) assert.ok(m1[b.availIdx].ms + 60000 >= b.ms + 5 * 60000);
});
