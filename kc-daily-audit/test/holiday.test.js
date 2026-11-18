const test = require('node:test');
const assert = require('node:assert');
const { SPEC, preHolidayIndexes, holidayTrades } = require('../src/holiday');

// أيام عمل من 2026-05-01 حتى 2026-07-31، مع عطلة 3 يوليو (الجمعة)
function days(skip = []) {
  const out = [];
  let p = 100;
  for (let t = Date.parse('2026-05-01'); t <= Date.parse('2026-07-31'); t += 86400000) {
    const d = new Date(t);
    const s = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6 || skip.includes(s)) continue;
    out.push({ time: s, open: p, high: p + 1, low: p - 1, close: p + 0.5 });
    p += 0.5;
  }
  return out;
}

test('الشروط كما سُجّلت', () => {
  assert.deepStrictEqual(SPEC.rule, { daysBefore: 1, exit: 'before', stopAtr: 2 });
  assert.deepStrictEqual([SPEC.spreadPct, SPEC.swapPctPerNight, SPEC.minPf, SPEC.minTrades, SPEC.grid.minPositive], [0.01, 0.02, 1.2, 20, 5]);
});

test('يوم ما قبل العطلة: الخميس 2 يوليو قبل عطلة الجمعة 3 يوليو، ونهاية الأسبوع وحدها ليست عطلة', () => {
  const c = days(['2026-07-03']);
  const idx = preHolidayIndexes(c).map((i) => c[i].time);
  assert.deepStrictEqual(idx, ['2026-07-02']);
});

test('الإغلاق المفاجئ المستبعد لا يُعد عطلة', () => {
  // 11–14 سبتمبر 2001: إغلاق مفاجئ مدرج في القائمة المستبعدة
  const fake = [{ time: '2001-09-10', open: 1, high: 2, low: 0.5, close: 1.5 }, { time: '2001-09-17', open: 1, high: 2, low: 0.5, close: 1.5 }];
  assert.deepStrictEqual(preHolidayIndexes(fake), []);
});

test('الصفقة: الدخول عند إغلاق الأربعاء 1 يوليو والخروج عند إغلاق الخميس 2 يوليو', () => {
  const c = days(['2026-07-03']);
  const [t] = holidayTrades(c);
  assert.deepStrictEqual([t.time, t.closedAt, t.holidayEve], ['2026-07-01', '2026-07-02', '2026-07-02']);
  const [after] = holidayTrades(c, { rule: { ...SPEC.rule, exit: 'after' } });
  assert.strictEqual(after.closedAt, '2026-07-06');
});
