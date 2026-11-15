// ساعات سوق الذهب بتوقيت نيويورك (مع التوقيت الصيفي الأمريكي):
//   مغلق من الجمعة 17:00 حتى الأحد 18:00، واستراحة يومية 17:00–18:00 من الإثنين إلى الخميس.
const HOUR = 3600 * 1000;

function nthSunday(year, month, n) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
}
function usDst(ms) {
  const d = new Date(ms);
  const [y, m, day] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
  if (m < 2 || m > 10) return false;
  if (m > 2 && m < 10) return true;
  return m === 2 ? day >= nthSunday(y, 2, 2) : day < nthSunday(y, 10, 1);
}
// ساعة نيويورك كـ Date بقيم UTC (للمقارنة باليوم والساعة)
const nyClock = (ms) => new Date(ms - (usDst(ms) ? 4 : 5) * HOUR);

function marketClosed(ms) {
  const ny = nyClock(ms);
  const day = ny.getUTCDay();
  const h = ny.getUTCHours();
  if (day === 6) return true;
  if (day === 5 && h >= 17) return true;
  if (day === 0 && h < 18) return true;
  return h === 17; // الاستراحة اليومية
}

const toMs = (time) => Date.parse(time.replace(' ', 'T') + 'Z');

module.exports = { usDst, nyClock, marketClosed, toMs };
