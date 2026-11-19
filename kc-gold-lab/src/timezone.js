// توقيت لندن: صيفي (UTC+1) من آخر أحد في مارس 01:00 UTC حتى آخر أحد في أكتوبر 01:00 UTC
function lastSunday(year, month) {
  const d = new Date(Date.UTC(year, month + 1, 0));
  return Date.UTC(year, month, d.getUTCDate() - d.getUTCDay(), 1);
}
function londonOffsetHours(ms) {
  const y = new Date(ms).getUTCFullYear();
  return ms >= lastSunday(y, 2) && ms < lastSunday(y, 9) ? 1 : 0;
}
// {day: 'YYYY-MM-DD', hour, minute} بتوقيت لندن
function london(ms) {
  const d = new Date(ms + londonOffsetHours(ms) * 3600000);
  return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}
const toMs = (t) => Date.parse(t.replace(' ', 'T') + 'Z');
module.exports = { london, londonOffsetHours, toMs };
