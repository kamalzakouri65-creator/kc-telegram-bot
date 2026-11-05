const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { simulateDay, runBacktest } = require('../src/orb');
const { evaluate, metrics, buildReport } = require('../src/report');
const data = require('../src/data');

// يوم تداول من 09:30 حتى 15:45 (26 شمعة). النطاق: شمعتا 09:30 و 09:45 بين 99 و 101 (المنتصف 100)
const CLOCKS = Array.from({ length: 26 }, (_, k) => {
  const m = 9 * 60 + 30 + k * 15;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});
function day(date, overrides = {}, base = 100.5) {
  return CLOCKS.map((clock, k) => {
    const b = k < 2 ? { open: 100, high: 101, low: 99, close: 100.5 } : { open: base, high: base + 0.2, low: base - 0.2, close: base };
    return { time: `${date} ${clock}:00`, ...b, ...overrides[clock] };
  });
}
const noCost = { spreadPct: 0 };
const close = (a, b) => Math.abs(a - b) < 1e-9;

test('شراء: إغلاق فوق النطاق، الوقف عند المنتصف، والهدف 2R يتحقق', () => {
  const bars = day('2026-03-02', { '10:00': { open: 100.5, high: 101.6, low: 100.4, close: 101.5 }, '10:30': { open: 101.5, high: 104.6, low: 101.4, close: 104 } }, 101.5);
  const t = simulateDay(bars, undefined, noCost);
  assert.deepStrictEqual([t.side, t.entry, t.stopLoss, t.target, t.outcome], ['BUY', 101.5, 100, 104.5, 'target']);
  assert.ok(close(t.r, 2));
  assert.strictEqual(t.entryTime, '2026-03-02 10:00:00');
});

test('بيع: إغلاق تحت النطاق ثم ضرب الوقف = −1R، والسبريد يُخصم', () => {
  const bars = day('2026-03-03', { '10:15': { open: 99.5, high: 99.6, low: 98.4, close: 98.5 }, '11:00': { open: 98.5, high: 100.1, low: 98.4, close: 99.9 } }, 98.5);
  const t = simulateDay(bars, undefined, { spreadPct: 0.1 });
  assert.deepStrictEqual([t.side, t.outcome], ['SELL', 'stop']);
  // المخاطرة 1.5، والسبريد 0.1% من 98.5 = 0.0985
  assert.ok(close(t.r, (-1.5 - 0.0985) / 1.5));
});

test('الوقف والهدف في نفس الشمعة = وقف', () => {
  const bars = day('2026-03-04', { '10:00': { open: 100.5, high: 101.6, low: 100.4, close: 101.5 }, '10:15': { open: 101.5, high: 105, low: 99.9, close: 102 } }, 101.5);
  assert.strictEqual(simulateDay(bars, undefined, noCost).outcome, 'stop');
});

test('بدون وقف ولا هدف: الخروج عند إغلاق آخر شمعة في اليوم', () => {
  const bars = day('2026-03-05', { '10:00': { open: 100.5, high: 101.6, low: 100.4, close: 101.5 }, '15:45': { open: 101.5, high: 102.2, low: 101.4, close: 102 } }, 101.5);
  const t = simulateDay(bars, undefined, noCost);
  assert.deepStrictEqual([t.outcome, t.exit, t.exitTime], ['close', 102, '2026-03-05 15:45:00']);
  assert.ok(close(t.r, 0.5 / 1.5));
});

test('لا دخول بعد 11:30، ولا صفقة ثانية في نفس اليوم، والذيل وحده لا يكفي', () => {
  const late = day('2026-03-06', { '11:30': { open: 100.5, high: 102, low: 100.4, close: 101.8 } });
  assert.strictEqual(simulateDay(late, undefined, noCost), null);
  const wick = day('2026-03-06', { '10:00': { open: 100.5, high: 103, low: 100.4, close: 100.9 } });
  assert.strictEqual(simulateDay(wick, undefined, noCost), null, 'ذيل فوق النطاق مع إغلاق داخله ليس اختراقاً');
  const two = day('2026-03-06', { '10:00': { open: 100.5, high: 101.6, low: 100.4, close: 101.5 }, '10:15': { open: 101.5, high: 101.6, low: 99.9, close: 100 }, '10:30': { open: 100, high: 100.1, low: 98, close: 98.2 } }, 98.2);
  const res = runBacktest(two);
  assert.strictEqual(res.trades.length, 1);
  assert.strictEqual(res.trades[0].side, 'BUY');
});

test('يوم لا يبدأ عند 09:30 يُتخطى مع السبب', () => {
  const res = runBacktest(day('2026-03-09').slice(1));
  assert.deepStrictEqual(res.skipped, [{ date: '2026-03-09', reason: 'اليوم لا يبدأ عند الافتتاح' }]);
});

test('لا نظر للمستقبل: تغيير الشموع بعد الدخول لا يغيّر الدخول ولا الوقف ولا الهدف', () => {
  const a = day('2026-03-10', { '10:00': { open: 100.5, high: 101.6, low: 100.4, close: 101.5 } }, 101.5);
  const b = a.map((x, k) => (k > 2 ? { ...x, high: x.high + 5, low: x.low - 5 } : x));
  const [ta, tb] = [simulateDay(a, undefined, noCost), simulateDay(b, undefined, noCost)];
  for (const k of ['entry', 'stopLoss', 'target', 'entryTime']) assert.strictEqual(ta[k], tb[k], k);
});

test('التقييم: الفترة الأخيرة = آخر 30% من الأيام، والشروط تُطبّق', () => {
  const days = Array.from({ length: 10 }, (_, k) => `2026-04-${String(k + 1).padStart(2, '0')}`);
  const trades = days.map((d, k) => ({ date: d, r: k < 7 ? 2 : -1 }));
  const ev = evaluate({ trades, days, skipped: [] }, { minTrades: 5, minProfitFactor: 1.2, oosShare: 0.3 });
  assert.strictEqual(ev.cutoff, '2026-04-08');
  assert.strictEqual(ev.oos.count, 3);
  assert.deepStrictEqual(ev.reasons, ['الفترة الأخيرة غير رابحة']);
  assert.strictEqual(metrics(trades).profitFactor, 14 / 3);
  assert.match(buildReport({ trades, days, skipped: [] }), /❌ النتيجة: فشلت/);
});

test('الجلب: GET لشموع QQQ بتوقيت نيويورك فقط، والمفتاح لا يظهر في الأخطاء', async () => {
  process.env.TWELVE_DATA_API_KEY = 'secret-test-key';
  const urls = [];
  global.fetch = async (url, opts) => {
    urls.push(new URL(url));
    assert.strictEqual(opts.method, 'GET');
    return { ok: true, json: async () => ({ values: [{ datetime: '2026-03-02 09:30:00', open: '1', high: '1', low: '1', close: '1' }] }) };
  };
  const rows = await data.fetchHistory({ years: 2, pauseMs: 0, now: new Date('2026-11-05T12:00:00Z') });
  assert.strictEqual(rows.length, 1);
  const u = urls[0];
  assert.strictEqual(u.origin + u.pathname, 'https://api.twelvedata.com/time_series');
  assert.deepStrictEqual([u.searchParams.get('symbol'), u.searchParams.get('interval'), u.searchParams.get('timezone')], ['QQQ', '15min', 'America/New_York']);
  global.fetch = async () => ({ ok: true, json: async () => ({ status: 'error', message: 'limit reached' }) });
  await assert.rejects(data.fetchHistory({ pauseMs: 0 }), (err) => !err.message.includes('secret-test-key'));
});

test('لا يوجد في الكود أي أمر تداول أو حساب', () => {
  const dir = path.join(__dirname, '..', 'src');
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const p of [/order_send|placeOrder|createOrder/i, /metaapi/i, /withdraw/i, /\/api\/v3\/order/i]) assert.ok(!p.test(text), `${f}: ${p}`);
  }
});

test('FVG على 5 و 15 دقيقة: الحكم يتطلب نجاح QQQ و SPY موجب', () => {
  const { verdict } = require('../src/fvg-intraday');
  const pass = { pass: true, reasons: [], totalR: 10 };
  assert.strictEqual(verdict(pass, { totalR: 2 }).ok, true);
  assert.match(verdict(pass, { totalR: -3 }).reason, /SPY غير موجب/);
  assert.match(verdict({ pass: false, reasons: ['صفقات أقل من 30'], totalR: 5 }, { totalR: 9 }).reason, /QQQ لم يجتز/);
});
