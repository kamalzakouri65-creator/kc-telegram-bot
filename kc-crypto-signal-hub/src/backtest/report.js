const { computeMetrics } = require('./metrics');
const { splitTrades } = require('./engine');

const day = (t) => new Date(t).toISOString().slice(0, 10);
const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '∞');

function metricsLines(title, m) {
  return [
    `== ${title} ==`,
    `الصفقات: ${m.totalTrades} | رابحة: ${m.wins} | خاسرة: ${m.losses} | نسبة الربح: ${fmt(m.winRate, 1)}%`,
    `معامل الربح: ${fmt(m.profitFactor)} | صافي الربح: ${fmt(m.netProfit)}$ (${fmt(m.netProfitPct, 1)}%)`,
    `متوسط R: ${fmt(m.avgR)} | التوقع لكل صفقة: ${fmt(m.expectancy, 3)}$`,
    `أكبر تراجع: ${fmt(m.maxDrawdown)}$ (${fmt(m.maxDrawdownPct, 1)}%) | أطول سلسلة خسائر: ${m.longestLosingStreak}`,
    '',
  ];
}

function buildReport(result, cfg) {
  const start = cfg.risk.initialBalance;
  const { cutoff, train, test } = splitTrades(result, cfg.backtest.trainShare);
  const counts = {};
  for (const e of result.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const rejectReasons = {};
  for (const e of result.events.filter((x) => x.type === 'rejected')) {
    for (const r of e.reasons) {
      const key = r.replace(/[\d.]+/g, '#');
      rejectReasons[key] = (rejectReasons[key] ?? 0) + 1;
    }
  }
  const pairs = [...new Set(result.trades.map((t) => t.pair))];

  const lines = [
    `الفترة: ${day(result.start)} إلى ${day(result.end)} (UTC) | الرصيد الابتدائي: ${start}$`,
    `الرسوم: ${cfg.risk.feeRate * 100}% لكل جهة | الانزلاق: ${cfg.risk.slippagePct}% | المخاطرة: ${cfg.risk.riskPct}% لكل إشارة`,
    `الإعدادات: ${counts.setup ?? 0} | إشارات: ${counts.signal ?? 0} | مرفوضة: ${counts.rejected ?? 0} | انتهت دون تأكيد: ${counts.setupExpired ?? 0} | انتهت دون دخول: ${(counts.signalExpired ?? 0) + (counts.signalCancelled ?? 0)}`,
    '',
    ...metricsLines('الكل', computeMetrics(result.trades, start)),
    ...metricsLines(`داخل العينة (حتى ${day(cutoff)})`, computeMetrics(train, start)),
    ...metricsLines(`خارج العينة (بعد ${day(cutoff)}) — الاختبار النظيف`, computeMetrics(test, start)),
    ...pairs.flatMap((p) => metricsLines(p, computeMetrics(result.trades.filter((t) => t.pair === p), start))),
  ];
  if (Object.keys(rejectReasons).length) {
    lines.push('أسباب الرفض:', ...Object.entries(rejectReasons).map(([r, n]) => `• ${r}: ${n}`), '');
  }
  if (result.openAtEnd) lines.push(`ملاحظة: ${result.openAtEnd} صفقة ما زالت مفتوحة في نهاية البيانات ولم تُحسب.`);
  lines.push('لم يُحسَّن أي معامل على هذه البيانات. النتائج الماضية لا تضمن المستقبل.');
  return lines.join('\n');
}

module.exports = { buildReport };
