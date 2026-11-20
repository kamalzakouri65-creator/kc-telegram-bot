// GOLD ORDER BLOCK M15 V1 — مشروع مستقل: لا يستورد أي ملف من البوت أو المشاريع الأخرى.
// القواعد مسجلة مسبقاً في docs/SPEC.md ووافق عليها صاحب المشروع قبل البرمجة (2026-11-20). لا Optimization قبل مراجعة الـ Baseline.
const path = require('path');
const ROOT = path.join(__dirname, '..');

const config = {
  symbol: 'XAU/USD',
  months: 24, // نحاول 24 شهراً، وإذا لم تتوفر نستعمل كل المتاح ونذكر المدة الفعلية
  rules: {
    pivot: 2, // شمعتان كل جانب
    atrLen: 14, // ATR(14) على M15 (Wilder)
    emaLen: 200, // EMA 200 على H1
    dispAtr: 1.0, // جسم شمعة الكسر ≥ 1.0 × ATR
    maxAge: 48, // عمر OB الأقصى بشموع M15 بعد شمعة الكسر
    maxTouches: 2,
    slBufferAtr: 0.1,
    rr: 2, // الهدف 2R
    beAtR: 1, // التعادل عند +1R
    maxConsecLossesPerDay: 3, // يوم لندن
    sessions: { london: { from: 8, to: 16 }, ny: { from: 8, to: 16 } }, // بالتوقيت المحلي لكل مدينة
  },
  risk: { startEquity: 1000, riskPct: 0.5 },
  // دولار لكل أونصة. السبريد داخل أسعار التنفيذ (Bid/Ask صناعيان من Mid)، والانزلاق والعمولة تُخصم مرة واحدة لكل صفقة.
  costs: {
    base: { name: 'التكاليف الأساسية (XM: سبريد 0.52 + انزلاق 0.10)', spread: 0.52, slippage: 0.1, commission: 0, swapPctPerNight: 0.02 },
    doubled: { name: 'ضعف السبريد (1.04 + انزلاق 0.10)', spread: 1.04, slippage: 0.1, commission: 0, swapPctPerNight: 0.02 },
    exnessZero: { name: 'Exness Zero للمعلومة (0.06 + عمولة 0.07 + انزلاق 0.10)', spread: 0.06, slippage: 0.1, commission: 0.07, swapPctPerNight: 0.02 },
  },
  costFilterPct: 10, // تُرفض الصفقة إذا كانت التكلفة (سبريد + انزلاق + عمولة) أكثر من 10% من مسافة الوقف
  split: { dev: 0.6, val: 0.2 }, // والباقي 20% Out-of-Sample
  verdict: { minOosTrades: 30, minPf: 1.2, doubledMinPf: 1.0 },
  twelveData: { baseUrl: 'https://api.twelvedata.com/time_series', outputsize: 5000, pauseMs: 15000, maxPages: 160 },
  paths: {
    root: ROOT,
    data: path.join(ROOT, 'data'),
    reports: path.join(ROOT, 'reports'),
    // الملف الأصلي: قراءة فقط، لا يُكتب فيه أبداً
    sourceM1: path.join(ROOT, '..', 'kc-gold-scalping-v1', 'data', 'xau-m1.json'),
    botEnv: path.join(ROOT, '..', 'gold-forex-signals-bot', '.env'),
  },
};

module.exports = { config };
