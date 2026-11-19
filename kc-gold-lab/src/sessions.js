// تقسيم شموع 15 دقيقة إلى أيام لندن، مع نطاق آسيا والإغلاق اليومي
const { london } = require('./timezone');

function byLondonDay(bars) {
  const days = new Map();
  for (const b of bars) {
    const t = london(b.ms);
    const h = t.hour + t.minute / 60;
    if (!days.has(t.day)) days.set(t.day, []);
    days.get(t.day).push({ ...b, lh: h });
  }
  return [...days.entries()].map(([day, list]) => ({ day, bars: list }));
}

// نطاق آسيا لليوم: أعلى وأدنى سعر في [from، to) بتوقيت لندن، أو null إذا كانت الشموع أقل من النصف
function asianRange(dayBars, { from, to }) {
  const list = dayBars.filter((b) => b.lh >= from && b.lh < to);
  if (list.length < ((to - from) * 4) / 2) return null;
  const high = Math.max(...list.map((b) => b.high));
  const low = Math.min(...list.map((b) => b.low));
  return { high, low, size: high - low };
}

module.exports = { byLondonDay, asianRange };
