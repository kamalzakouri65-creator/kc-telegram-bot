// إعدادات النظام. كل المعاملات ثابتة هنا ولا يوجد أي محسّن يعدّلها على بيانات الاختبار.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// قارئ بسيط لملف .env حتى لا نحتاج أي حزمة خارجية
function loadEnv(file = path.join(ROOT, '.env')) {
  const env = {};
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return env;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const MINUTE = 60 * 1000;

const config = {
  pairs: {
    BTCUSDT: { label: 'BTC/USDT', stepSize: 0.00001, minNotional: 5 },
    ETHUSDT: { label: 'ETH/USDT', stepSize: 0.0001, minNotional: 5 },
  },
  timeframes: { trend: '1h', setup: '15m', entry: '5m' },
  intervalMs: { '1h': 60 * MINUTE, '15m': 15 * MINUTE, '5m': 5 * MINUTE },

  strategy: {
    emaPeriod: 200,
    atrPeriod: 14,
    volumePeriod: 20,
    pivotLength: 2, // القمة/القاع يُؤكد بعد شمعتين
    sweepLookback: 12, // شموع M15 قبل كسر الهيكل نبحث فيها عن سحب السيولة
    displacementAtr: 1.0, // جسم شمعة الاندفاع >= 1 × ATR
    maxBarsAfterBos: 16, // أقصى عدد شموع M15 بين كسر الهيكل والعودة إلى البلوك
    slBufferAtr: 0.1, // هامش الوقف تحت قاع سحب السيولة
    setupExpiryM15: 3, // تنتهي الإشارة بعد 3 شموع M15 دون تأكيد
    breakoutLookback: 3, // تأكيد الاختراق على M5: إغلاق فوق أعلى سعر في آخر 3 شموع
    maxEntryChasePct: 0.15, // منطقة الدخول: حتى 0.15% فوق سعر التأكيد
    rewardRisk: 2, // الهدف بحيث يكون الربح الصافي = 2 × الخسارة الصافية (بعد الرسوم)
    breakEven: false, // نقل الوقف للدخول بعد 1R (اختياري)
    maxRally24hPct: null, // فلتر تجريبي متوقف: لا شراء بعد صعود أكثر من هذه النسبة خلال 24 ساعة (انظر backtest/oos.js)
  },

  risk: {
    initialBalance: 50,
    riskPct: 0.5,
    dailyLossPct: 1,
    maxTradesPerDay: 2,
    maxConsecutiveLosses: 2,
    feeRate: 0.001, // رسوم Binance Spot الافتراضية 0.1% لكل جهة
    slippagePct: 0.02, // انزلاق مفترض على الدخول وعلى الخروج بالوقف
    maxFeeShare: 0.35, // ترفض الإشارة إذا كانت الرسوم أكثر من 35% من الخسارة عند الوقف
  },

  backtest: { trainShare: 0.7, defaultDays: 365 },

  binance: {
    // مضيف Binance العام للبيانات فقط، ولا يقدم أي واجهة تداول
    baseUrl: 'https://data-api.binance.vision',
    klinesLimit: 1000,
  },

  paths: {
    root: ROOT,
    cache: path.join(ROOT, 'data', 'cache'),
    // بيانات خارج العينة في مجلد منفصل حتى لا تختلط بالبيانات التي اكتُشفت منها الفرضية
    cacheOos: path.join(ROOT, 'data', 'cache-oos'),
    journal: path.join(ROOT, 'data', 'journal.json'),
  },
};

module.exports = { config, loadEnv, MINUTE };
