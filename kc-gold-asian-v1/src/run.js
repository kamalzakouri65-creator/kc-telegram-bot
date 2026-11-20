// تشغيل التركيبات التسع والتركيبة الأساسية بضعف السبريد، والتقسيم، والحكم.
const { signals } = require('./strategy');
const { runTrades } = require('./execution');
const { metrics, splitBounds, splitOf, verdict } = require('./stats');

// فترة الصفقات الممكنة: من أول يوم يتوفر فيه SMA20 حتى آخر شمعة
function periodOf(bars, cfg) {
  const { days } = signals(bars, cfg.rule);
  const firstDay = days[cfg.rule.trendDays];
  if (!firstDay) throw new Error('بيانات قليلة جداً: أقل من 21 يوم لندن');
  return splitBounds(bars.t[firstDay.from], bars.t[bars.t.length - 1], cfg.split);
}

function runCombo(bars, cfg, rule, costs) {
  const s = signals(bars, rule);
  const r = runTrades(bars, s.signals, rule, costs, cfg.risk);
  return { ...r, log: s.log };
}

function bySplit(trades, bounds) {
  for (const t of trades) t.split = splitOf(t.entryTime, bounds);
  return {
    total: metrics(trades),
    dev: metrics(trades.filter((t) => t.split === 'dev')),
    val: metrics(trades.filter((t) => t.split === 'val')),
    holdout: metrics(trades.filter((t) => t.split === 'holdout')),
  };
}

function runAll(bars, cfg) {
  const bounds = periodOf(bars, cfg);
  const combos = [];
  for (const rr of cfg.grid.rr)
    for (const stopFrac of cfg.grid.stopFrac) {
      const rule = { ...cfg.rule, rr, stopFrac };
      const res = runCombo(bars, cfg, rule, cfg.costs.base);
      combos.push({ rr, stopFrac, base: rr === cfg.rule.rr && stopFrac === cfg.rule.stopFrac, res, m: bySplit(res.trades, bounds) });
    }
  const base = combos.find((c) => c.base);
  const doubled = runCombo(bars, cfg, cfg.rule, cfg.costs.doubled);
  const dm = bySplit(doubled.trades, bounds);
  // آخر 6 أشهر من البيانات حسب وقت الدخول
  const d6 = new Date(bounds.end);
  d6.setUTCMonth(d6.getUTCMonth() - 6);
  const last6 = metrics(base.res.trades.filter((t) => t.entryTime >= d6.getTime()));
  const positiveCombos = combos.filter((c) => c.m.total.net > 0).length;
  const v = verdict({ total: base.m.total, holdout: base.m.holdout, last6, doubled: dm.total, positiveCombos }, cfg.criteria);
  return { bounds, combos, base, doubled, dm, last6, last6From: d6.getTime(), positiveCombos, v };
}

module.exports = { runAll, periodOf, runCombo, bySplit };
