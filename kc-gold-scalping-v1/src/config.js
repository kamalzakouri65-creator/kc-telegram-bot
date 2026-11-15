// KC GOLD SCALPING V1 — مشروع مستقل، لا يستورد ولا يغيّر أي ملف من البوت أو المشاريع الأخرى.
// المرحلة 1: البيانات فقط. الاستراتيجية تُكتب بعد فحص البيانات وموافقة المستخدم.
const path = require('path');
const ROOT = path.join(__dirname, '..');

const config = {
  // مصدر البيانات: Twelve Data (بيانات سوق فقط، GET، بتوقيت UTC). الرمز عند الوسيط للتنفيذ النظري: XAUUSDm (Exness)
  dataSymbol: 'XAU/USD',
  brokerSymbol: 'XAUUSDm',
  interval: '1min',
  months: 12,
  twelveData: { baseUrl: 'https://api.twelvedata.com/time_series', outputsize: 5000, pauseMs: 15000, maxPages: 120 },
  paths: { root: ROOT, data: path.join(ROOT, 'data'), logs: path.join(ROOT, 'logs') },
};

module.exports = { config };
