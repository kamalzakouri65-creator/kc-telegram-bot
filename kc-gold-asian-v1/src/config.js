// GOLD ASIAN RANGE BREAKOUT V1 — مشروع مستقل: لا يستورد أي ملف من المشاريع الأخرى، وبياناتها تُقرأ فقط.
// القواعد مسجلة مسبقاً في docs/SPEC.md (2026-11-20). تشغيل وحيد، ولا Optimization.
const path = require('path');
const ROOT = path.join(__dirname, '..');

const config = {
  rule: {
    asian: { from: 0, to: 8 }, // ساعات لندن [00:00، 08:00)
    minAsianBars: 16, // نصف 32 شمعة M15
    entry: { from: 8, to: 12 }, // شموع تبدأ في [08:00، 12:00) لندن
    exitHour: 16, // الخروج بإغلاق آخر شمعة تبدأ قبل 16:00 لندن
    trendDays: 20,
    minRange: 3,
    maxRange: 25,
    stopFrac: 0.5, // منتصف النطاق
    rr: 1.5,
  },
  grid: { rr: [1, 1.5, 2], stopFrac: [0.25, 0.5, 1] },
  costs: {
    base: { name: 'التكاليف الأساسية (سبريد 0.52 + انزلاق 0.10، فرضية)', spread: 0.52, slippage: 0.1 },
    doubled: { name: 'ضعف السبريد (1.04 + انزلاق 0.10)', spread: 1.04, slippage: 0.1 },
  },
  risk: { startEquity: 1000, riskPct: 0.5 },
  split: { dev: 0.6, val: 0.2 }, // والباقي 20% Historical Holdout
  criteria: { minPf: 1.3, minHoldoutTrades: 30, last6mMinR: -5, minPositiveCombos: 7 },
  paths: {
    root: ROOT,
    data: path.join(ROOT, 'data'),
    reports: path.join(ROOT, 'reports'),
    docs: path.join(ROOT, 'docs'),
    // ملف المصدر: قراءة فقط
    sourceM15: path.join(ROOT, '..', 'kc-gold-lab', 'data', 'xau-m15.json'),
  },
};
module.exports = { config };
