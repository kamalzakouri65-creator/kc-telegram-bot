// الاختبارات العشرون لـ GOLD ASIAN RANGE BREAKOUT V1 (حسب البند 10 في SPEC)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { config } = require('../src/config');
const time = require('../src/time');
const { londonDays, trendFor, asianRange, signals } = require('../src/strategy');
const { execute, runTrades, rOf } = require('../src/execution');
const { metrics, splitBounds, splitOf, verdict } = require('../src/stats');
const { runAll } = require('../src/run');
const data = require('../src/data');
const { U, M15, scenario, RULE, ZERO } = require('./_helpers');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const sig1 = (bars, rule = RULE) => signals(bars, rule);
const BREAK_UP = [1995, 2003, 1995, 2002]; // إغلاق فوق 2000
const BREAK_DN = [1995, 1995, 1987, 1988]; // إغلاق تحت 1990

test('01 توقيت لندن صيفاً وشتاءً (مقارنة مع Intl)، ويوم لندن عبر منتصف الليل', () => {
  assert.strictEqual(time.londonOffset(U('2026-03-29T00:59:00')), 0);
  assert.strictEqual(time.londonOffset(U('2026-03-29T01:00:00')), 1);
  assert.strictEqual(time.londonOffset(U('2026-10-25T00:59:00')), 1);
  assert.strictEqual(time.londonOffset(U('2026-10-25T01:00:00')), 0);
  // صيفاً: 23:30 UTC = 00:30 لندن من اليوم التالي
  assert.strictEqual(time.londonDay(U('2026-07-14T23:30:00')), '2026-07-15');
  assert.strictEqual(time.londonDay(U('2026-01-14T23:30:00')), '2026-01-14');
  near(time.londonHour(U('2026-07-14T07:15:00')), 8.25);
  let ok = true;
  try {
    ok = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23' }).format(new Date(U('2026-07-01T12:00:00'))) === '13';
  } catch {
    ok = false;
  }
  if (ok)
    for (const d of ['2020-03-29', '2020-10-25', '2022-03-27', '2022-10-30', '2024-03-31', '2024-10-27', '2026-03-29', '2026-10-25'])
      for (let ms = U(`${d}T00:00:00`) - 86400000; ms <= U(`${d}T00:00:00`) + 86400000; ms += 1800000) {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
        assert.strictEqual(time.londonOffset(ms), Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ms) / 3600000), new Date(ms).toISOString());
      }
});

test('02 ساعات إغلاق السوق حسب توقيت نيويورك', () => {
  assert.ok(time.marketClosed(U('2026-01-16T22:00:00'))); // الجمعة 17:00 نيويورك
  assert.ok(!time.marketClosed(U('2026-01-16T21:45:00')));
  assert.ok(time.marketClosed(U('2026-01-17T12:00:00'))); // السبت
  assert.ok(time.marketClosed(U('2026-01-18T22:45:00'))); // الأحد 17:45 نيويورك
  assert.ok(!time.marketClosed(U('2026-01-18T23:00:00'))); // الأحد 18:00 نيويورك
  assert.ok(time.marketClosed(U('2026-01-14T22:30:00'))); // الاستراحة اليومية
  assert.ok(time.marketClosed(U('2026-07-14T21:30:00'))); // الاستراحة صيفاً (UTC−4)
  assert.ok(!time.marketClosed(U('2026-07-14T22:00:00')));
});

test('03 نطاق آسيا: [00:00، 08:00) فقط، وأقل من 16 شمعة = إلغاء', () => {
  const bars = scenario({ bars: { '08:00': [1995, 2050, 1900, 1995] } }); // شمعة 08:00 الكبيرة لا تدخل في النطاق
  const days = londonDays(bars);
  const r = asianRange(bars, days.at(-1), RULE);
  assert.deepStrictEqual([r.high, r.low, r.size, r.bars], [2000, 1990, 10, 32]);
  const few = scenario({ asianCount: 15 });
  assert.strictEqual(asianRange(few, londonDays(few).at(-1), RULE), null);
  const enough = scenario({ asianCount: 16 });
  assert.ok(asianRange(enough, londonDays(enough).at(-1), RULE));
  // صيفاً: 00:00 لندن = 23:00 UTC من اليوم السابق
  const summer = scenario({ date: '2026-07-15', utcOffset: 1 });
  const rs = asianRange(summer, londonDays(summer).at(-1), RULE);
  assert.strictEqual(rs.bars, 32);
});

test('04 حد النطاق: 2.99 و 25.01 مرفوضان، و 3.00 و 25.00 مقبولان', () => {
  const run = (lo, hi) => sig1(scenario({ asian: [lo, hi], bars: { '08:00': [hi - 0.5, hi + 2, hi - 0.6, hi + 1] } })).log;
  assert.strictEqual(run(1990, 1992.99).tooSmall, 1);
  assert.strictEqual(run(1990, 1993).signals, 1);
  assert.strictEqual(run(1990, 2015).signals, 1);
  assert.strictEqual(run(1990, 2015.01).tooBig, 1);
});

test('05 SMA20: حتى اليوم السابق فقط، والمساواة = لا صفقة', () => {
  const up = scenario({ trend: 1 });
  const days = londonDays(up);
  assert.strictEqual(trendFor(days, up, days.length - 1, 20), 1);
  assert.strictEqual(trendFor(scenario({ trend: -1 }), null, 0, 20), null); // قبل توفر 20 يوماً
  // تغيير أسعار اليوم نفسه لا يغيّر الاتجاه
  const crash = scenario({ trend: 1, bars: { '09:00': [1995, 1995, 1000, 1000] } });
  const dc = londonDays(crash);
  assert.strictEqual(trendFor(dc, crash, dc.length - 1, 20), 1);
  // المساواة: كل الإغلاقات متساوية
  const flat = scenario({ trend: 0 });
  const df = londonDays(flat);
  assert.strictEqual(trendFor(df, flat, df.length - 1, 20), 0);
  assert.strictEqual(sig1(scenario({ trend: 0, bars: { '08:00': BREAK_UP } })).signals.length, 0);
});

test('06 نافذة الاختراق: 07:45 و 12:00 خارجها، و 08:00 و 11:45 داخلها', () => {
  // اختراق قبل 08:00: نجعل شمعة 07:45 تُغلق فوق النطاق (يرفع أعلى النطاق، فلا اختراق لاحقاً بنفس السعر)
  assert.strictEqual(sig1(scenario({ bars: { '08:00': BREAK_UP } })).signals.length, 1);
  assert.strictEqual(sig1(scenario({ bars: { '11:45': BREAK_UP } })).signals.length, 1);
  assert.strictEqual(sig1(scenario({ bars: { '12:00': BREAK_UP } })).signals.length, 0);
  const s = sig1(scenario({ bars: { '11:45': BREAK_UP } })).signals[0];
  near(time.londonHour(scenario({ bars: { '11:45': BREAK_UP } }).t[s.i]), 11.75);
});

test('07 ✍️ الاختراق المخالف يُتجاهل، والمتوافق اللاحق يُؤخذ', () => {
  const r = sig1(scenario({ trend: 1, bars: { '08:30': BREAK_DN, '09:00': [1988, 1995, 1988, 1995], '10:15': BREAK_UP } }));
  assert.strictEqual(r.signals.length, 1);
  assert.strictEqual(r.signals[0].side, 1);
  assert.strictEqual(r.log.counterIgnored, 1);
  // المخالف وحده: لا صفقة
  const only = sig1(scenario({ trend: 1, bars: { '08:30': BREAK_DN } }));
  assert.strictEqual(only.signals.length, 0);
  assert.strictEqual(only.log.noBreak, 1);
  // البيع في اتجاه هابط
  const dn = sig1(scenario({ trend: -1, bars: { '08:30': BREAK_UP, '09:00': BREAK_DN } }));
  assert.strictEqual(dn.signals[0].side, -1);
});

test('08 صفقة واحدة في اليوم: اختراق متوافق ثانٍ لا يُؤخذ', () => {
  const r = sig1(scenario({ bars: { '08:15': BREAK_UP, '08:30': [2002, 2002, 1995, 1996], '09:00': BREAK_UP } }));
  assert.strictEqual(r.signals.length, 1);
  const bars = scenario({ bars: { '08:15': BREAK_UP } });
  assert.strictEqual(time.londonHour(bars.t[r.signals[0].i]), 8.25);
});

test('09 الدخول بافتتاح الشمعة التالية، والتخطي إذا افتتحت خلف الوقف', () => {
  const bars = scenario({ bars: { '08:15': BREAK_UP, '08:30': [2002.5, 2003, 2001, 2002] } });
  const s = sig1(bars).signals[0];
  const t = execute(bars, s, RULE, ZERO);
  assert.strictEqual(t.entryTime, bars.t[s.i] + M15);
  assert.strictEqual(t.entry, 2002.5);
  // الشمعة التالية تفتتح تحت الوقف (1995)
  const gap = scenario({ bars: { '08:15': BREAK_UP, '08:30': [1994, 1996, 1993, 1995] } });
  assert.deepStrictEqual(execute(gap, sig1(gap).signals[0], RULE, ZERO), { skip: 'beyondStop' });
  // الشمعة التالية ليست مباشرة (فجوة في البيانات)
  const cut = scenario({ bars: { '08:15': BREAK_UP } });
  const s2 = sig1(cut).signals[0];
  for (const k of ['t', 'o', 'h', 'l', 'c']) cut[k].splice(s2.i + 1, 1);
  assert.deepStrictEqual(execute(cut, s2, RULE, ZERO), { skip: 'gap' });
});

test('10 الوقف لنسب 0.25 و 0.5 و 1، للشراء والبيع', () => {
  const up = scenario({ bars: { '08:15': BREAK_UP } });
  const dn = scenario({ trend: -1, bars: { '08:15': BREAK_DN } });
  for (const [f, buy, sell] of [[0.25, 1997.5, 1992.5], [0.5, 1995, 1995], [1, 1990, 2000]]) {
    near(sig1(up, { ...RULE, stopFrac: f }).signals[0].stop, buy);
    near(sig1(dn, { ...RULE, stopFrac: f }).signals[0].stop, sell);
  }
});

test('11 الهدف 1 و 1.5 و 2 × المخاطرة الفعلية', () => {
  const bars = scenario({ bars: { '08:15': BREAK_UP, '08:30': [2001, 2001, 2001, 2001] } });
  const s = sig1(bars).signals[0];
  for (const rr of [1, 1.5, 2]) {
    const t = execute(bars, s, { ...RULE, rr }, ZERO);
    near(t.dist, 6);
    near(t.tp, 2001 + rr * 6);
  }
  const dn = scenario({ trend: -1, bars: { '08:15': BREAK_DN, '08:30': [1989, 1989, 1989, 1989] } });
  near(execute(dn, sig1(dn).signals[0], RULE, ZERO).tp, 1989 - 1.5 * 6);
});

test('12 الوقف أولاً عند لمس الوقف والهدف في نفس الشمعة', () => {
  const bars = scenario({ bars: { '08:15': BREAK_UP, '08:30': [2001, 2001.5, 2000.5, 2001], '08:45': [2001, 2020, 1990, 2001] } });
  const t = execute(bars, sig1(bars).signals[0], RULE, ZERO);
  assert.deepStrictEqual([t.how, t.exit], ['stop', 1995]);
  near(t.r, -1);
  const win = scenario({ bars: { '08:15': BREAK_UP, '08:30': [2001, 2001.5, 2000.5, 2001], '08:45': [2001, 2020, 1999, 2010] } });
  const w = execute(win, sig1(win).signals[0], RULE, ZERO);
  assert.deepStrictEqual([w.how, w.exit], ['target', 2010]);
  near(w.r, 1.5);
});

test('13 الفجوة خلف الوقف تُغلق بسعر الافتتاح', () => {
  const bars = scenario({ bars: { '08:15': BREAK_UP, '08:30': [2001, 2001.5, 2000.5, 2001], '08:45': [1992, 1993, 1991, 1992] } });
  const t = execute(bars, sig1(bars).signals[0], RULE, ZERO);
  assert.deepStrictEqual([t.how, t.exit], ['stop', 1992]);
  near(t.r, -1.5);
});

test('14 الخروج بالوقت عند آخر شمعة قبل 16:00 لندن، صيفاً وشتاءً', () => {
  for (const [date, off] of [['2026-01-14', 0], ['2026-07-15', 1]]) {
    const bars = scenario({ date, utcOffset: off, fill: 2001, bars: { '08:15': BREAK_UP, '08:30': [2001, 2001.5, 2000.5, 2001], '15:45': [2001, 2002, 2000, 2003.4] } });
    const t = execute(bars, sig1(bars).signals[0], RULE, ZERO);
    assert.strictEqual(t.how, 'time');
    near(time.londonHour(t.exitTime), 15.75);
    assert.strictEqual(t.exit, 2003.4);
    near(t.r, 0.4);
  }
});

test('15 Bid/Ask: الشراء على Ask والخروج على Bid، والبيع عكسه', () => {
  const c = { spread: 0.52, slippage: 0 };
  const bars = scenario({ fill: 2001, bars: { '08:15': BREAK_UP } });
  const t = execute(bars, sig1(bars).signals[0], RULE, c);
  near(t.entry, 2001.26);
  near(t.dist, 6.26);
  near(t.exit, 2001 - 0.26); // الخروج بالوقت على Bid
  // الوقف يُفعَّل عندما Bid = Mid − 0.26 ≤ 1995
  const hit = scenario({ fill: 2001, bars: { '08:15': BREAK_UP, '08:30': [2001, 2001, 1995.26, 2001] } });
  assert.strictEqual(execute(hit, sig1(hit).signals[0], RULE, c).how, 'stop');
  const miss = scenario({ fill: 2001, bars: { '08:15': BREAK_UP, '08:30': [2001, 2001, 1995.27, 2001] } });
  assert.strictEqual(execute(miss, sig1(miss).signals[0], RULE, c).how, 'time');
  const dn = scenario({ trend: -1, fill: 1989, bars: { '08:15': BREAK_DN } });
  const s = execute(dn, sig1(dn).signals[0], RULE, c);
  near(s.entry, 1988.74);
  near(s.exit, 1989.26);
});

test('16 التكلفة مرة واحدة، ومعادلة R للشراء والبيع منفصلة', () => {
  near(rOf(1, 100, 106, 4, 0.1), (6 - 0.1) / 4);
  near(rOf(-1, 100, 94, 4, 0.1), (6 - 0.1) / 4);
  near(rOf(-1, 100, 104, 4, 0.1), (-4 - 0.1) / 4);
  // صفقة كاملة: الوقف بسبريد 0.52 وانزلاق 0.10 = −1 − 0.10 ÷ المسافة (السبريد داخل المسافة)
  const c = { spread: 0.52, slippage: 0.1 };
  const bars = scenario({ bars: { '08:15': BREAK_UP, '08:30': [2001, 2001, 2001, 2001], '08:45': [2001, 2001, 1990, 1990] } });
  const t = execute(bars, sig1(bars).signals[0], RULE, c);
  near(t.r, -1 - 0.1 / 6.26);
  near(t.costPct, (0.62 / 6.26) * 100);
});

test('17 ضعف السبريد: أسوأ أو مساوٍ عند الوقف والوقت، والهدف أبعد (يحتاج حركة أكبر)', () => {
  const dollars = (t) => t.side * (t.exit - t.entry) - 0.1; // بالدولار للأونصة بعد التكاليف
  // الخروج بالوقف وبالوقت: النتيجة بالدولار للأونصة أقل أو مساوية
  for (const b of [{ '08:15': BREAK_UP, '08:45': [2001, 2001, 1990, 1990] }, { '08:15': BREAK_UP }]) {
    const bars = scenario({ fill: 2001, bars: b });
    const s = sig1(bars).signals[0];
    const a = execute(bars, s, RULE, config.costs.base);
    const d = execute(bars, s, RULE, config.costs.doubled);
    assert.strictEqual(a.how, d.how);
    assert.ok(dollars(d) <= dollars(a) + 1e-9, `${dollars(d)} > ${dollars(a)}`);
  }
  // الهدف: بضعف السبريد الدخول أسوأ والمسافة أكبر، فالهدف أبعد. شمعة تصل هدف الأساسي فقط لا تصل هدف الضعف.
  const probe = scenario({ fill: 2001, bars: { '08:15': BREAK_UP } });
  const s = sig1(probe).signals[0];
  const a = execute(probe, s, RULE, config.costs.base);
  const d = execute(probe, s, RULE, config.costs.doubled);
  assert.ok(d.tp > a.tp);
  const reachBaseOnly = a.tp + config.costs.base.spread / 2 + 0.01; // Bid يصل هدف الأساسي فقط
  assert.ok(reachBaseOnly - config.costs.doubled.spread / 2 < d.tp);
  const bars = scenario({ fill: 2001, bars: { '08:15': BREAK_UP, '08:45': [2001, reachBaseOnly, 2000.5, 2001] } });
  assert.strictEqual(execute(bars, s, RULE, config.costs.base).how, 'target');
  assert.notStrictEqual(execute(bars, s, RULE, config.costs.doubled).how, 'target');
});

test('18 الإحصائيات على مثال معروف، والتقسيم 60/20/20', () => {
  const tr = [1.5, -1, -1, 1.5, -1, 0.5].map((r) => ({ r, pnl: r * 5, equityBefore: 1000, equityAfter: 1000 }));
  const m = metrics(tr);
  assert.deepStrictEqual([m.n, m.wins, m.losses, m.worst], [6, 3, 3, 2]);
  near(m.pf, 3.5 / 3);
  near(m.net, 0.5);
  near(m.exp, 0.5 / 6);
  near(m.maxDd, 2);
  near(m.avgWin, 3.5 / 3);
  near(m.avgLoss, -1);
  const b = splitBounds(0, 100, config.split);
  assert.deepStrictEqual([b.devEnd, b.valEnd], [60, 80]);
  assert.deepStrictEqual([splitOf(59.9, b), splitOf(60, b), splitOf(80, b)], ['dev', 'val', 'holdout']);
  // 0.5% من الرصيد الحالي: +1.5R ثم −1R
  const bars = scenario({ bars: { '08:15': BREAK_UP, '08:30': [2001, 2001, 2001, 2001], '08:45': [2001, 2020, 2000, 2015] } });
  const res = runTrades(bars, sig1(bars).signals, RULE, ZERO, config.risk);
  near(res.equity, 1007.5);
});

test('19 الحكم: PASS و FAIL و INSUFFICIENT DATA', () => {
  const C = config.criteria;
  const good = { total: { pf: 1.4, exp: 0.1 }, holdout: { net: 3, n: 40 }, last6: { net: -2 }, doubled: { net: 1 }, positiveCombos: 7 };
  assert.strictEqual(verdict(good, C).verdict, 'PASS');
  assert.strictEqual(verdict({ ...good, holdout: { net: 3, n: 29 } }, C).verdict, 'INSUFFICIENT DATA');
  // فشل شرط أداء مع Holdout قليل = FAIL (بيانات أكثر لا تصلح فشلاً قائماً)
  const f = verdict({ ...good, total: { pf: 1.29, exp: 0.1 }, holdout: { net: 3, n: 10 } }, C);
  assert.strictEqual(f.verdict, 'FAIL');
  assert.strictEqual(f.reasons.length, 2);
  assert.strictEqual(verdict({ ...good, last6: { net: -5.1 } }, C).verdict, 'FAIL');
  assert.strictEqual(verdict({ ...good, last6: { net: -5 } }, C).verdict, 'PASS');
  assert.strictEqual(verdict({ ...good, doubled: { net: 0 } }, C).verdict, 'FAIL');
  assert.strictEqual(verdict({ ...good, positiveCombos: 6 }, C).verdict, 'FAIL');
  assert.strictEqual(verdict({ ...good, holdout: { net: 0, n: 40 } }, C).verdict, 'FAIL');
});

// بيانات M15 عشوائية ثابتة في ساعات السوق
function randomBars(days = 400) {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  const out = { t: [], o: [], h: [], l: [], c: [] };
  let p = 1800;
  const start = U('2021-01-04T00:00:00');
  for (let ms = start; ms < start + days * 86400000; ms += M15) {
    if (time.marketClosed(ms)) continue;
    const n = Math.round((p + rnd() * 3) * 100) / 100;
    out.t.push(ms);
    out.o.push(p);
    out.h.push(Math.round((Math.max(p, n) + Math.abs(rnd()) * 1.5) * 100) / 100);
    out.l.push(Math.round((Math.min(p, n) - Math.abs(rnd()) * 1.5) * 100) / 100);
    out.c.push(n);
    p = n;
  }
  return out;
}

test('20 بدون نظر للمستقبل، والتناظر، ولا كود تداول، والملف الأصلي لا يُكتب فيه', () => {
  const bars = randomBars();
  const run = (b) => runTrades(b, signals(b, RULE).signals, RULE, config.costs.base, config.risk).trades;
  const full = run(bars);
  assert.ok(full.length >= 30, `صفقات قليلة: ${full.length}`);
  // القطع: الصفقات المنتهية قبل القطع لا تتغير
  const cutAt = Math.floor(bars.t.length * 0.6);
  const part = Object.fromEntries(Object.entries(bars).map(([k, v]) => [k, v.slice(0, cutAt)]));
  const last = part.t[part.t.length - 1];
  const key = (t) => [t.entryTime, t.exitTime, t.side, t.how, t.r.toFixed(9)].join('|');
  const a = full.filter((t) => t.exitTime < last).map(key);
  assert.ok(a.length >= 10);
  assert.deepStrictEqual(run(part).filter((t) => t.exitTime < last && t.how !== 'end').map(key), a);
  // التناظر: K − السعر يعطي نفس الصفقات بالاتجاه المعاكس ونفس R
  const K = 4000;
  const mir = { t: bars.t, o: bars.o.map((x) => K - x), h: bars.l.map((x) => K - x), l: bars.h.map((x) => K - x), c: bars.c.map((x) => K - x) };
  const mt = run(mir);
  assert.strictEqual(mt.length, full.length);
  mt.forEach((t, i) => {
    assert.deepStrictEqual([t.entryTime, t.exitTime, t.side, t.how], [full[i].entryTime, full[i].exitTime, -full[i].side, full[i].how]);
    near(t.r, full[i].r, 1e-6);
  });
  // التشغيل الكامل يعمل على البيانات العشوائية
  const R = runAll(bars, config);
  assert.strictEqual(R.combos.length, 9);
  assert.ok(['PASS', 'FAIL', 'INSUFFICIENT DATA'].includes(R.v.verdict));
  // لا كود تداول ولا اتصال بوسيط ولا Telegram، ولا كتابة في ملف المصدر
  const dir = path.join(__dirname, '..', 'src');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const p of [/order_send|placeOrder|createOrder|OrderSend/i, /metaapi|metatrader|ccxt|node-telegram-bot-api|api\.telegram\.org|sendMessage/i, /withdraw/i, /fetch\(|https?:\/\//i]) assert.ok(!p.test(src), `${f}: ${p}`);
    assert.ok(!/(writeFileSync|renameSync|unlinkSync|appendFileSync)\([^)]*source/i.test(src), f);
  }
  // القراءة لا تغيّر الملف
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asian-'));
  const f = path.join(tmp, 'xau-m15.json');
  fs.writeFileSync(f, JSON.stringify([{ time: '2026-01-14 10:15:00', open: 1, high: 2, low: 0.5, close: 1.5 }, { time: '2026-01-14 10:00:00', open: 1, high: 2, low: 0.5, close: 1.2 }, { time: '2026-01-14 10:00:00', open: 9, high: 9, low: 9, close: 9 }]));
  const before = fs.readFileSync(f);
  const s = data.loadSource(f);
  assert.ok(fs.readFileSync(f).equals(before));
  assert.deepStrictEqual([s.raw, s.duplicates, s.unsorted, s.bars.t.length, s.bars.c[0]], [3, 1, 1, 2, 1.2]);
  fs.rmSync(tmp, { recursive: true, force: true });
});
