const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSchedule, heartbeatKey, weeklyKey } = require('../src/schedule');
const { acquireLock, releaseLock } = require('../src/lock');
const { formatWeekly, formatHeartbeat } = require('../src/format');
const { createTracker } = require('../src/tracker');

const tmp = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sched-')), name);
const at = (s) => new Date(s + 'Z');

test('رسالة الصباح: مرة واحدة في اليوم بعد 07:00 UTC', () => {
  assert.strictEqual(heartbeatKey(at('2026-11-09T06:59:00')), null);
  assert.strictEqual(heartbeatKey(at('2026-11-09T07:00:00')), '2026-11-09');
  const s = createSchedule(tmp('s.json'));
  assert.deepStrictEqual(s.due(at('2026-11-09T07:01:00')).map((x) => x.name), ['heartbeat']);
  assert.deepStrictEqual(s.due(at('2026-11-09T15:00:00')), [], 'لا تتكرر في نفس اليوم');
  assert.deepStrictEqual(s.due(at('2026-11-10T07:00:00')).map((x) => x.name), ['heartbeat']);
});

test('ملخص الأسبوع: الجمعة 22:00 UTC، أو عند التشغيل خلال 48 ساعة بعدها، ولا يتكرر بعد إعادة التشغيل', () => {
  assert.strictEqual(weeklyKey(at('2026-11-13T21:59:00')), null, 'الجمعة قبل الموعد، والجمعة السابقة مرت عليها أكثر من 48 ساعة');
  assert.strictEqual(weeklyKey(at('2026-11-13T22:00:00')), '2026-11-13');
  assert.strictEqual(weeklyKey(at('2026-11-15T21:00:00')), '2026-11-13');
  assert.strictEqual(weeklyKey(at('2026-11-16T09:00:00')), null);
  const file = tmp('s.json');
  assert.ok(createSchedule(file).due(at('2026-11-13T22:05:00')).some((x) => x.name === 'weekly'));
  assert.ok(!createSchedule(file).due(at('2026-11-14T10:00:00')).some((x) => x.name === 'weekly'), 'محفوظ بعد إعادة التشغيل');
});

test('منع التشغيل مرتين: يرفض إذا كانت نسخة أخرى تعمل، ويقبل إذا كان الملف قديماً', () => {
  const file = tmp('bot.pid');
  assert.deepStrictEqual(acquireLock(file, 111, () => true), { ok: true });
  assert.deepStrictEqual(acquireLock(file, 222, () => true), { ok: false, pid: 111 });
  assert.deepStrictEqual(acquireLock(file, 222, () => false), { ok: true }, 'العملية القديمة توقفت (إيقاف إجباري)');
  releaseLock(file, 111);
  assert.ok(fs.existsSync(file), 'لا يحذف قفل نسخة أخرى');
  releaseLock(file, 222);
  assert.ok(!fs.existsSync(file));
});

test('نص الملخص الأسبوعي ورسالة الصباح', () => {
  const closed = [
    { symbol: 'XAU/USD', r: 2.25 },
    { symbol: 'XAG/USD', r: -1 },
    { symbol: 'BTC/USDT', r: 0.25 },
  ];
  const text = formatWeekly(closed, [{}], '2026-11-06 22:00:00', { closed: 16, totalR: 8.5 });
  assert.match(text, /المغلقة: 3 \| رابحة: 2 \| خاسرة: 1 \| المجموع: \+1\.50R/);
  assert.match(text, /• الذهب: 1 \| رابحة 1 \| \+2\.25R/);
  assert.match(text, /• العملات الرقمية: 1/);
  assert.match(text, /مفتوحة الآن: 1/);
  assert.match(formatWeekly([], [], '2026-11-06 22:00:00'), /لا صفقات مغلقة هذا الأسبوع/);
  const now = at('2026-11-09T07:00:00');
  assert.match(formatHeartbeat(at('2026-11-09T06:50:00'), 2, now), /^✅ البوت يعمل — آخر فحص: 06:50 UTC \| مفتوحة: 2$/);
  assert.match(formatHeartbeat(at('2026-11-09T05:00:00'), 0, now), /^⚠️ .*قبل 120 دقيقة/);
});

test('الصفقات المغلقة منذ تاريخ', () => {
  const tracker = createTracker(tmp('t.json'));
  const sig = { side: 'BUY', time: '2026-11-05 10:00:00', entry: 100, stopLoss: 99, takeProfit1: 101.5, takeProfit2: 103 };
  tracker.add('XAU/USD', '1h', sig);
  tracker.update('XAU/USD', '1h', [{ time: '2026-11-05 11:00:00', open: 100, high: 100.2, low: 98.5, close: 99 }]);
  assert.strictEqual(tracker.closedSince('2026-11-05 00:00:00').length, 1);
  assert.strictEqual(tracker.closedSince('2026-11-06 00:00:00').length, 0);
});
