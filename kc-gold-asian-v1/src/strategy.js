// القواعد: نطاق آسيا + فلتر SMA20 اليومي (أيام لندن) + أول اختراق متوافق في [08:00، 12:00) لندن. صفقة واحدة في اليوم.
// bars: { t: [ms بداية الشمعة]، o، h، l، c } لشموع M15 مرتبة. كل قرار عند إغلاق الشمعة i يستعمل الشموع 0..i فقط.
const { londonDay, londonHour } = require('./time');

// تقسيم الشموع إلى أيام لندن (الشموع القليلة مساء الأحد تكوّن يوماً قصيراً، كما في الكود الأصلي)
function londonDays(bars) {
  const days = [];
  for (let i = 0; i < bars.t.length; i++) {
    const day = londonDay(bars.t[i]);
    if (!days.length || days[days.length - 1].day !== day) days.push({ day, from: i, to: i });
    else days[days.length - 1].to = i;
  }
  return days;
}

// الاتجاه لليوم d: إغلاق اليوم السابق مقابل متوسط آخر n إغلاقات حتى اليوم السابق شاملاً (+1، −1، 0، أو null قبل توفر n أيام)
function trendFor(days, bars, d, n) {
  if (d < n) return null;
  let sum = 0;
  for (let k = d - n; k < d; k++) sum += bars.c[days[k].to];
  const avg = sum / n;
  const y = bars.c[days[d - 1].to];
  return y > avg ? 1 : y < avg ? -1 : 0;
}

// نطاق آسيا: أعلى وأدنى سعر للشموع التي تبدأ في [from، to) لندن، أو null إذا كانت أقل من minBars
function asianRange(bars, day, rule) {
  let n = 0;
  let high = -Infinity;
  let low = Infinity;
  for (let i = day.from; i <= day.to; i++) {
    const h = londonHour(bars.t[i]);
    if (h < rule.asian.from || h >= rule.asian.to) continue;
    n++;
    if (bars.h[i] > high) high = bars.h[i];
    if (bars.l[i] < low) low = bars.l[i];
  }
  if (n < rule.minAsianBars) return null;
  return { high, low, size: high - low, bars: n };
}

const stopFor = (side, r, stopFrac) => (side > 0 ? r.high - stopFrac * r.size : r.low + stopFrac * r.size);

// الإشارات وسجل الأيام. كل إشارة: { day, i (شمعة الاختراق)، side، stop، range }
function signals(bars, rule) {
  const days = londonDays(bars);
  const out = [];
  const log = { days: days.length, noTrend: 0, noRange: 0, tooSmall: 0, tooBig: 0, noBreak: 0, counterIgnored: 0, signals: 0, byYear: {} };
  const year = (d) => (log.byYear[d.slice(0, 4)] ??= { days: 0, tooSmall: 0, tooBig: 0, noRange: 0, signals: 0 });
  for (let d = 0; d < days.length; d++) {
    const day = days[d];
    const dir = trendFor(days, bars, d, rule.trendDays);
    const y = year(day.day);
    y.days++;
    if (!dir) {
      log.noTrend++;
      continue;
    }
    const r = asianRange(bars, day, rule);
    if (!r) {
      log.noRange++;
      y.noRange++;
      continue;
    }
    if (r.size < rule.minRange - 1e-9) {
      log.tooSmall++;
      y.tooSmall++;
      continue;
    }
    if (r.size > rule.maxRange + 1e-9) {
      log.tooBig++;
      y.tooBig++;
      continue;
    }
    let found = false;
    let ignored = false;
    for (let i = day.from; i <= day.to; i++) {
      const h = londonHour(bars.t[i]);
      if (h < rule.entry.from || h >= rule.entry.to) continue;
      const side = bars.c[i] > r.high ? 1 : bars.c[i] < r.low ? -1 : 0;
      if (!side) continue;
      if (side !== dir) {
        ignored = true; // الاختراق المخالف يُتجاهل ونستمر في الانتظار
        continue;
      }
      out.push({ day: day.day, dayIdx: d, i, side, stop: stopFor(side, r, rule.stopFrac), range: r });
      found = true;
      break; // صفقة واحدة في اليوم
    }
    if (ignored) log.counterIgnored++;
    if (found) {
      log.signals++;
      y.signals++;
    } else log.noBreak++;
  }
  return { signals: out, days, log };
}

module.exports = { londonDays, trendFor, asianRange, stopFor, signals };
