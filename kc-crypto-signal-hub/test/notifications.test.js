const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { config } = require('../src/config');
const { buildScenario } = require('./helpers/scenario');
const { runBacktest } = require('../src/backtest/engine');
const tg = require('../src/notifications/telegram');
const { createJournal } = require('../src/journal/tradeJournal');
const { createMonitor } = require('../src/monitor');

const tempJournal = () => createJournal(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'journal-')), 'journal.json'));
const scenarioSignal = () => runBacktest({ BTCUSDT: buildScenario().data }).events.find((e) => e.type === 'signal').signal;

test('رسالة الإشارة تحتوي كل الحقول المطلوبة', () => {
  const text = tg.formatSignal(scenarioSignal());
  for (const part of [
    'BTC/USDT',
    'BUY',
    'منطقة الدخول: 161.00 - 161.24',
    'وقف الخسارة: 158.50',
    'الهدف: 167.86',
    'العائد/المخاطرة: 2.00 : 1',
    'المخاطرة: 0.50% = 0.25$',
    'الحجم: 0.07992 BTC',
    'الثقة: عالية (85/100)',
    'وقت الإشارة: 2026-01-17 15:39 UTC',
    'تنتهي إن لم يدخل السعر المنطقة قبل: 2026-01-17 16:24 UTC',
    'لا يوجد أي تنفيذ آلي',
  ]) {
    assert.ok(text.includes(part), `ينقص: ${part}\n${text}`);
  }
});

test('رسائل الرفض والملخص اليومي والتقرير الأسبوعي والأخطاء', () => {
  assert.match(tg.formatRejected({ pair: 'ETHUSDT', reasons: ['سبب 1', 'سبب 2'], time: 0 }), /ETH\/USDT مرفوض[\s\S]*• سبب 1[\s\S]*• سبب 2/);
  assert.match(tg.formatDailySummary({ day: '2026-01-17', signals: 2, rejected: 1, closed: 2, pnl: 0.25, balance: 50.25 }), /إشارات: 2[\s\S]*\+0.25\$[\s\S]*50.25\$/);
  const weekly = tg.formatWeeklyReport({ from: '2026-01-12', to: '2026-01-18', metrics: { totalTrades: 3, winRate: 66.7, profitFactor: 4, netProfit: 0.75, avgR: 1, longestLosingStreak: 1 } });
  assert.match(weekly, /الصفقات: 3[\s\S]*66.7%[\s\S]*\+0.75\$/);
  assert.match(tg.formatError(new Error('Binance HTTP 503')), /خطأ في النظام: Binance HTTP 503/);
});

test('لا تُرسل نفس الرسالة مرتين، حتى بعد إعادة التشغيل', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-'));
  const sent = [];
  const notify = tg.createNotifier({ send: async (t) => sent.push(t), journal: createJournal(path.join(dir, 'j.json')) });
  assert.strictEqual(await notify('signal|x', 'نص'), true);
  assert.strictEqual(await notify('signal|x', 'نص'), false);
  const restarted = tg.createNotifier({ send: async (t) => sent.push(t), journal: createJournal(path.join(dir, 'j.json')) });
  assert.strictEqual(await restarted('signal|x', 'نص'), false);
  assert.strictEqual(sent.length, 1);
});

test('المراقبة: أول تشغيل لا يرسل إشارات قديمة، ثم إشارة واحدة فقط مهما تكرر الفحص', async () => {
  // نفس السيناريو مع 40 شمعة M15 هادئة بعد الهدف حتى يمر منتصف الليل
  const { B } = buildScenario();
  const rel = (o, h, l, c) => [B + o, B + h, B + l, B + c];
  const after = [rel(0.9, 3, 0.8, 2.9), rel(2.9, 6, 2.8, 5.9), rel(5.9, 9, 5.8, 8.9), rel(8.9, 9.5, 8.5, 9)];
  for (let k = 0; k < 40; k++) after.push(rel(9, 9.2, 8.8, 9));
  const { data } = buildScenario({ afterBars: after });
  const sigTime = scenarioSignal().time;
  let now = sigTime - 60 * 60 * 1000; // ساعة قبل الإشارة
  const fetchRecentImpl = async (pair, tf, limit, t) => {
    const cs = { '1h': data.h1, '15m': data.m15, '5m': data.m5 }[tf].filter((c) => c.closeTime < t);
    return pair === 'BTCUSDT' ? cs.slice(-limit) : [];
  };
  const sent = [];
  const journal = tempJournal();
  const notify = tg.createNotifier({ send: async (t) => sent.push(t), journal });
  const cfg = { ...config, pairs: { BTCUSDT: config.pairs.BTCUSDT } };
  const mon = createMonitor({ cfg, journal, notify, fetchRecentImpl, now: () => now, log: () => {} });

  await mon.tick();
  assert.strictEqual(sent.length, 0, 'أول تشغيل يبدأ من الآن');
  now = sigTime + 1;
  await mon.tick();
  await mon.tick();
  const signals = sent.filter((t) => t.includes('إشارة شراء'));
  assert.strictEqual(signals.length, 1);
  now = sigTime + 3 * 60 * 60 * 1000;
  await mon.tick();
  assert.strictEqual(sent.filter((t) => t.includes('الهدف —')).length, 1, 'رسالة نتيجة الصفقة');
  assert.strictEqual(sent.filter((t) => t.includes('إشارة شراء')).length, 1);

  // بعد منتصف الليل (UTC): ملخص اليوم مرة واحدة
  now = sigTime + 10 * 60 * 60 * 1000;
  await mon.tick();
  await mon.tick();
  const daily = sent.filter((t) => t.includes('ملخص يوم 2026-01-17'));
  assert.strictEqual(daily.length, 1);
  assert.match(daily[0], /إشارات: 1 \| مرفوضة: 0 \| صفقات مغلقة: 1[\s\S]*\+0.52\$[\s\S]*50.52\$/);
});

test('المراقبة: الأخطاء تُرسل كرسالة خطأ ولا توقف النظام', async () => {
  const sent = [];
  const journal = tempJournal();
  const notify = tg.createNotifier({ send: async (t) => sent.push(t), journal });
  const mon = createMonitor({
    cfg: config,
    journal,
    notify,
    fetchRecentImpl: async () => {
      throw new Error('Binance HTTP 451');
    },
    log: () => {},
  });
  await mon.tick();
  await mon.tick();
  assert.strictEqual(sent.length, 1, 'نفس الخطأ مرة واحدة في الساعة');
  assert.match(sent[0], /Binance HTTP 451/);
});
