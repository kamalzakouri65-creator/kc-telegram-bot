// أدوات الاختبار: أيام لندن مصنوعة يدوياً بشموع M15
const { config } = require('../src/config');

const U = (s) => Date.parse(s + 'Z');
const M15 = 15 * 60000;
const pad = (n) => String(n).padStart(2, '0');

// يوم مستهدف في يناير (لندن = UTC) أو أي تاريخ مع إزاحة لندن utcOffset (0 شتاءً، 1 صيفاً)
// trend: +1 أو −1 (21 يوماً سابقاً بإغلاقات صاعدة أو هابطة)، asian: [أدنى، أعلى]، bars: { 'HH:MM': [o,h,l,c] } بتوقيت لندن
function scenario({ date = '2026-01-14', utcOffset = 0, trend = 1, asian = [1990, 2000], bars = {}, histDays = 21, asianCount = 32, fill = null } = {}) {
  const out = { t: [], o: [], h: [], l: [], c: [] };
  const push = (ms, [o, h, l, c]) => {
    out.t.push(ms);
    out.o.push(o);
    out.h.push(h);
    out.l.push(l);
    out.c.push(c);
  };
  const day0 = U(`${date}T00:00:00`) - utcOffset * 3600000; // منتصف ليل لندن
  // أيام سابقة: شمعة واحدة 12:00 لندن، والإغلاق الأخير (أمس) فوق المتوسط أو تحته بوضوح
  for (let k = histDays; k >= 1; k--) {
    const p = 1995 + trend * (histDays - k) * 0.5;
    push(day0 - k * 86400000 + 12 * 3600000, [p, p + 0.2, p - 0.2, p]);
  }
  const mid = (asian[0] + asian[1]) / 2;
  for (let k = 0; k < asianCount; k++) {
    const hi = k === 3 ? asian[1] : mid + 1;
    const lo = k === 7 ? asian[0] : mid - 1;
    push(day0 + k * M15, [mid, hi, lo, mid]);
  }
  // من 08:00 حتى 16:45 لندن: شموع ثابتة عند المنتصف (أو عند fill بعد 08:15) ما لم تُحدد
  for (let m = 8 * 60; m < 17 * 60; m += 15) {
    const key = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    const f = fill ?? mid;
    push(day0 + m * 60000, bars[key] ?? (m < 8 * 60 + 15 || fill === null ? [mid, mid, mid, mid] : [f, f, f, f]));
  }
  return out;
}
const RULE = config.rule;
const ZERO = { spread: 0, slippage: 0 };
module.exports = { U, M15, scenario, RULE, ZERO };
