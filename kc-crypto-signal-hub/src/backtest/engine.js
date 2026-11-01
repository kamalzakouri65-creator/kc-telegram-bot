// الاختبار التاريخي: يمر على شموع M5 بالترتيب الزمني لكل الأزواج معاً ويشغّل نفس محرك الإشارات
// المستعمل في المراقبة الحية، مع حساب مخاطرة واحد مشترك (نفس حدود الحساب الحقيقي).
const { config: defaults } = require('../config');
const { buildContext, createPairState, step } = require('../strategy/signalEngine');
const { createRiskState } = require('../risk/riskManager');

function runBacktest(data, cfg = defaults) {
  const pairs = Object.keys(data);
  const ctx = Object.fromEntries(pairs.map((p) => [p, buildContext(data[p], cfg)]));
  const states = Object.fromEntries(pairs.map((p) => [p, createPairState()]));
  const riskState = createRiskState(cfg.risk.initialBalance);

  const times = [...new Set(pairs.flatMap((p) => data[p].m5.map((c) => c.closeTime)))].sort((a, b) => a - b);
  const pointer = Object.fromEntries(pairs.map((p) => [p, 0]));
  const events = [];

  for (const t of times) {
    for (const p of pairs) {
      const m5 = data[p].m5;
      while (pointer[p] < m5.length && m5[pointer[p]].closeTime < t) pointer[p]++;
      if (pointer[p] < m5.length && m5[pointer[p]].closeTime === t) {
        for (const e of step(ctx[p], states[p], riskState, pointer[p], p, cfg)) events.push({ ...e, pair: p });
      }
    }
  }

  const trades = events.filter((e) => e.type === 'closed').map((e) => ({ pair: e.pair, ...e.trade }));
  return {
    events,
    trades,
    finalBalance: riskState.balance,
    start: times[0],
    end: times.at(-1),
    openAtEnd: pairs.filter((p) => states[p].trade).length,
  };
}

// تقسيم زمني: الصفقات قبل نقطة القطع (داخل العينة) وبعدها (خارج العينة).
// المعاملات كلها ثابتة في config.js ولا يوجد أي تحسين عليها، فالجزء الأخير اختبار نظيف.
function splitTrades(result, trainShare) {
  const cutoff = result.start + (result.end - result.start) * trainShare;
  return {
    cutoff,
    train: result.trades.filter((t) => t.filledAt < cutoff),
    test: result.trades.filter((t) => t.filledAt >= cutoff),
  };
}

module.exports = { runBacktest, splitTrades };
