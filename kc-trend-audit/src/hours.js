// ساعات سوق الذهب بتوقيت نيويورك (مع التوقيت الصيفي): مغلق من الجمعة 17:00 حتى الأحد 18:00، واستراحة يومية 17:00–18:00
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
function marketClosed(ms) {
  const ny = new Date(ms - (usDst(ms) ? 4 : 5) * HOUR);
  const day = ny.getUTCDay();
  const h = ny.getUTCHours();
  if (day === 6 || (day === 5 && h >= 17) || (day === 0 && h < 18)) return true;
  return h === 17;
}
const toMs = (t) => Date.parse(t.replace(' ', 'T') + 'Z');
const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
module.exports = { marketClosed, toMs, fmt, HOUR };
