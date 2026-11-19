// المحاكاة: من الشمعة التالية للدخول. الوقف أولاً عند التعارض. الخروج بالوقت عند إغلاق آخر شمعة قبل 16:00 لندن.
const { config } = require('./config');
const { london } = require('./timezone');
const { tradeCost } = require('./costs');

function simulate(bars, sigs, { spreadMult = 1, exitHour = config.rule.exitHour } = {}) {
  const idx = new Map(bars.map((b, i) => [b.ms, i]));
  const cost = tradeCost(spreadMult);
  const out = [];
  for (const s of sigs) {
    let i = idx.get(s.ms) + 1;
    let exit = null;
    let how = null;
    let at = null;
    for (; i < bars.length; i++) {
      const b = bars[i];
      const t = london(b.ms);
      if (t.day !== s.day || t.hour >= exitHour) {
        [exit, how, at] = [bars[i - 1].close, 'وقت', bars[i - 1].time];
        break;
      }
      const stopHit = s.dir === 1 ? b.low <= s.stop : b.high >= s.stop;
      const targetHit = s.dir === 1 ? b.high >= s.target : b.low <= s.target;
      if (stopHit) {
        [exit, how, at] = [s.dir === 1 ? Math.min(s.stop, b.open) : Math.max(s.stop, b.open), 'وقف', b.time];
        break;
      }
      if (targetHit) {
        [exit, how, at] = [s.target, 'هدف', b.time];
        break;
      }
    }
    if (exit === null) continue; // نهاية البيانات
    out.push({ day: s.day, year: s.day.slice(0, 4), time: s.time, exitTime: at, dir: s.dir, how, r: (s.dir * (exit - s.entry) - cost) / s.risk });
  }
  return out;
}

function metrics(list) {
  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const t of list) {
    eq += t.r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  const wins = list.filter((t) => t.r > 0);
  const gw = wins.reduce((s, t) => s + t.r, 0);
  const gl = -list.filter((t) => t.r < 0).reduce((s, t) => s + t.r, 0);
  return { n: list.length, winRate: list.length ? (wins.length / list.length) * 100 : 0, pf: gl ? gw / gl : list.length && gw > 0 ? Infinity : 0, net: eq, maxDd: dd, exp: list.length ? eq / list.length : 0 };
}

module.exports = { simulate, metrics };
