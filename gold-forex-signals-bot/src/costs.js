// التكاليف التقديرية لكل صفقة بوحدة R، لعرض النتائج "بعد التكاليف" فقط. لا تغيّر أي إشارة ولا ملف الصفقات.
// نفس أرقام الاختبارات: kc-trend-audit (الذهب)، kc-nasdaq-daily و kc-daily-audit (المؤشرات)، kc-crypto-daily (الكريبتو).
const HOUR = 3600 * 1000;
const SWAP_PCT_PER_NIGHT = 0.02;
const METALS = { 'XAU/USD': { spread: 0.24, slippage: 0.1 }, 'XAG/USD': { spread: 0.07, slippage: 0.01 } };
const INDEX_SPREAD_PCT = { 'NASDAQ 100': 0.007, 'S&P 500': 0.01, 'DOW JONES': 0.02, XLY: 0.05, XLK: 0.05 };
const CRYPTO_ROUND_TRIP_PCT = 2 * (0.1 + 0.05); // رسوم + انزلاق على الدخول والخروج
const INTERVAL_MS = { '1h': HOUR, '4h': 4 * HOUR, '1day': 24 * HOUR };

const ms = (t) => Date.parse(`${String(t).slice(0, 19).replace(' ', 'T')}Z`);

// عدد مرات المرور بـ 21:00 UTC (وقت احتساب الـ Swap عند الوسيط)
function nightsHeld(fromMs, toMs) {
  let n = 0;
  let t = Math.floor(fromMs / (24 * HOUR)) * 24 * HOUR + 21 * HOUR;
  if (t <= fromMs) t += 24 * HOUR;
  for (; t <= toMs; t += 24 * HOUR) n++;
  return n;
}

// التكلفة بالـ R لصفقة مغلقة، أو null إذا لم نعرف تكلفة هذا السوق أو كانت البيانات ناقصة
function costR(t) {
  const risk = Math.abs(t.entry - t.stopLoss);
  if (!(risk > 0) || !t.time || !t.closedAt) return null;
  if (METALS[t.symbol]) {
    const bar = INTERVAL_MS[t.interval] ?? HOUR;
    const nights = nightsHeld(ms(t.time) + bar, ms(t.closedAt) + bar - 1);
    const m = METALS[t.symbol];
    return (m.spread + m.slippage + (t.entry * SWAP_PCT_PER_NIGHT * nights) / 100) / risk;
  }
  if (INDEX_SPREAD_PCT[t.symbol] != null) {
    const nights = Math.round((ms(t.closedAt.slice(0, 10)) - ms(t.time.slice(0, 10))) / (24 * HOUR));
    return (t.entry * (INDEX_SPREAD_PCT[t.symbol] + nights * SWAP_PCT_PER_NIGHT)) / 100 / risk;
  }
  if (t.symbol.endsWith('/USDT')) return (t.entry * CRYPTO_ROUND_TRIP_PCT) / 100 / risk;
  return null;
}

// النتيجة بعد التكاليف، أو null إذا كانت التكلفة غير معروفة
const netR = (t) => {
  const c = costR(t);
  return c == null ? null : t.r - c;
};

// مجموع بعد التكاليف لقائمة صفقات، مع عدد الصفقات التي لم تُحسب تكلفتها
function netTotal(list) {
  let total = 0;
  let unknown = 0;
  for (const t of list) {
    const n = netR(t);
    if (n == null) {
      unknown++;
      total += t.r;
    } else total += n;
  }
  return { total, unknown };
}

module.exports = { costR, netR, netTotal, nightsHeld };
