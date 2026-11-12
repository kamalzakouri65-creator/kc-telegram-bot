// KC Metals Daily V1 — القواعد ثابتة قبل أي اختبار (2026-11-12)، ولا تُعدّل بعد رؤية النتائج.
// نفس RSI(2) التي نجحت على Nasdaq و S&P 500 (من kc-nasdaq-daily، بدون أي تعديل)، على الذهب، والفضة للتأكيد.
const path = require('path');
const ROOT = path.join(__dirname, '..');

const config = {
  // السبريد من حساب XM (GOLDmicro ~0.57$ على ~4000، SILVERmicro ~0.07 على ~52)، كنسبة من السعر
  markets: [
    { name: 'GOLD', ticker: 'GC=F', spreadPct: 0.015, xm: 'GOLDmicro' },
    { name: 'SILVER', ticker: 'SI=F', spreadPct: 0.14, xm: 'SILVERmicro' },
  ],
  dataFrom: '2004-01-01',
  dev: { from: '2021-01-01' },
  final: { from: '2005-01-01', to: '2020-12-31' },
  // النجاح: الذهب 20 صفقة على الأقل و PF ≥ 1.2 ورابح، والفضة رابحة
  criteria: { minTrades: 20, minProfitFactor: 1.2 },
  paths: { root: ROOT, data: path.join(ROOT, 'data'), logs: path.join(ROOT, 'logs') },
};

const DECISIONS = [
  'RSI(2): شراء عند الإغلاق إذا كان السعر فوق متوسط 200 يوم و RSI(2) < 10.',
  'الخروج: أول إغلاق فوق متوسط 5 أيام، أو بعد 10 أيام تداول. الوقف: الدخول − 2 × ATR(14)، وفجوة تحته تُغلق بسعر الافتتاح.',
  'التكاليف: سبريد XM (0.015% للذهب، 0.14% للفضة) + Swap 0.02% عن كل ليلة.',
  'البيانات: عقود الذهب والفضة الآجلة اليومية من Yahoo (GC=F و SI=F).',
];

module.exports = { config, DECISIONS };
