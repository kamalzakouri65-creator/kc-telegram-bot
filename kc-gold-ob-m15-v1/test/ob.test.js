// الاختبارات العشرون لـ GOLD ORDER BLOCK M15 V1 (بيانات صغيرة مصنوعة يدوياً، والنتيجة المتوقعة معروفة مسبقاً)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { config } = require('../src/config');
const time = require('../src/time');
const { aggregate, closeTime } = require('../src/bars');
const { atr, ema, isPivotHigh, isPivotLow } = require('../src/indicators');
const { bullEngulf, bearEngulf, bullPin, bearPin } = require('../src/patterns');
const { createStrategy, findBullOb } = require('../src/strategy');
const { entryPlan, passesCostFilter, simulate, closeTrade, pnlUsd } = require('../src/execution');
const { backtest, trendFn } = require('../src/backtest');
const { createGate } = require('../src/gate');
const { metrics, splitBounds, splitOf, verdict } = require('../src/stats');
const H = require('./_helpers');

const U = (s) => Date.parse(s + 'Z');
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const strat = (rows, { atrV = 2, trend = 1, rules = H.RULES } = {}) => {
  const bars = H.m15Of(rows);
  const s = createStrategy(bars, { atr: H.constAtr(rows.length, atrV), trendAt: () => trend, rules });
  const all = [];
  for (let i = 0; i < rows.length; i++) all.push(...s.step(i));
  return { s, all, bars };
};

test('01 التوقيت الصيفي: لندن ونيويورك، ومنها الأسابيع التي يختلف فيها التوقيتان', () => {
  // 2026: نيويورك صيفي من 8 مارس 07:00 UTC حتى 1 نوفمبر 06:00 UTC، ولندن من 29 مارس 01:00 UTC حتى 25 أكتوبر 01:00 UTC
  assert.strictEqual(time.nyOffset(U('2026-03-08T06:59:00')), -5);
  assert.strictEqual(time.nyOffset(U('2026-03-08T07:00:00')), -4);
  assert.strictEqual(time.londonOffset(U('2026-03-29T00:59:00')), 0);
  assert.strictEqual(time.londonOffset(U('2026-03-29T01:00:00')), 1);
  assert.strictEqual(time.londonOffset(U('2026-10-25T00:59:00')), 1);
  assert.strictEqual(time.londonOffset(U('2026-10-25T01:00:00')), 0);
  assert.strictEqual(time.nyOffset(U('2026-11-01T05:59:00')), -4);
  assert.strictEqual(time.nyOffset(U('2026-11-01T06:00:00')), -5);
  // أسبوع الاختلاف (مارس): لندن +0 ونيويورك −4، فالفرق 4 ساعات بدل 5
  const m = U('2026-03-16T12:00:00');
  assert.deepStrictEqual([time.londonOffset(m), time.nyOffset(m)], [0, -4]);
  // أسبوع الاختلاف (أكتوبر/نوفمبر): لندن +0 ونيويورك −4
  const o = U('2026-10-28T12:00:00');
  assert.deepStrictEqual([time.londonOffset(o), time.nyOffset(o)], [0, -4]);
  // مقارنة مع قاعدة بيانات المناطق الزمنية (Intl) كل 30 دقيقة حول كل تغيير من 2024 إلى 2026
  let intlOk = true;
  try {
    intlOk = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23' }).format(new Date(U('2026-07-01T12:00:00'))) === '13';
  } catch {
    intlOk = false;
  }
  if (intlOk) {
    const offset = (tz, ms) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
      return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ms) / 3600000);
    };
    const edges = ['2024-03-10', '2024-03-31', '2024-10-27', '2024-11-03', '2025-03-09', '2025-03-30', '2025-10-26', '2025-11-02', '2026-03-08', '2026-03-29', '2026-10-25', '2026-11-01'];
    for (const d of edges)
      for (let ms = U(`${d}T00:00:00`) - 86400000; ms <= U(`${d}T00:00:00`) + 2 * 86400000; ms += 1800000) {
        assert.strictEqual(time.londonOffset(ms), offset('Europe/London', ms), `London ${new Date(ms).toISOString()}`);
        assert.strictEqual(time.nyOffset(ms), offset('America/New_York', ms), `NY ${new Date(ms).toISOString()}`);
      }
  }
});

test('02 الجلسات: لا دخول خارج الأوقات، والتداخل يُصنّف صحيحاً', () => {
  const S = H.RULES.sessions;
  // يناير: لندن = UTC، نيويورك = UTC−5
  assert.strictEqual(time.session(U('2026-01-13T07:59:00'), S), null); // 07:59 لندن
  assert.strictEqual(time.session(U('2026-01-13T08:00:00'), S), 'london');
  assert.strictEqual(time.session(U('2026-01-13T12:59:00'), S), 'london');
  assert.strictEqual(time.session(U('2026-01-13T13:00:00'), S), 'overlap'); // 13:00 لندن = 08:00 نيويورك
  assert.strictEqual(time.session(U('2026-01-13T16:00:00'), S), 'ny'); // 16:00 لندن انتهت، 11:00 نيويورك
  assert.strictEqual(time.session(U('2026-01-13T20:59:00'), S), 'ny'); // 15:59 نيويورك
  assert.strictEqual(time.session(U('2026-01-13T21:00:00'), S), null); // 16:00 نيويورك
  // أسبوع الاختلاف في مارس: نيويورك 08:00 = 12:00 UTC، ولندن 08:00 = 08:00 UTC
  assert.strictEqual(time.session(U('2026-03-16T11:59:00'), S), 'london');
  assert.strictEqual(time.session(U('2026-03-16T12:00:00'), S), 'overlap');
  // الصيف: لندن 08:00 = 07:00 UTC
  assert.strictEqual(time.session(U('2026-07-14T06:59:00'), S), null);
  assert.strictEqual(time.session(U('2026-07-14T07:00:00'), S), 'london');
});

test('03 بناء M15 و H1 من M1: الشمعة لا تُستعمل قبل إغلاق آخر دقيقة فيها', () => {
  const start = U('2026-01-13T10:00:00');
  const rows = [];
  for (let k = 0; k < 16; k++) rows.push([100 + k, 100.5 + k, 99.5 + k, 100.2 + k]);
  rows[7] = [107, 120, 90, 107.2]; // أعلى وأدنى داخل الشمعة
  const m15 = aggregate(H.m1Of(rows, start), 15);
  assert.strictEqual(m15.t.length, 2);
  assert.deepStrictEqual([m15.o[0], m15.h[0], m15.l[0], m15.c[0]], [100, 120, 90, 114.2]);
  assert.strictEqual(closeTime(m15, 0), U('2026-01-13T10:15:00'));
  assert.deepStrictEqual([m15.first[0], m15.last[0], m15.first[1]], [0, 14, 15]);
  // حتى 10:14 فقط: نفس قيم الشمعة لأن آخر دقيقة فيها هي 10:14، ولا تُستعمل قبل 10:15
  const part = aggregate(H.m1Of(rows.slice(0, 15), start), 15);
  assert.deepStrictEqual([part.o[0], part.h[0], part.l[0], part.c[0]], [100, 120, 90, 114.2]);
  const h1 = aggregate(H.m1Of(rows, start), 60);
  assert.strictEqual(h1.t.length, 1);
  assert.strictEqual(closeTime(h1, 0), U('2026-01-13T11:00:00'));
  assert.strictEqual(h1.c[0], 115.2);
});

test('04 القمم والقيعان: لا تُعرف قبل إغلاق الشمعتين بعدها', () => {
  const rows = H.bullScenario();
  const bars = H.m15Of(rows);
  assert.ok(isPivotHigh(bars, 2, 2));
  assert.ok(isPivotLow(bars, 6, 2));
  assert.ok(!isPivotHigh(bars, 3, 2));
  const s = createStrategy(bars, { atr: H.constAtr(rows.length, 2), trendAt: () => 1, rules: H.RULES });
  for (let i = 0; i <= 3; i++) s.step(i);
  assert.strictEqual(s.state().lastHigh, null, 'عند j+1 القمة غير معروفة');
  s.step(4);
  assert.deepStrictEqual(s.state().lastHigh, { idx: 2, price: 105, broken: false }, 'عند j+2 القمة معروفة');
  // قمة بتساوي (ليست أعلى بشكل صارم) ليست قمة
  const eq = H.m15Of([[1, 2, 0, 1], [1, 3, 0, 1], [1, 5, 0, 1], [1, 5, 0, 1], [1, 2, 0, 1], [1, 1, 0, 1]]);
  assert.ok(!isPivotHigh(eq, 2, 2) && !isPivotHigh(eq, 3, 2));
});

test('05 BOS: يستعمل فقط قمماً مؤكدة قبل شمعة الكسر', () => {
  // إغلاق فوق القمة عند الشمعة 4 قبل تأكيدها (تأكيدها عند 4 نفسها لا يكفي): ليس كسراً
  const early = [
    [100, 101, 99, 100.5],
    [100.5, 102, 100, 101.5],
    [101.5, 105, 101, 104],
    [104, 104.5, 102, 103],
    [103, 104.9, 101, 104.8], // لا تتجاوز القمة
  ];
  const a = strat(early);
  assert.strictEqual(a.s.log.bos, 0);
  // السيناريو الكامل: الكسر عند 8 لقمة مؤكدة عند 4
  const b = strat(H.bullScenario());
  assert.ok(b.s.log.bos >= 1);
  assert.strictEqual(b.s.log.obs, 1);
  // إغلاق فوق قمة غير مؤكدة بعد: القمة عند 2 والإغلاق فوقها عند 3 (قبل التأكيد عند 4) لا يُحسب
  const notYet = strat([
    [100, 101, 99, 100.5],
    [100.5, 102, 100, 101.5],
    [101.5, 105, 101, 101.6],
    [101.6, 104, 101, 103], // ليست فوق 105
    [103, 104.5, 102, 104], // تأكيد القمة 105
    [104, 104.6, 103, 104.2],
    [104.2, 108, 104, 107.5], // كسر حقيقي
  ]);
  assert.strictEqual(notYet.s.log.bos, 1);
  assert.strictEqual(notYet.s.state().lastHigh.broken, true);
});

test('06 Displacement: جسم 0.99 ATR مرفوض و 1.00 ATR مقبول', () => {
  const rows = H.bullScenario(); // جسم شمعة الكسر 5.6
  const rej = strat(rows, { atrV: 5.6 / 0.99 });
  assert.strictEqual(rej.s.log.obs, 0);
  assert.strictEqual(rej.s.log.bosNoDisplacement, 1);
  const ok = strat(rows, { atrV: 5.6 });
  assert.strictEqual(ok.s.log.obs, 1);
  // ATR من شموع مغلقة: Wilder يعتمد فقط على الشموع 0..i
  const bars = H.m15Of(rows);
  const full = atr(bars, 3);
  const cut = atr(H.m15Of(rows.slice(0, 6)), 3);
  for (let i = 0; i < 6; i++) near(full[i] || 0, cut[i] || 0);
  assert.ok(Number.isNaN(full[1]) && Number.isFinite(full[2]));
});

test('07 OB: آخر شمعة عكسية داخل الحركة التي صنعت الكسر، والمنطقة كامل الشمعة', () => {
  const rows = H.bullScenario();
  const bars = H.m15Of(rows);
  // الهابطة 3 و 4 و 5 و 7، والحركة تبدأ من أدنى سعر (6): يُختار 7
  assert.strictEqual(findBullOb(bars, 2, 8), 7);
  const { s } = strat(rows.slice(0, 9));
  const ob = s.state().obs[0];
  assert.deepStrictEqual([ob.k, ob.lo, ob.hi], [7, 100.2, 101.5]);
  // إذا لم توجد شمعة هابطة بين أدنى سعر والكسر: لا OB، ولا بحث في الهابطة القديمة 3 و 4 و 5
  const none = H.m15Of(H.bullScenario({ ob7Bull: true }));
  assert.strictEqual(findBullOb(none, 2, 8), -1);
  const n = strat(H.bullScenario({ ob7Bull: true }));
  assert.strictEqual(n.s.log.obs, 0);
  assert.strictEqual(n.s.log.bosNoOb, 1);
});

test('08 فلتر EMA 200: آخر H1 مغلقة، شراء فوق فقط وبيع تحت فقط', () => {
  const rows = H.bullScenario();
  assert.strictEqual(strat(rows, { trend: 1 }).all.length, 1);
  assert.strictEqual(strat(rows, { trend: -1 }).all.length, 0);
  assert.strictEqual(strat(rows, { trend: 0 }).all.length, 0);
  // H1 عند 07:00 و 08:00 و 09:00 و 10:00، إغلاقات 10، 12، 8، 50، و EMA(3)
  const h1 = { span: 3600000, t: [7, 8, 9, 10].map((h) => U(`2026-01-13T${String(h).padStart(2, '0')}:00:00`)), c: [10, 12, 8, 50] };
  const m15 = { span: 900000, t: [0, 15, 30, 45].map((m) => U('2026-01-13T10:00:00') + m * 60000) };
  const tr = trendFn(m15, h1, 3);
  // 10:15 و 10:30 و 10:45: آخر H1 مغلقة هي 09:00 (إغلاق 8 تحت EMA 10)، وشمعة 10:00 لم تُغلق بعد
  assert.deepStrictEqual([tr(0), tr(1), tr(2)], [-1, -1, -1]);
  // 11:00: أُغلقت H1 10:00 (50 فوق EMA 30)
  assert.strictEqual(tr(3), 1);
  near(ema([10, 12, 8, 50], 3)[3], 30);
});

test('09 العمر 48 شمعة، والإلغاء عند الإغلاق خلف المنطقة', () => {
  // التأكيد عند عمر 48: مقبول، وعند 49: ملغى
  assert.strictEqual(strat(H.bullScenario({ pad: 44 })).all.length, 1);
  const old = strat(H.bullScenario({ pad: 45 }));
  assert.strictEqual(old.all.length, 0);
  assert.strictEqual(old.s.log.expired, 1);
  // إغلاق تحت المنطقة قبل التأكيد: ملغى
  const inval = strat(
    H.bullScenario({
      after: [
        [103.5, 103.6, 99.5, 99.9], // إغلاق تحت 100.2
        [99.9, 104, 99.8, 103.8],
      ],
    }),
  );
  assert.strictEqual(inval.all.length, 0);
  assert.strictEqual(inval.s.log.invalidated, 1);
});

test('10 عدّ اللمسات: دخول في اللمسة 1 أو 2، ولا شيء بعد انتهاء الثانية', () => {
  const t1 = [103.5, 103.6, 101.0, 101.2]; // لمسة بدون تأكيد
  const out1 = [102, 103, 101.8, 102.8]; // خارج المنطقة
  const t2 = [102.8, 102.9, 101.3, 101.4]; // لمسة بدون تأكيد
  const out2 = [101.6, 103, 101.6, 102.9];
  const pin = [101.6, 101.8, 100.5, 101.75]; // Pin bar صاعد داخل المنطقة
  const two = strat(H.bullScenario({ after: [t1, out1, pin] }));
  assert.strictEqual(two.all.length, 1);
  assert.strictEqual(two.all[0].ob.touches, 2);
  assert.strictEqual(two.all[0].pattern, 'pinbar');
  const three = strat(H.bullScenario({ after: [t1, out1, t2, out2, pin] }));
  assert.strictEqual(three.all.length, 0);
  assert.strictEqual(three.s.log.touchesUsed, 1);
  // شمعة الكسر داخل المنطقة: يجب أن يخرج السعر أولاً، فالشموع المتتالية داخل المنطقة لمسة واحدة
  const one = strat(H.bullScenario({ after: [t1, [101.2, 101.4, 100.9, 101.3], [101.1, 104, 100.9, 103.8]] }));
  assert.strictEqual(one.all[0].ob.touches, 1);
});

test('11 الابتلاعية: حالات صحيحة وخاطئة، شراء وبيع', () => {
  const P = { o: 103.5, h: 103.6, l: 101, c: 101.2 };
  assert.ok(bullEngulf(P, { o: 101.1, h: 104, l: 100.9, c: 103.8 })); // تغطية كاملة
  assert.ok(!bullEngulf(P, { o: 101.1, h: 104, l: 100.9, c: 103.4 })); // تغطية جزئية (أقل من افتتاح السابقة)
  assert.ok(!bullEngulf(P, { o: 101.3, h: 104, l: 100.9, c: 103.8 })); // افتتاح فوق إغلاق السابقة
  assert.ok(!bullEngulf(P, { o: 101.2, h: 104, l: 100.9, c: 103.5 })); // جسم مساوٍ (ليس أكبر بشكل صارم)
  assert.ok(!bullEngulf({ o: 101, h: 104, l: 100, c: 103 }, { o: 100, h: 105, l: 99, c: 104 })); // السابقة صاعدة
  const Q = { o: 101.2, h: 103.6, l: 101, c: 103.5 };
  assert.ok(bearEngulf(Q, { o: 103.6, h: 103.8, l: 100.9, c: 101.1 }));
  assert.ok(!bearEngulf(Q, { o: 103.6, h: 103.8, l: 100.9, c: 101.3 }));
  assert.ok(!bearEngulf(Q, { o: 103.5, h: 103.8, l: 100.9, c: 101.2 }));
});

test('12 Pin bar: الحالات الحدّية، والجسم الصفري مرفوض', () => {
  assert.ok(bullPin({ o: 100, h: 101, l: 98, c: 101 })); // ذيل = 2.0 × الجسم بالضبط
  assert.ok(!bullPin({ o: 100, h: 101, l: 98.1, c: 101 })); // ذيل = 1.9 × الجسم
  assert.ok(bullPin({ o: 1.9, h: 3, l: 0, c: 2 })); // الإغلاق عند حد الثلث العلوي بالضبط
  assert.ok(!bullPin({ o: 1.85, h: 3, l: 0, c: 1.95 })); // الإغلاق في الثلث الأوسط
  assert.ok(!bullPin({ o: 2.5, h: 3, l: 0, c: 2.5 })); // جسم صفري
  assert.ok(!bullPin({ o: 1, h: 1, l: 1, c: 1 })); // مدى صفري
  assert.ok(bullPin({ o: 101, h: 101, l: 98, c: 100 })); // أي لون (هابطة)
  assert.ok(bearPin({ o: 101, h: 103, l: 100, c: 100 })); // ذيل علوي = 2.0 × الجسم
  assert.ok(!bearPin({ o: 101, h: 102.9, l: 100, c: 100 }));
  assert.ok(bearPin({ o: 1.1, h: 3, l: 0, c: 1 })); // الإغلاق عند حد الثلث السفلي
  assert.ok(!bearPin({ o: 1.15, h: 3, l: 0, c: 1.05 }));
  assert.ok(!bearPin({ o: 0.5, h: 3, l: 0, c: 0.5 }));
});

// سيناريو كامل على M1 في جلسة لندن (الثلاثاء 13 يناير 2026، 09:00 UTC)
const START = U('2026-01-13T06:30:00');
function warm(n, from) {
  const rows = [];
  let x = from;
  for (let k = 0; k < n; k++, x += 0.2) rows.push([x, x + 0.3, x - 0.1, x + 0.2]);
  return rows;
}
function fullRun(tail, { costs = H.ZERO, rules = H.RULES } = {}) {
  const rows = [...warm(10, 97.9), ...H.bullScenario(), ...tail];
  const m1 = H.m1FromM15(rows, START);
  const res = backtest(m1, { rules, risk: config.risk, costs, costFilterPct: config.costFilterPct, hooks: { trendAt: () => 1 } });
  return { res, m1, rows, iSig: 10 + 12 };
}

test('13 الدخول: افتتاح شمعة M15 التالية، أو تخطٍّ إذا افتتح خلف الوقف', () => {
  const { res, m1, iSig } = fullRun([[103.8, 108, 103.7, 107.9]]);
  assert.strictEqual(res.trades.length, 1);
  const t = res.trades[0];
  assert.strictEqual(t.entryTime, START + (iSig + 1) * 15 * 60000); // أول دقيقة في الشمعة التالية
  assert.strictEqual(t.entry, m1.o[(iSig + 1) * 15]);
  assert.strictEqual(t.signalTime, START + iSig * 15 * 60000);
  // الشمعة التالية تفتتح تحت الوقف: تخطٍّ
  const gap = fullRun([[99, 100, 98.5, 99.5]]);
  assert.strictEqual(gap.res.trades.length, 0);
  assert.strictEqual(gap.res.funnel.beyondStop, 1);
  // خارج الجلسات: نفس السيناريو قبل 08:00 لندن
  const rows = [...warm(10, 97.9), ...H.bullScenario(), [103.8, 108, 103.7, 107.9]];
  const early = backtest(H.m1FromM15(rows, U('2026-01-13T01:00:00')), { rules: H.RULES, risk: config.risk, costs: H.ZERO, costFilterPct: 10, hooks: { trendAt: () => 1 } });
  assert.strictEqual(early.trades.length, 0);
  assert.strictEqual(early.funnel.session, 1);
});

test('14 الوقف والهدف وفلتر التكلفة: خلف المنطقة ± 0.1 ATR، الهدف 2R، 10.0% مقبول و 10.02% مرفوض', () => {
  const { res, m1 } = fullRun([[103.8, 112, 103.7, 111.9]]);
  const t = res.trades[0];
  const m15 = aggregate(m1, 15);
  const a = atr(m15, 14);
  near(t.stop, 100.2 - 0.1 * a[22]);
  near(t.tp, t.entry + 2 * (t.entry - t.stop));
  assert.strictEqual(t.outcome, 'TP');
  near(t.r, 2);
  // البيع: الوقف فوق الحد الأعلى
  const costs = H.BASE; // 0.52 + 0.10 = 0.62
  const at10 = entryPlan(1, 100.26 - 0.26 + 0, 100 - 6.2 + 0.26, costs);
  near(at10.dist, 6.2, 1e-9);
  near(at10.costPct, 10, 1e-9);
  assert.ok(passesCostFilter(at10.costPct, 10));
  const over = entryPlan(1, 100, 100.26 - 6.19, costs);
  assert.ok(over.costPct > 10.01 && over.costPct < 10.02);
  assert.ok(!passesCostFilter(over.costPct, 10));
  const short = entryPlan(-1, 100, 106, costs);
  near(short.entry, 99.74);
  near(short.dist, 6.26);
  // الوقف الواسع لا يُستبعد: التكلفة 1%
  assert.ok(passesCostFilter(entryPlan(1, 100, 38, costs).costPct, 10));
});

test('15 التعادل عند +1R: الوقف إلى سعر الدخول من الدقيقة التالية، والهدف يبقى 2R', () => {
  const R = H.RULES;
  const s0 = U('2026-01-13T09:00:00');
  // الدقيقة 0 تصل +1R (101) وتنزل إلى 99.5: لا خروج (التعادل يبدأ من الدقيقة التالية)، والدقيقة 1 تلمس 100: خروج تعادل
  const be = simulate(H.m1Of([[100, 101.2, 99.5, 101], [100.8, 100.9, 99.9, 100]], s0), 0, 1, 99, H.ZERO, R);
  assert.deepStrictEqual([be.outcome, be.exit, be.kExit, be.tp], ['BE', 100, 1, 102]);
  // بعد التعادل، الهدف 2R ما زال قائماً
  const tp = simulate(H.m1Of([[100, 101.2, 99.5, 101], [101, 102.5, 100.5, 102.2]], s0), 0, 1, 99, H.ZERO, R);
  assert.deepStrictEqual([tp.outcome, tp.exit], ['TP', 102]);
  // بدون الوصول لـ +1R: الوقف الأصلي
  const sl = simulate(H.m1Of([[100, 100.9, 99.5, 100], [100, 100.2, 98.9, 99]], s0), 0, 1, 99, H.ZERO, R);
  assert.deepStrictEqual([sl.outcome, sl.exit], ['SL', 99]);
  // البيع
  const bs = simulate(H.m1Of([[100, 100.5, 98.8, 99], [99.2, 100.1, 99.1, 100]], s0), 0, -1, 101, H.ZERO, R);
  assert.deepStrictEqual([bs.outcome, bs.exit], ['BE', 100]);
});

test('16 تنفيذ M1: الوقف أولاً عند الالتباس، والفجوة تُغلق بالافتتاح، و Bid/Ask', () => {
  const R = H.RULES;
  const s0 = U('2026-01-13T09:00:00');
  // نفس الدقيقة تلمس الوقف والهدف: الوقف أولاً
  const both = simulate(H.m1Of([[100, 100.5, 99.8, 100.2], [100.2, 102.5, 98.5, 101]], s0), 0, 1, 99, H.ZERO, R);
  assert.deepStrictEqual([both.outcome, both.exit], ['SL', 99]);
  // فجوة تحت الوقف: الخروج بسعر الافتتاح
  const gap = simulate(H.m1Of([[100, 100.5, 99.8, 100.2], [98.5, 98.8, 98.2, 98.6]], s0), 0, 1, 99, H.ZERO, R);
  assert.deepStrictEqual([gap.outcome, gap.exit], ['SL', 98.5]);
  // فجوة فوق الهدف: الخروج بسعر الهدف (محافظ)
  const up = simulate(H.m1Of([[100, 100.5, 99.8, 100.2], [103, 103.5, 102.8, 103.2]], s0), 0, 1, 99, H.ZERO, R);
  assert.deepStrictEqual([up.outcome, up.exit], ['TP', 102]);
  // Bid/Ask: شراء بسبريد 0.52 — الدخول 100.26، والوقف يُفعَّل عندما Bid = Mid − 0.26 ≤ 99
  const c = { spread: 0.52, slippage: 0, commission: 0, swapPctPerNight: 0 };
  const no = simulate(H.m1Of([[100, 100.5, 99.27, 100], [100, 100.1, 99.9, 100]], s0), 0, 1, 99, c, R);
  assert.strictEqual(no.outcome, 'END'); // Bid الأدنى 99.01 > 99
  near(no.entry, 100.26);
  const yes = simulate(H.m1Of([[100, 100.5, 99.26, 100]], s0), 0, 1, 99, c, R);
  assert.deepStrictEqual([yes.outcome, yes.exit], ['SL', 99]);
  // بيع: الدخول Bid = 99.74، والخروج على Ask
  const sh = simulate(H.m1Of([[100, 100.5, 99.6, 100], [100.2, 100.75, 100, 100.5]], s0), 0, -1, 101, c, R);
  assert.deepStrictEqual([sh.outcome, sh.exit], ['SL', 101]); // Ask الأعلى 101.01 ≥ 101
  near(sh.entry, 99.74);
});

test('17 صفقة واحدة مفتوحة، و 3 خسائر متتالية توقف يوم لندن', () => {
  const g = createGate(H.RULES);
  const t = (s) => U(`2026-01-13T${s}:00`);
  g.onEntry(t('10:30'));
  assert.strictEqual(g.check(t('10:15')), 'position');
  assert.strictEqual(g.check(t('10:30')), 'position'); // دقيقة الخروج لم تنتهِ
  assert.strictEqual(g.check(t('10:31')), null);
  g.onExit(t('10:30'), 'SL');
  g.onExit(t('11:00'), 'SL');
  assert.strictEqual(g.check(t('11:15')), null);
  g.onExit(t('12:00'), 'SL');
  assert.strictEqual(g.check(t('12:15')), 'dailyLimit');
  assert.strictEqual(g.check(t('23:59')), 'dailyLimit'); // نفس يوم لندن (يناير: لندن = UTC)
  assert.strictEqual(g.check(U('2026-01-14T00:00:00')), null); // يوم جديد
  // التعادل يُصفّر السلسلة
  const g2 = createGate(H.RULES);
  g2.onExit(t('10:00'), 'SL');
  g2.onExit(t('10:30'), 'SL');
  g2.onExit(t('11:00'), 'BE');
  g2.onExit(t('11:30'), 'SL');
  assert.strictEqual(g2.check(t('12:00')), null);
  // يوم لندن في الصيف: 23:30 UTC = 00:30 لندن من اليوم التالي
  const g3 = createGate(H.RULES);
  for (const s of ['09:00', '10:00', '11:00']) g3.onExit(U(`2026-07-14T${s}:00`), 'SL');
  assert.strictEqual(g3.check(U('2026-07-14T22:59:00')), 'dailyLimit');
  assert.strictEqual(g3.check(U('2026-07-14T23:00:00')), null);
});

test('18 المخاطرة 0.5% من الرصيد الحالي، ومعادلة الربح للشراء والبيع، والانزلاق مرة واحدة، و Swap', () => {
  const s0 = U('2026-01-13T09:00:00');
  const R = H.RULES;
  // 1,000 → +2R = 1,010 → −1R (من 1,010) = 1,004.95
  const win = closeTrade(simulate(H.m1Of([[100, 102.5, 99.5, 102]], s0), 0, 1, 99, H.ZERO, R), 1, 1000, H.ZERO, 0.5);
  assert.strictEqual(win.outcome, 'TP');
  near(win.risk, 5);
  near(win.units, 5);
  near(win.equityAfter, 1010);
  const loss = closeTrade(simulate(H.m1Of([[100, 100.5, 97.5, 98]], s0), 0, 1, 98, H.ZERO, R), 1, win.equityAfter, H.ZERO, 0.5);
  assert.strictEqual(loss.outcome, 'SL');
  near(loss.risk, 5.05);
  near(loss.equityAfter, 1004.95);
  // شراء: الحجم × (الخروج − الدخول) − الحجم × الانزلاق
  const c = { spread: 0, slippage: 0.1, commission: 0, swapPctPerNight: 0 };
  const b = pnlUsd({ side: 1, units: 2, entry: 100, exit: 104, nights: 0, costs: c });
  near(b.net, 2 * 4 - 2 * 0.1);
  // بيع: الحجم × (الدخول − الخروج) − الحجم × الانزلاق
  const s = pnlUsd({ side: -1, units: 2, entry: 100, exit: 104, nights: 0, costs: c });
  near(s.net, 2 * -4 - 2 * 0.1);
  // Swap لكل عبور 21:00 UTC، على الشراء والبيع
  const sw = { spread: 0, slippage: 0, commission: 0, swapPctPerNight: 0.02 };
  near(pnlUsd({ side: 1, units: 1, entry: 2000, exit: 2000, nights: 3, costs: sw }).net, -1.2);
  near(pnlUsd({ side: -1, units: 1, entry: 2000, exit: 2000, nights: 3, costs: sw }).net, -1.2);
  assert.strictEqual(time.nightsHeld(U('2026-01-13T20:59:00'), U('2026-01-13T21:00:00')), 1);
  assert.strictEqual(time.nightsHeld(U('2026-01-13T21:00:00'), U('2026-01-14T20:59:00')), 0);
  assert.strictEqual(time.nightsHeld(U('2026-01-16T20:00:00'), U('2026-01-19T09:00:00')), 3); // الجمعة → الإثنين
  // الصفقة الكاملة: الخسارة عند الوقف = −1R − الانزلاق ÷ المسافة
  const full = closeTrade(simulate(H.m1Of([[100, 100.5, 97.5, 98]], s0), 0, 1, 98, c, R), 1, 1000, c, 0.5);
  near(full.r, -1 - 0.1 / 2);
});

test('19 الإحصائيات والحكم والتقسيم 60/20/20', () => {
  const tr = [2, -1, -1, 2, -1, 0.5].map((r) => ({ r, pnl: r * 5, equityBefore: 1000, equityAfter: 1000 }));
  const m = metrics(tr);
  assert.deepStrictEqual([m.n, m.wins, m.losses, m.worst], [6, 3, 3, 2]);
  near(m.pf, 1.5);
  near(m.net, 1.5);
  near(m.exp, 0.25);
  near(m.maxDd, 2);
  near(m.avgWin, 1.5);
  near(m.avgLoss, -1);
  near(m.winRate, 50);
  const ok = { n: 40, pf: 1.3, net: 5 };
  const v = config.verdict;
  assert.strictEqual(verdict({ dev: ok, val: ok, oos: { ...ok, n: 29 } }, { pf: 2, net: 10 }, v).verdict, 'INSUFFICIENT DATA');
  assert.strictEqual(verdict({ dev: ok, val: ok, oos: ok }, { pf: 1.05, net: 1 }, v).verdict, 'PROFITABLE');
  assert.strictEqual(verdict({ dev: ok, val: ok, oos: ok }, { pf: 1.0, net: 0 }, v).verdict, 'NOT PROFITABLE');
  assert.strictEqual(verdict({ dev: ok, val: { ...ok, pf: 1.19 }, oos: ok }, { pf: 1.5, net: 5 }, v).verdict, 'NOT PROFITABLE');
  const b = splitBounds(0, 100, config.split);
  assert.deepStrictEqual([b.devEnd, b.valEnd], [60, 80]);
  assert.deepStrictEqual([splitOf(59.9, b), splitOf(60, b), splitOf(79.9, b), splitOf(80, b), splitOf(100, b)], ['dev', 'val', 'val', 'oos', 'oos']);
});

// بيانات M1 عشوائية ثابتة (أيام التداول فقط) لاختبار عدم النظر للمستقبل والتناظر
function randomM1(days = 120) {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  const out = { t: [], o: [], h: [], l: [], c: [] };
  let p = 2000;
  let vol = 0.3;
  const start = U('2025-02-03T00:00:00');
  for (let ms = start; ms < start + days * 86400000; ms += 60000) {
    if (time.marketClosed(ms)) continue;
    vol = Math.min(2, Math.max(0.1, vol + rnd() * 0.05));
    const next = Math.round((p + rnd() * vol * 4) * 100) / 100;
    const hi = Math.round((Math.max(p, next) + Math.abs(rnd()) * vol * 2) * 100) / 100;
    const lo = Math.round((Math.min(p, next) - Math.abs(rnd()) * vol * 2) * 100) / 100;
    out.t.push(ms);
    out.o.push(p);
    out.h.push(hi);
    out.l.push(lo);
    out.c.push(next);
    p = next;
  }
  return out;
}

test('20 لا نظر للمستقبل، والتناظر، ولا كود تداول، والملف الأصلي لا يُلمس', () => {
  const costs = { ...H.BASE, swapPctPerNight: 0 };
  const opts = { rules: H.RULES, risk: config.risk, costs, costFilterPct: config.costFilterPct };
  const m1 = randomM1();
  const full = backtest(m1, opts);
  assert.ok(full.trades.length >= 10, `صفقات قليلة جداً للاختبار: ${full.trades.length}`);
  // قطع البيانات لا يغيّر الصفقات المنتهية قبل القطع
  const cutAt = Math.floor(m1.t.length * 0.6);
  const part = { t: m1.t.slice(0, cutAt), o: m1.o.slice(0, cutAt), h: m1.h.slice(0, cutAt), l: m1.l.slice(0, cutAt), c: m1.c.slice(0, cutAt) };
  const cut = backtest(part, opts);
  const last = part.t[part.t.length - 1];
  const key = (t) => [t.entryTime, t.exitTime, t.side, t.outcome, +t.r.toFixed(9)].join('|');
  const a = full.trades.filter((t) => t.exitTime < last).map(key);
  const b = cut.trades.filter((t) => t.outcome !== 'END' && t.exitTime < last).map(key);
  assert.ok(a.length >= 1);
  assert.deepStrictEqual(b, a);
  // التناظر: قلب الأسعار (K − السعر) يعطي نفس الصفقات بالاتجاه المعاكس ونفس النتيجة بالـ R
  const K = 4000;
  const mir = { t: m1.t, o: m1.o.map((x) => K - x), h: m1.l.map((x) => K - x), l: m1.h.map((x) => K - x), c: m1.c.map((x) => K - x) };
  const mr = backtest(mir, opts);
  assert.strictEqual(mr.trades.length, full.trades.length);
  mr.trades.forEach((t, i) => {
    const f = full.trades[i];
    assert.deepStrictEqual([t.entryTime, t.exitTime, t.side, t.outcome], [f.entryTime, f.exitTime, -f.side, f.outcome]);
    near(t.r, f.r, 1e-6);
  });
  // لا كود تداول ولا اتصال بوسيط، والملف الأصلي يُقرأ فقط
  const dir = path.join(__dirname, '..', 'src');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const p of [/order_send|placeOrder|createOrder|OrderSend|newOrder/i, /metaapi|mt5|metatrader|ccxt/i, /withdraw/i, /method:\s*['"](POST|PUT|DELETE)/i]) assert.ok(!p.test(src), `${f}: ${p}`);
    assert.ok(!/(writeFileSync|renameSync|unlinkSync|appendFileSync)\([^)]*sourceM1/.test(src), f);
  }
  // النسخ من الملف الأصلي لا يغيّره
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-'));
  const src = path.join(tmp, 'src.json');
  fs.writeFileSync(src, JSON.stringify([{ time: '2026-01-13 10:00:00', open: '1', high: '2', low: '0.5', close: '1.5' }, { time: '2026-01-13 10:01:00', open: '1.5', high: '2', low: '1', close: '1.8' }]));
  const before = fs.readFileSync(src);
  const old = { ...config.paths };
  Object.assign(config.paths, { sourceM1: src, data: path.join(tmp, 'data') });
  try {
    const data = require('../src/data');
    const r = data.seedFromSource(() => {});
    assert.strictEqual(r.before, r.after);
    assert.ok(fs.readFileSync(src).equals(before));
    const own = data.loadM1();
    assert.deepStrictEqual([own.t.length, own.c[1]], [2, 1.8]);
  } finally {
    Object.assign(config.paths, old);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
