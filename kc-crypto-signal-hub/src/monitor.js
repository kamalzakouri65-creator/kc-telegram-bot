// المراقبة الحية: كل دقيقة نجلب الشموع المغلقة الجديدة ونمررها على نفس محرك الاختبار التاريخي،
// ثم نرسل الأحداث إلى تيليغرام. لا يوجد أي تنفيذ صفقات: الصفقة في المتابعة افتراضية لحساب الحدود والنتائج.
const { config: defaults } = require('./config');
const { fetchRecent } = require('./data/binance');
const { buildContext, createPairState, step } = require('./strategy/signalEngine');
const { createRiskState } = require('./risk/riskManager');
const { computeMetrics } = require('./backtest/metrics');
const tg = require('./notifications/telegram');

const DAY = 24 * 60 * 60 * 1000;
const LIMITS = { '1h': 600, '15m': 400, '5m': 400 };

// نحفظ في السجل نسخة مختصرة من كل حدث
const compact = (e) => ({
  type: e.type,
  pair: e.pair,
  time: e.time,
  id: e.signal?.id ?? e.setup?.id ?? e.trade?.id,
  reasons: e.reasons,
  pnl: e.trade?.pnl,
  r: e.trade?.r,
});

function createMonitor({ cfg = defaults, journal, notify, fetchRecentImpl = fetchRecent, now = Date.now, log = console.log }) {
  const pairs = Object.keys(cfg.pairs);
  const state = journal.getState() ?? {
    risk: createRiskState(cfg.risk.initialBalance),
    pairs: Object.fromEntries(pairs.map((p) => [p, createPairState()])),
    lastProcessed: null,
  };

  async function onDayEnd(day) {
    const from = Date.parse(`${day}T00:00:00Z`);
    const events = journal.eventsBetween(from, from + DAY);
    const closed = events.filter((e) => e.type === 'closed');
    const summary = {
      day,
      signals: events.filter((e) => e.type === 'signal').length,
      rejected: events.filter((e) => e.type === 'rejected').length,
      closed: closed.length,
      pnl: closed.reduce((s, e) => s + e.pnl, 0),
      balance: state.risk.balance,
    };
    await notify(`daily|${day}`, tg.formatDailySummary(summary));
    // نهاية الأحد (UTC) = نهاية الأسبوع
    if (new Date(from).getUTCDay() === 0) {
      const weekFrom = from - 6 * DAY;
      const trades = journal.eventsBetween(weekFrom, from + DAY).filter((e) => e.type === 'closed');
      const metrics = computeMetrics(trades, state.risk.balance - trades.reduce((s, e) => s + e.pnl, 0));
      await notify(`weekly|${day}`, tg.formatWeeklyReport({ from: new Date(weekFrom).toISOString().slice(0, 10), to: day, metrics }));
    }
  }

  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const t = now();
      const data = {};
      for (const p of pairs) {
        data[p] = {
          h1: await fetchRecentImpl(p, '1h', LIMITS['1h'], t),
          m15: await fetchRecentImpl(p, '15m', LIMITS['15m'], t),
          m5: await fetchRecentImpl(p, '5m', LIMITS['5m'], t),
        };
      }
      // أول تشغيل: نبدأ من الآن ولا نرسل إشارات قديمة
      if (state.lastProcessed == null) {
        state.lastProcessed = Math.max(...pairs.map((p) => data[p].m5.at(-1)?.closeTime ?? 0));
        journal.setState(state);
        log('بداية المراقبة من', new Date(state.lastProcessed).toISOString());
        return;
      }
      const ctx = Object.fromEntries(pairs.map((p) => [p, buildContext(data[p], cfg)]));
      const times = [...new Set(pairs.flatMap((p) => data[p].m5.map((c) => c.closeTime)))]
        .filter((x) => x > state.lastProcessed)
        .sort((a, b) => a - b);
      for (const time of times) {
        for (const p of pairs) {
          const i = data[p].m5.findIndex((c) => c.closeTime === time);
          if (i < 0) continue;
          for (const e of step(ctx[p], state.pairs[p], state.risk, i, p, cfg)) {
            const event = { ...e, pair: p };
            journal.record(compact(event));
            if (e.type === 'dayEnd') await onDayEnd(e.day);
            const msg = tg.messageFor(event);
            if (msg) await notify(msg.key, msg.text);
          }
        }
        state.lastProcessed = time;
        journal.setState(state);
      }
    } catch (err) {
      log('خطأ:', err.message);
      const hour = Math.floor(now() / (60 * 60 * 1000));
      await notify(`error|${err.message}|${hour}`, tg.formatError(err)).catch(() => {});
    } finally {
      running = false;
    }
  }

  return { tick, state };
}

module.exports = { createMonitor };
