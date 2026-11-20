// الاختبار التاريخي: آلة الحالة على M15 (الإشارات) + التنفيذ على M1. صفقة واحدة مفتوحة، و 3 خسائر متتالية توقف يوم لندن.
const { aggregate, closeTime } = require('./bars');
const { atr: atrOf, ema } = require('./indicators');
const { createStrategy } = require('./strategy');
const { entryPlan, passesCostFilter, simulate, closeTrade } = require('./execution');
const { session } = require('./time');
const { createGate } = require('./gate');

// الاتجاه عند إغلاق M15 رقم i: آخر شمعة H1 مغلقة (إغلاقها ≤ وقت القرار)، إغلاقها مقابل EMA 200 لنفس الشمعة
function trendFn(m15, h1, emaLen) {
  const e = ema(h1.c, emaLen);
  return (i) => {
    const T = closeTime(m15, i);
    // بحث ثنائي عن آخر H1 مغلقة
    let lo = 0;
    let hi = h1.t.length - 1;
    let k = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (closeTime(h1, mid) <= T) {
        k = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (k < 0 || !Number.isFinite(e[k])) return 0;
    return h1.c[k] > e[k] ? 1 : h1.c[k] < e[k] ? -1 : 0;
  };
}

function backtest(m1, { rules, risk, costs, costFilterPct, hooks = {} }) {
  const m15 = aggregate(m1, 15);
  const h1 = aggregate(m1, 60);
  const atr = atrOf(m15, rules.atrLen);
  const trendAt = hooks.trendAt ?? trendFn(m15, h1, rules.emaLen); // hooks للاختبارات فقط
  const strat = createStrategy(m15, { atr, trendAt, rules });
  const funnel = { signals: 0, position: 0, gap: 0, session: 0, dailyLimit: 0, beyondStop: 0, cost: 0, taken: 0 };
  const rejectedCostPct = [];
  const trades = [];
  let equity = risk.startEquity;
  const gate = createGate(rules);

  for (let i = 0; i < m15.t.length; i++) {
    const cands = strat.step(i);
    for (const cand of cands) {
      funnel.signals++;
      const T = closeTime(m15, i);
      if (gate.check(T) === 'position') {
        funnel.position++;
        continue;
      }
      // الدخول عند افتتاح شمعة M15 التالية مباشرة (يجب أن تبدأ عند T)
      if (i + 1 >= m15.t.length || m15.t[i + 1] !== T) {
        funnel.gap++;
        continue;
      }
      const sess = session(T, rules.sessions);
      if (!sess) {
        funnel.session++;
        continue;
      }
      if (gate.check(T) === 'dailyLimit') {
        funnel.dailyLimit++;
        continue;
      }
      const side = cand.side;
      const stop = side > 0 ? cand.ob.lo - rules.slBufferAtr * cand.atr : cand.ob.hi + rules.slBufferAtr * cand.atr;
      const k0 = m15.first[i + 1];
      const plan = entryPlan(side, m1.o[k0], stop, costs);
      if (!(plan.dist > 0)) {
        funnel.beyondStop++;
        continue;
      }
      if (!passesCostFilter(plan.costPct, costFilterPct)) {
        funnel.cost++;
        rejectedCostPct.push(plan.costPct);
        continue;
      }
      const sim = simulate(m1, k0, side, stop, costs, rules);
      const t = closeTrade(sim, side, equity, costs, risk.riskPct);
      Object.assign(t, { session: sess, pattern: cand.pattern, obTime: m15.t[cand.ob.k], bosTime: m15.t[cand.ob.b], signalTime: m15.t[i], touch: cand.ob.touches });
      trades.push(t);
      equity = t.equityAfter;
      gate.onEntry(t.exitTime);
      gate.onExit(t.exitTime, t.outcome);
      strat.consume(cand.ob);
      funnel.taken++;
      break; // صفقة واحدة فقط
    }
  }
  return { trades, funnel, rejectedCostPct, structure: strat.log, equity, m15Count: m15.t.length, h1Count: h1.t.length };
}

module.exports = { backtest, trendFn };
