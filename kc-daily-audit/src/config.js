// KC Daily Audit — الشروط مسجلة قبل أي نتيجة (2026-11-16) ووافق عليها صاحب المشروع. لا تُعدَّل بعد رؤية النتائج.
const path = require('path');
const ROOT = path.join(__dirname, '..');

const config = {
  // (أ) المؤشرات: فترة ثالثة لم تُستعمل أبداً. نفس قواعد وتكاليف kc-nasdaq-daily بدون أي تعديل، تشغيل مرة واحدة.
  indices: {
    dataFrom: '1984-01-01', // ما قبل البداية لتسخين متوسط 200 يوم فقط
    from: '1985-10-01',
    to: '2004-12-31',
    // النجاح: كل مؤشر PF ≥ 1.2 وصافي موجب بعد التكاليف
    criteria: { minProfitFactor: 1.2 },
    // حماية جودة البيانات: إذا كانت أكثر من 5% من الشموع بلا مدى حقيقي (القمة = القاع) فنتيجة المؤشر غير موثوقة ولا يُحكم عليها
    maxFlatShare: 0.05,
    bucketYears: 5,
  },
  // (ب) أثر نافذة البوت الحي (300 شمعة) مقارنة بالاختبار
  windows: { live: 300, cryptoTest: 500 },
  crypto: {
    pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'],
    dataFrom: '2017-08-17',
    // نفس شروط kc-crypto-daily، تُطبَّق على نافذة 300 على كل الفترة (ليست Out-of-Sample)
    criteria: { minPositivePairs: 3, minProfitFactor: 1.2, minTrades: 30 },
  },
  paths: { data: path.join(ROOT, 'data'), logs: path.join(ROOT, 'logs') },
};

module.exports = { config };
