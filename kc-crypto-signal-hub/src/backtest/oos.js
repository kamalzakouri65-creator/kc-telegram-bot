// اختبار فرضية واحدة على بيانات لم تُستعمل أبداً (خارج العينة).
// الفرضية وشروط النجاح مكتوبة هنا قبل تحميل البيانات أو رؤية أي نتيجة، ولا تُعدّل بعدها.
// إن فشلت الفرضية لا نجرّب رقماً آخر على نفس البيانات.
const { computeMetrics } = require('./metrics');

const PREREGISTERED = {
  registeredOn: '2026-11-02',
  hypothesis: 'لا شراء إذا ارتفع إغلاق H1 أكثر من 1.5% خلال آخر 24 ساعة عند تكوّن الإعداد',
  // البيانات: سنتان قبل بداية البيانات التي اكتُشف منها النمط (2025-10-12)
  from: Date.UTC(2023, 9, 12),
  to: Date.UTC(2025, 9, 12),
  maxRally24hPct: 1.5,
  minProfitFactor: 1.2,
  minTrades: 30,
};

// شروط النجاح الثلاثة، وكلها مطلوبة
function evaluate(baseTrades, filteredTrades, startBalance, pairs) {
  const filtered = computeMetrics(filteredTrades, startBalance);
  const perPair = pairs.map((p) => {
    const before = computeMetrics(baseTrades.filter((t) => t.pair === p), startBalance);
    const after = computeMetrics(filteredTrades.filter((t) => t.pair === p), startBalance);
    return { pair: p, before, after, improved: after.netProfit > before.netProfit };
  });
  const checks = [
    { name: `معامل الربح بعد الفلتر أكبر من ${PREREGISTERED.minProfitFactor}`, value: filtered.profitFactor, ok: filtered.profitFactor > PREREGISTERED.minProfitFactor },
    { name: `${PREREGISTERED.minTrades} صفقة على الأقل بعد الفلتر`, value: filtered.totalTrades, ok: filtered.totalTrades >= PREREGISTERED.minTrades },
    { name: 'الفلتر يحسّن صافي الربح على كل زوج', value: perPair.map((p) => `${p.pair}: ${p.improved ? 'نعم' : 'لا'}`).join('، '), ok: perPair.every((p) => p.improved) },
  ];
  return { passed: checks.every((c) => c.ok), checks, perPair, filtered };
}

module.exports = { PREREGISTERED, evaluate };
