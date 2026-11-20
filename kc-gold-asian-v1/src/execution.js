// التنفيذ على شموع M15. البيانات Mid: Ask = Mid + السبريد ÷ 2، و Bid = Mid − السبريد ÷ 2.
// الشراء يدخل على Ask ويخرج على Bid، والبيع يدخل على Bid ويخرج على Ask. السبريد داخل الأسعار، والانزلاق يُخصم مرة واحدة.
const { londonDay, londonHour } = require('./time');

const M15 = 15 * 60000;

// R للشراء والبيع بشكل منفصل
function rOf(side, entry, exit, dist, slippage) {
  return side > 0 ? (exit - entry - slippage) / dist : (entry - exit - slippage) / dist;
}

// صفقة من إشارة: الدخول بافتتاح الشمعة التالية مباشرة في نفس يوم لندن. يعيد { skip } أو الصفقة.
function execute(bars, sig, rule, costs) {
  const k0 = sig.i + 1;
  if (k0 >= bars.t.length || bars.t[k0] !== bars.t[sig.i] + M15 || londonDay(bars.t[k0]) !== sig.day || londonHour(bars.t[k0]) >= rule.exitHour) return { skip: 'gap' };
  const side = sig.side;
  const half = costs.spread / 2;
  const entry = bars.o[k0] + side * half;
  const dist = side > 0 ? entry - sig.stop : sig.stop - entry;
  if (!(dist > 0)) return { skip: 'beyondStop' };
  const tp = entry + side * rule.rr * dist;
  const beyond = (x) => (side > 0 ? x <= sig.stop : x >= sig.stop);
  const reached = (x) => (side > 0 ? x >= tp : x <= tp);
  let exit = null;
  let how = null;
  let k = k0;
  for (; k < bars.t.length; k++) {
    // الخروج بالوقت: الشمعة k في يوم آخر أو تبدأ عند 16:00 لندن أو بعدها → إغلاق الشمعة السابقة
    if (londonDay(bars.t[k]) !== sig.day || londonHour(bars.t[k]) >= rule.exitHour) {
      k--;
      exit = bars.c[k] - side * half;
      how = 'time';
      break;
    }
    const o = bars.o[k] - side * half;
    const adverse = (side > 0 ? bars.l[k] : bars.h[k]) - side * half;
    const favorable = (side > 0 ? bars.h[k] : bars.l[k]) - side * half;
    if (k > k0 && beyond(o)) {
      [exit, how] = [o, 'stop'];
      break;
    }
    if (beyond(adverse)) {
      [exit, how] = [sig.stop, 'stop'];
      break;
    }
    if (reached(favorable)) {
      [exit, how] = [tp, 'target'];
      break;
    }
  }
  if (exit === null) {
    // نهاية البيانات داخل اليوم: إغلاق بآخر سعر
    k = bars.t.length - 1;
    exit = bars.c[k] - side * half;
    how = 'end';
  }
  const r = rOf(side, entry, exit, dist, costs.slippage);
  return { day: sig.day, side, entryTime: bars.t[k0], exitTime: bars.t[k], entry, stop: sig.stop, tp, dist, exit, how, r, range: sig.range.size, costPct: ((costs.spread + costs.slippage) / dist) * 100 };
}

// كل الصفقات مع الرصيد بالدولار (0.5% من الرصيد الحالي، للمعلومة)
function runTrades(bars, sigs, rule, costs, risk) {
  const trades = [];
  const skipped = { gap: 0, beyondStop: 0 };
  let equity = risk.startEquity;
  for (const s of sigs) {
    const t = execute(bars, s, rule, costs);
    if (t.skip) {
      skipped[t.skip]++;
      continue;
    }
    const riskUsd = (equity * risk.riskPct) / 100;
    t.equityBefore = equity;
    t.pnl = t.r * riskUsd;
    equity += t.pnl;
    t.equityAfter = equity;
    trades.push(t);
  }
  return { trades, skipped, equity };
}

module.exports = { execute, runTrades, rOf };
