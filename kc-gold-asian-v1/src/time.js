// التوقيت: لندن ونيويورك مع التوقيت الصيفي (قواعد ثابتة، ويتحقق الاختبار 1 منها مقابل Intl).
// لندن: صيفي (UTC+1) من آخر أحد في مارس 01:00 UTC حتى آخر أحد في أكتوبر 01:00 UTC.
// نيويورك: صيفي (UTC−4) من ثاني أحد في مارس 07:00 UTC حتى أول أحد في نوفمبر 06:00 UTC، وإلا UTC−5.
const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;

function lastSunday(year, month) {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}
function nthSunday(year, month, n) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
}
function londonOffset(ms) {
  const y = new Date(ms).getUTCFullYear();
  const start = Date.UTC(y, 2, lastSunday(y, 2), 1);
  const end = Date.UTC(y, 9, lastSunday(y, 9), 1);
  return ms >= start && ms < end ? 1 : 0;
}
function nyOffset(ms) {
  const y = new Date(ms).getUTCFullYear();
  const start = Date.UTC(y, 2, nthSunday(y, 2, 2), 7);
  const end = Date.UTC(y, 10, nthSunday(y, 10, 1), 6);
  return ms >= start && ms < end ? -4 : -5;
}
// ساعة محلية كـ Date بقيم UTC
const londonClock = (ms) => new Date(ms + londonOffset(ms) * HOUR);
const nyClock = (ms) => new Date(ms + nyOffset(ms) * HOUR);
const londonDay = (ms) => londonClock(ms).toISOString().slice(0, 10);
const minuteOfDay = (d) => d.getUTCHours() * 60 + d.getUTCMinutes();

// الجلسة عند لحظة الدخول: 'london' أو 'ny' أو 'overlap' أو null (خارج الجلسات)
function session(ms, sessions) {
  const lo = minuteOfDay(londonClock(ms));
  const ny = minuteOfDay(nyClock(ms));
  const inL = lo >= sessions.london.from * 60 && lo < sessions.london.to * 60;
  const inN = ny >= sessions.ny.from * 60 && ny < sessions.ny.to * 60;
  if (inL && inN) return 'overlap';
  if (inL) return 'london';
  if (inN) return 'ny';
  return null;
}

// سوق الذهب مغلق: من الجمعة 17:00 نيويورك حتى الأحد 18:00 نيويورك، واستراحة يومية 17:00–18:00 نيويورك
function marketClosed(ms) {
  const ny = nyClock(ms);
  const day = ny.getUTCDay();
  const h = ny.getUTCHours();
  if (day === 6 || (day === 5 && h >= 17) || (day === 0 && h < 18)) return true;
  return h === 17;
}

// عدد مرات عبور 21:00 UTC بين الدخول (غير محسوب) والخروج (محسوب)
const ROLL = 21 * HOUR;
const nightsHeld = (entryMs, exitMs) => Math.floor((exitMs - ROLL) / DAY) - Math.floor((entryMs - ROLL) / DAY);

const toMs = (s) => Date.parse(s.replace(' ', 'T') + 'Z');
const fmt = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

module.exports = { MIN, HOUR, DAY, londonOffset, nyOffset, londonClock, nyClock, londonDay, session, marketClosed, nightsHeld, toMs, fmt };
// ساعة لندن كرقم عشري (مثلاً 8.25 = 08:15)
const londonHour = (ms) => {
  const d = londonClock(ms);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
};
module.exports.londonHour = londonHour;
