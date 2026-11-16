const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createNews, parseCalendar, formatToday, formatWeek, signalNote, moroccoParts } = require('../src/news');

const ROWS = [
  { title: 'CPI m/m', country: 'USD', date: '2026-11-18T08:30:00-05:00', impact: 'High', forecast: '0.3%', previous: '0.4%' },
  { title: 'FOMC Statement', country: 'USD', date: '2026-11-19T14:00:00-05:00', impact: 'High', forecast: '', previous: '' },
  { title: 'Retail Sales', country: 'USD', date: '2026-11-18T08:30:00-05:00', impact: 'Medium' },
  { title: 'ECB Rate', country: 'EUR', date: '2026-11-18T07:45:00-05:00', impact: 'High' },
];
const at = (iso) => Date.parse(iso);
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'news-')), 'news.json');

test('أخبار الدولار القوية فقط، مرتبة بالوقت', () => {
  const e = parseCalendar(ROWS);
  assert.deepStrictEqual(e.map((x) => x.title), ['CPI m/m', 'FOMC Statement']);
  assert.strictEqual(e[0].ms, at('2026-11-18T13:30:00Z'));
  assert.throws(() => parseCalendar('<html>'));
});

test('توقيت المغرب UTC+1، ورسالة اليوم والأسبوع', () => {
  assert.deepStrictEqual(moroccoParts(at('2026-11-18T13:30:00Z')).hm, '14:30');
  const e = parseCalendar(ROWS);
  const today = formatToday(e, at('2026-11-18T07:00:00Z'));
  assert.match(today, /14:30 — CPI m\/m \(المتوقع 0.3%، السابق 0.4%\)/);
  assert.doesNotMatch(today, /FOMC/);
  assert.match(formatToday(e, at('2026-11-17T07:00:00Z')), /لا توجد أخبار قوية/);
  assert.match(formatWeek(e, at('2026-11-17T07:00:00Z')), /الأربعاء 14:30 — CPI[\s\S]*الخميس 20:00 — FOMC/);
});

test('سطر الإشارة فقط إذا كان الخبر خلال 24 ساعة', () => {
  const e = parseCalendar(ROWS);
  assert.match(signalNote(e, at('2026-11-17T20:00:00Z')), /خبر قوي خلال 24 ساعة: CPI m\/m 14:30/);
  assert.strictEqual(signalNote(e, at('2026-11-16T10:00:00Z')), '');
  assert.strictEqual(signalNote(e, at('2026-11-20T10:00:00Z')), '');
});

test('التذكير قبل 30 دقيقة مرة واحدة فقط، ولا تذكير لخبر فات', async () => {
  const n = createNews(tmp(), { fetchFn: async () => ROWS });
  await n.refresh(at('2026-11-18T10:00:00Z'));
  assert.deepStrictEqual(n.dueReminders(at('2026-11-18T12:00:00Z')), []);
  assert.deepStrictEqual(n.dueReminders(at('2026-11-18T13:05:00Z')).map((e) => e.title), ['CPI m/m']);
  assert.deepStrictEqual(n.dueReminders(at('2026-11-18T13:10:00Z')), [], 'لا تكرار');
  assert.deepStrictEqual(n.dueReminders(at('2026-11-19T18:40:00Z')).map((e) => e.title), ['FOMC Statement']);
  const late = createNews(tmp(), { fetchFn: async () => ROWS });
  await late.refresh(at('2026-11-18T10:00:00Z'));
  assert.deepStrictEqual(late.dueReminders(at('2026-11-18T13:40:00Z')), [], 'الخبر فات');
});

test('الجلب كل 6 ساعات فقط، وتحذير واحد في اليوم إذا تعطل المصدر، والأخبار القديمة تبقى', async () => {
  let calls = 0;
  let fail = false;
  const n = createNews(tmp(), {
    fetchFn: async () => {
      calls++;
      if (fail) throw new Error('HTTP 403');
      return ROWS;
    },
  });
  const t0 = at('2026-11-17T07:00:00Z');
  assert.strictEqual(await n.refresh(t0), null);
  await n.refresh(t0 + 3600 * 1000);
  assert.strictEqual(calls, 1);
  fail = true;
  assert.match(await n.refresh(t0 + 6 * 3600 * 1000), /تعذّر جلب تقويم الأخبار/);
  assert.strictEqual(await n.refresh(t0 + 7 * 3600 * 1000), null, 'تحذير واحد فقط في اليوم');
  assert.strictEqual(n.events().length, 2, 'نحتفظ بآخر أخبار ناجحة');
});
