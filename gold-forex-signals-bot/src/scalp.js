// استراتيجية سكالب: اختراق نطاق افتتاح الجلسة (Opening Range Breakout).
//   - النطاق = أعلى سعر وأدنى سعر في أول ساعة من الجلسة (بتوقيت UTC)
//   - بعدها، أول شمعة تغلق فوق النطاق = شراء، وتحته = بيع. صفقة واحدة فقط في اليوم لكل جلسة
//   - وقف الخسارة في منتصف النطاق، والهدفان 1 × و 2 × المخاطرة
// تحتاج شموعاً بتوقيت UTC (الخيار timezone: 'UTC' في fetchCandles).

const SESSIONS = {
  london: { rangeStart: 7, rangeEnd: 8, tradeUntil: 12 },
  newyork: { rangeStart: 13, rangeEnd: 14, tradeUntil: 17 },
};

// "2026-10-30 14:15:00" -> { day: '2026-10-30', hour: 14.25 }
function clock(time) {
  const [day, hms = '00:00:00'] = time.split(' ');
  const [h, m] = hms.split(':').map(Number);
  return { day, hour: h + m / 60 };
}

function analyzeSessionBreakout(candles, options = {}) {
  const opts = { ...SESSIONS.london, tp1R: 1, tp2R: 2, ...options };
  const i = candles.length - 1;
  if (i < 1) return null;
  const now = clock(candles[i].time);
  if (now.hour < opts.rangeEnd || now.hour >= opts.tradeUntil) return null;

  let high = -Infinity;
  let low = Infinity;
  let rangeCandles = 0;
  let brokeEarlier = false;
  for (let k = i - 1; k >= 0; k--) {
    const t = clock(candles[k].time);
    if (t.day !== now.day) break;
    if (t.hour >= opts.rangeStart && t.hour < opts.rangeEnd) {
      high = Math.max(high, candles[k].high);
      low = Math.min(low, candles[k].low);
      rangeCandles++;
    }
  }
  if (rangeCandles < 2) return null;

  // هل أغلقت شمعة سابقة اليوم خارج النطاق؟ إذن الاختراق حدث من قبل ولا ندخل مرة ثانية
  for (let k = i - 1; k >= 0; k--) {
    const t = clock(candles[k].time);
    if (t.day !== now.day || t.hour < opts.rangeEnd) break;
    if (candles[k].close > high || candles[k].close < low) brokeEarlier = true;
  }
  if (brokeEarlier) return null;

  const c = candles[i];
  const side = c.close > high ? 'BUY' : c.close < low ? 'SELL' : null;
  if (!side) return null;

  const dir = side === 'BUY' ? 1 : -1;
  const stopLoss = (high + low) / 2;
  const risk = dir * (c.close - stopLoss);
  if (!(risk > 0)) return null;
  return {
    side,
    time: c.time,
    entry: c.close,
    stopLoss,
    takeProfit1: c.close + dir * risk * opts.tp1R,
    takeProfit2: c.close + dir * risk * opts.tp2R,
    zone: { top: high, bottom: low },
  };
}

const londonBreakout = (candles) => analyzeSessionBreakout(candles, SESSIONS.london);
const newYorkBreakout = (candles) => analyzeSessionBreakout(candles, SESSIONS.newyork);

module.exports = { analyzeSessionBreakout, londonBreakout, newYorkBreakout, SESSIONS };
