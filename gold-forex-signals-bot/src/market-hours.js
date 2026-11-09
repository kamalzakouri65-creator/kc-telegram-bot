// أوقات إغلاق الذهب والفوركس في العطلة: من الجمعة 17:00 إلى الأحد 18:00 بتوقيت نيويورك.
// Twelve Data يرسل شموعاً "مجمّدة" في العطلة (مدى ~0.24$ بسعر ثابت)، فتُفسد ATR والوقف. نحذفها هنا.
const HOUR = 3600 * 1000;
const INTERVAL_MS = { '5min': HOUR / 12, '15min': HOUR / 4, '30min': HOUR / 2, '1h': HOUR, '4h': 4 * HOUR };

function nthSunday(year, month, n) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
}
// التوقيت الصيفي الأمريكي: من الأحد الثاني في مارس إلى الأحد الأول في نوفمبر
function usDst(ms) {
  const d = new Date(ms);
  const [y, m, day] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
  if (m < 2 || m > 10) return false;
  if (m > 2 && m < 10) return true;
  return m === 2 ? day >= nthSunday(y, 2, 2) : day < nthSunday(y, 10, 1);
}
// الوقت بتوقيت نيويورك كأنه UTC (للمقارنة باليوم والساعة)
const nyClock = (ms) => new Date(ms - (usDst(ms) ? 4 : 5) * HOUR);

// هل كان السوق مغلقاً طوال مدة الشمعة؟
function closedForWeekend(startMs, durationMs) {
  for (let t = startMs; t < startMs + durationMs; t += 15 * 60 * 1000) {
    const ny = nyClock(t);
    const day = ny.getUTCDay();
    const h = ny.getUTCHours();
    const closed = day === 6 || (day === 5 && h >= 17) || (day === 0 && h < 18);
    if (!closed) return false;
  }
  return true;
}

// time بصيغة 'YYYY-MM-DD HH:MM:SS' بتوقيت UTC
function dropWeekendCandles(candles, interval) {
  const dur = INTERVAL_MS[interval];
  if (!dur) return candles;
  return candles.filter((c) => !closedForWeekend(Date.parse(c.time.replace(' ', 'T') + 'Z'), dur));
}

module.exports = { dropWeekendCandles, closedForWeekend, usDst };
