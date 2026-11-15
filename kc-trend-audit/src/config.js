// KC TREND AUDIT — كل شيء هنا ثابت قبل التشغيل (2026-11-15) بموافقة المستخدم.
// قواعد الاستراتيجيتين تُقرأ من البوت كما هي (قراءة فقط، بدون أي تعديل).
const path = require('path');
const ROOT = path.join(__dirname, '..');

const config = {
  // Out-of-Sample حقيقي: ذهب سبوت H1 من Twelve Data، فترة لم تُستعمل في أي قرار (الاختيار كان على 2024-11 → 2026-11)
  oos: { from: '2020-01-01', to: '2024-10-31', warmupFrom: '2019-06-01' },
  // فحص الاتساق: نفس مصدر البوت الحي (سبوت Twelve Data)، من بيانات M1 الموجودة في kc-gold-scalping-v1 (قراءة فقط)
  recentM1File: path.join(ROOT, '..', 'kc-gold-scalping-v1', 'data', 'xau-m1.json'),

  // التكاليف الواقعية: سبريد Exness XAUUSDm + انزلاق، و Swap تقديري لكل ليلة (غير مؤكد من الوسيط)
  costs: { spread: 0.24, slippage: 0.1, swapPctPerNight: 0.02 },
  // كما في الاختبارات السابقة (للمقارنة فقط)
  legacy: { spread: 0.35 },
  windows: { backtest: 500, live: 300 }, // عدد الشموع المعطاة للاستراتيجية: الاختبار السابق 500، والبوت الحي 300

  // الحكم على Out-of-Sample (مسجل قبل التشغيل): بالتكاليف الواقعية ونافذة 500
  //  كل إعداد: PF ≥ 1.2 وربح موجب. المجموع: PF ≥ 1.2، وربح موجب، و 3 سنوات رابحة على الأقل من 5
  criteria: { minProfitFactor: 1.2, minPositiveYears: 3 },

  twelveData: { baseUrl: 'https://api.twelvedata.com/time_series', outputsize: 5000, pauseMs: 15000 },
  paths: { root: ROOT, data: path.join(ROOT, 'data'), logs: path.join(ROOT, 'logs') },
};

module.exports = { config };
