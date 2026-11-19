// الفكرة 1 — اختراق نطاق آسيا عند افتتاح لندن. القواعد مسجلة قبل أي نتيجة (2026-11-19) ووافق عليها صاحب المشروع.
// البرنامج: docs/PROGRAM.md (التطوير حتى 2023-12-31، التأكيد 2024 → اليوم مرة واحدة فقط).
const path = require('path');
const ROOT = path.join(__dirname, '..');

const config = {
  rule: {
    asian: { from: 0, to: 8 }, // ساعات لندن: [00:00، 08:00)
    entry: { from: 8, to: 12 }, // ساعات لندن: [08:00، 12:00)
    exitHour: 16, // ساعة لندن: الخروج بالوقت عند 16:00
    trendDays: 20, // إغلاق الأمس مقابل متوسط 20 يوماً
    stopFrac: 0.5, // الوقف عند منتصف النطاق
    rr: 1.5,
    minRange: 3,
    maxRange: 25,
  },
  costs: { spread: 0.52, slippage: 0.1 }, // دولار للأونصة لكل صفقة (XM GOLDmicro)
  split: { devTo: '2023-12-31', confirmFrom: '2024-01-01' },
  criteria: { minPf: 1.3, minTrades: 150, minPositive: 7 },
  grid: { rr: [1, 1.5, 2], stopFrac: [0.25, 0.5, 1] },
  twelveData: { baseUrl: 'https://api.twelvedata.com/time_series', outputsize: 5000, pauseMs: 15000, from: '2019-11-01', maxPages: 60 },
  paths: { root: ROOT, data: path.join(ROOT, 'data'), reports: path.join(ROOT, 'reports') },
};

module.exports = { config };
