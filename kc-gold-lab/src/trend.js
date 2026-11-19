// فلتر الاتجاه: إغلاق اليوم السابق مقابل متوسط آخر N إغلاقات يومية (حتى اليوم السابق، شاملاً)
function trendByDay(days, n) {
  const closes = days.map((d) => d.bars.at(-1).close);
  const out = new Map();
  for (let i = 1; i < days.length; i++) {
    if (i < n) continue;
    const window = closes.slice(i - n, i);
    const avg = window.reduce((s, x) => s + x, 0) / n;
    const y = closes[i - 1];
    out.set(days[i].day, y > avg ? 1 : y < avg ? -1 : 0);
  }
  return out;
}
module.exports = { trendByDay };
