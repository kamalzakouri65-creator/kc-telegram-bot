// الفكرة 1: أول شمعة 15 دقيقة تُغلق خارج نطاق آسيا في نافذة الدخول، في اتجاه الفلتر. صفقة واحدة في اليوم.
const { config } = require('./config');
const { byLondonDay, asianRange } = require('./sessions');
const { trendByDay } = require('./trend');

function signals(bars, rule = config.rule) {
  const days = byLondonDay(bars);
  const trend = trendByDay(days, rule.trendDays);
  const out = [];
  for (const { day, bars: list } of days) {
    const dir = trend.get(day);
    if (!dir) continue;
    const r = asianRange(list, rule.asian);
    if (!r || r.size < rule.minRange || r.size > rule.maxRange) continue;
    for (const b of list) {
      if (b.lh < rule.entry.from || b.lh >= rule.entry.to) continue;
      const side = b.close > r.high ? 1 : b.close < r.low ? -1 : 0;
      if (!side) continue;
      if (side === dir) {
        const stop = side === 1 ? r.high - rule.stopFrac * r.size : r.low + rule.stopFrac * r.size;
        const risk = side * (b.close - stop);
        if (risk > 0) out.push({ day, ms: b.ms, time: b.time, dir: side, entry: b.close, stop, risk, target: b.close + side * rule.rr * risk });
      }
      break; // أول كسر فقط في اليوم، حتى لو كان عكس الفلتر
    }
  }
  return out;
}
module.exports = { signals };
