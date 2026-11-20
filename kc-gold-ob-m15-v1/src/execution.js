// التنفيذ على شموع M1. البيانات Mid، فنبني منها: Ask = Mid + السبريد ÷ 2، و Bid = Mid − السبريد ÷ 2.
// الشراء: الدخول على Ask، والوقف والهدف و +1R على Bid. البيع: الدخول على Bid، والخروج على Ask.
// السبريد داخل أسعار التنفيذ ولا يُخصم مرة ثانية. الانزلاق والعمولة يُخصمان مرة واحدة لكل صفقة. Swap لكل عبور 21:00 UTC.
const { nightsHeld } = require('./time');

const EPS = 1e-9;
const costTotal = (costs) => costs.spread + costs.slippage + costs.commission;

// سعر الدخول الفعلي ومسافة الوقف ونسبة التكلفة إلى المخاطرة
function entryPlan(side, midOpen, stop, costs) {
  const entry = midOpen + (side * costs.spread) / 2;
  const dist = side > 0 ? entry - stop : stop - entry;
  return { entry, dist, costPct: dist > 0 ? (costTotal(costs) / dist) * 100 : Infinity };
}
const passesCostFilter = (costPct, maxPct) => costPct <= maxPct + EPS;

// الحجم بالأونصة من 0.5% من الرصيد الحالي ومسافة الوقف (حجم مستمر بدون تقريب للوت)
const riskUsd = (equity, riskPct) => (equity * riskPct) / 100;
const unitsFor = (risk, dist) => risk / dist;

// الربح أو الخسارة بالدولار
//  شراء: الحجم × (سعر الخروج Bid − سعر الدخول Ask) − الحجم × (الانزلاق + العمولة) − Swap
//  بيع:  الحجم × (سعر الدخول Bid − سعر الخروج Ask) − الحجم × (الانزلاق + العمولة) − Swap
//  Swap = الحجم × سعر الدخول × (النسبة ÷ 100) × عدد مرات عبور 21:00 UTC (فرضية: تكلفة على الشراء والبيع معاً)
function pnlUsd({ side, units, entry, exit, nights, costs }) {
  const gross = side > 0 ? units * (exit - entry) : units * (entry - exit);
  const fixed = units * (costs.slippage + costs.commission);
  const swap = units * entry * (costs.swapPctPerNight / 100) * nights;
  return { gross, fixed, swap, net: gross - fixed - swap };
}

// محاكاة صفقة من شمعة M1 رقم k0 (الدخول عند افتتاحها). الترتيب داخل الدقيقة (محافظ وموحد):
//  ① الفجوة خلف الوقف عند الافتتاح → الخروج بسعر الافتتاح، ② الوقف الحالي، ③ الهدف (بسعر الهدف حتى لو كانت فجوة)،
//  ④ +1R ينقل الوقف لسعر الدخول ابتداءً من الدقيقة التالية.
function simulate(m1, k0, side, stop, costs, rules) {
  const half = costs.spread / 2;
  const entry = m1.o[k0] + side * half;
  const dist = side > 0 ? entry - stop : stop - entry;
  const tp = entry + side * rules.rr * dist;
  const beTrigger = entry + side * rules.beAtR * dist;
  let sl = stop;
  let beFrom = Infinity;
  const n = m1.t.length;
  for (let k = k0; k < n; k++) {
    if (k >= beFrom) sl = entry;
    // أسعار الخروج: الشراء على Bid (Mid − half)، والبيع على Ask (Mid + half)
    const o = m1.o[k] - side * half;
    const hi = m1.h[k] - side * half;
    const lo = m1.l[k] - side * half;
    const adverse = side > 0 ? lo : hi;
    const favorable = side > 0 ? hi : lo;
    const beyond = (x, level) => (side > 0 ? x <= level : x >= level);
    const reached = (x, level) => (side > 0 ? x >= level : x <= level);
    const outcome = sl === entry ? 'BE' : 'SL';
    if (k > k0 && beyond(o, sl)) return done(k, o, outcome);
    if (beyond(adverse, sl)) return done(k, sl, outcome);
    if (reached(favorable, tp)) return done(k, tp, 'TP');
    if (beFrom === Infinity && reached(favorable, beTrigger)) beFrom = k + 1;
  }
  return done(n - 1, m1.c[n - 1] - side * half, 'END'); // نهاية البيانات: إغلاق بآخر سعر
  function done(k, exit, outcome) {
    return { k0, kExit: k, entryTime: m1.t[k0], exitTime: m1.t[k], entry, stop, tp, dist, exit, outcome, beMoved: beFrom <= k };
  }
}

// صفقة كاملة بالدولار والـ R
function closeTrade(sim, side, equity, costs, riskPct) {
  const risk = riskUsd(equity, riskPct);
  const units = unitsFor(risk, sim.dist);
  const nights = nightsHeld(sim.entryTime, sim.exitTime);
  const p = pnlUsd({ side, units, entry: sim.entry, exit: sim.exit, nights, costs });
  return { ...sim, side, risk, units, nights, swapUsd: p.swap, fixedUsd: p.fixed, pnl: p.net, r: p.net / risk, equityBefore: equity, equityAfter: equity + p.net, costPct: (costTotal(costs) / sim.dist) * 100 };
}

module.exports = { entryPlan, passesCostFilter, riskUsd, unitsFor, pnlUsd, simulate, closeTrade, costTotal };
