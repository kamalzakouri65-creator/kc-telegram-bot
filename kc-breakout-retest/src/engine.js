// محرك الاختبار التاريخي: يمر على شموع M15 بالترتيب الزمني للعملتين معاً، بحساب واحد مشترك.
// عند كل شمعة يرى فقط الشموع المغلقة حتى وقتها. لا يوجد أي اتصال بمنصة تداول.
const { config: defaults } = require('./config');
const { atr, swings } = require('./indicators');
const { breakoutAt } = require('./zones');

const DAY = 24 * 60 * 60 * 1000;
const dayOf = (t) => Math.floor(t / DAY);

function floorToStep(qty, step) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number((Math.floor(qty / step + 1e-9) * step).toFixed(decimals));
}

// الحجم: المخاطرة ÷ (الدخول − الوقف). لا يُرفع الحجم للحد الأدنى ولا يُصغّر ليناسب الرصيد: تُتخطى الصفقة.
function sizeTrade({ balance, entry, stopLoss, pair, risk }) {
  const riskAmount = balance * (risk.riskPct / 100);
  const qty = floorToStep(riskAmount / (entry - stopLoss), pair.stepSize);
  const notional = qty * entry;
  if (qty <= 0 || notional < pair.minNotional) return { ok: false, reason: `أقل من الحد الأدنى للطلب (${pair.minNotional}$)` };
  if (notional > balance) return { ok: false, reason: 'قيمة الصفقة أكبر من الرصيد' };
  return { ok: true, qty, notional, riskAmount };
}

function prepare(pairData, rules) {
  return {
    h1: pairData.h1,
    m15: pairData.m15,
    atrH1: atr(pairData.h1, rules.atrPeriod),
    atrM15: atr(pairData.m15, rules.atrPeriod),
    swH1: swings(pairData.h1, rules.pivotLength),
    swM15: swings(pairData.m15, rules.pivotLength),
    h1ByClose: new Map(pairData.h1.map((c, i) => [c.closeTime, i])),
  };
}

function runBacktest(data, cfg = defaults, { feeRate = cfg.risk.feeRate } = {}) {
  const rules = cfg.rules;
  const risk = cfg.risk;
  const slip = risk.slippagePct / 100;
  const pairs = Object.keys(data);
  const P = Object.fromEntries(pairs.map((p) => [p, prepare(data[p], rules)]));
  const state = Object.fromEntries(pairs.map((p) => [p, { setup: null, trade: null }]));
  const acct = { balance: risk.initialBalance, day: null, tradesToday: 0, consecutiveLosses: 0 };
  const trades = [];
  const skipped = [];
  const equity = [];

  const skip = (pair, setup, reason, time) => skipped.push({ pair, breakoutTime: setup?.breakout.time, reason, time });

  const closeTrade = (pair, tr, exitPrice, outcome, time) => {
    const fees = feeRate * tr.qty * (tr.entry + exitPrice);
    const pnl = tr.qty * (exitPrice - tr.entry) - feeRate * tr.qty * tr.entry - feeRate * tr.qty * exitPrice;
    acct.balance += pnl;
    acct.consecutiveLosses = pnl < 0 ? acct.consecutiveLosses + 1 : 0;
    const slippageCost = tr.qty * (tr.entry - tr.entry / (1 + slip)) + tr.qty * (exitPrice / (1 - slip) - exitPrice);
    trades.push({ ...tr, exit: exitPrice, exitTime: time, outcome, pnl, r: pnl / tr.riskAmount, fees, slippageCost, balanceAfter: acct.balance });
    equity.push({ time, balance: acct.balance });
    state[pair].trade = null;
  };

  // الخروج: الوقف أولاً إذا لمست الشمعة الوقف والهدف معاً
  const checkExit = (pair, tr, c) => {
    if (c.low <= tr.stopLoss) closeTrade(pair, tr, Math.min(c.open, tr.stopLoss) * (1 - slip), 'stop', c.closeTime);
    else if (c.high >= tr.takeProfit) closeTrade(pair, tr, Math.max(c.open, tr.takeProfit) * (1 - slip), 'target', c.closeTime);
  };

  const times = [...new Set(pairs.flatMap((p) => data[p].m15.map((c) => c.closeTime)))].sort((a, b) => a - b);
  const pointer = Object.fromEntries(pairs.map((p) => [p, 0]));

  for (const t of times) {
    if (acct.day !== dayOf(t)) Object.assign(acct, { day: dayOf(t), tradesToday: 0, consecutiveLosses: 0 });

    for (const pair of pairs) {
      const d = P[pair];
      while (pointer[pair] < d.m15.length && d.m15[pointer[pair]].closeTime < t) pointer[pair]++;
      const k = pointer[pair];
      if (k >= d.m15.length || d.m15[k].closeTime !== t) continue;
      const c = d.m15[k];
      const st = state[pair];

      // 1. صفقة مفتوحة
      if (st.trade) checkExit(pair, st.trade, c);

      // 2. إعداد ينتظر اختراق قمة شمعة التأكيد
      const setup = st.setup;
      if (setup && setup.confirm) {
        const cf = setup.confirm;
        if (c.closeTime > setup.windowEnd) {
          skip(pair, setup, 'انتهت مهلة 12 ساعة قبل اختراق قمة التأكيد', t);
          st.setup = null;
        } else if (c.high > cf.trigger) {
          st.setup = null;
          const entry = Math.max(c.open, cf.trigger) * (1 + slip);
          const active = pairs.find((p) => state[p].trade);
          let reason = null;
          if (active) reason = `توجد صفقة نشطة (${active})`;
          else if (acct.tradesToday >= risk.maxTradesPerDay) reason = 'تم الوصول لحد صفقتين في اليوم';
          else if (acct.consecutiveLosses >= risk.maxConsecutiveLosses) reason = 'خسارتان متتاليتان: توقف حتى الغد';
          let size = null;
          if (!reason) {
            size = sizeTrade({ balance: acct.balance, entry, stopLoss: cf.stopLoss, pair: cfg.pairs[pair], risk });
            if (!size.ok) reason = size.reason;
          }
          if (reason) skip(pair, setup, reason, t);
          else {
            acct.tradesToday += 1;
            const tr = {
              pair,
              signalTime: cf.time,
              entryTime: c.openTime,
              zone: { level: setup.breakout.zone.level, top: setup.breakout.zone.top, bottom: setup.breakout.zone.bottom, touches: setup.breakout.zone.touches.length },
              breakout: { time: setup.breakout.time, bodyPct: setup.breakout.bodyPct, volumeRatio: setup.breakout.volumeRatio, closeAboveAtr: setup.breakout.closeAboveAtr },
              retest: { touchTime: setup.touchTime, low: setup.retestLow },
              entry,
              stopLoss: cf.stopLoss,
              takeProfit: entry + rules.rewardRisk * (entry - cf.stopLoss),
              qty: size.qty,
              notional: size.notional,
              riskAmount: size.riskAmount,
            };
            st.trade = tr;
            // شمعة الدخول: لمس الوقف يُحسب وقفاً لأننا لا نعرف ترتيب القاع والدخول داخلها
            checkExit(pair, tr, c);
          }
        } else if (c.close < setup.breakout.zone.mid) {
          skip(pair, setup, 'إغلاق M15 تحت منتصف المنطقة قبل الدخول', t);
          st.setup = null;
        } else if (--cf.barsLeft <= 0) {
          skip(pair, setup, 'لم تُخترق قمة التأكيد خلال 4 شموع', t);
          st.setup = null;
        }
      } else if (setup) {
        // 3. انتظار لمس المنطقة ثم شمعة التأكيد
        const z = setup.breakout.zone;
        if (c.closeTime > setup.windowEnd) {
          skip(pair, setup, setup.touchTime ? 'لا توجد شمعة تأكيد خلال 12 ساعة' : 'لم يرجع السعر للمنطقة خلال 12 ساعة', t);
          st.setup = null;
        } else if (c.close < z.mid) {
          skip(pair, setup, 'إغلاق M15 تحت منتصف المنطقة قبل التأكيد', t);
          st.setup = null;
        } else {
          if (!setup.touchTime && c.low <= z.top) setup.touchTime = c.openTime;
          if (setup.touchTime) setup.retestLow = Math.min(setup.retestLow ?? Infinity, c.low);
          const range = c.high - c.low;
          const bullish = c.close > c.open && range > 0 && c.close - c.open >= (rules.confirmBodyPct / 100) * range;
          if (setup.touchTime && bullish) {
            // آخر قاع M15 مؤكد حتى هذه الشمعة، تكوّن بعد بداية شمعة الاختراق
            const lows = d.swM15.lows.filter((s) => s.confirmedAt <= k && d.m15[s.index].openTime >= setup.breakout.time);
            const swing = lows.at(-1);
            if (!swing) {
              skip(pair, setup, 'لا يوجد قاع M15 مؤكد لوضع الوقف', t);
              st.setup = null;
            } else {
              const stopLoss = swing.price - rules.slBufferAtr * d.atrM15[k];
              setup.confirm = { time: c.closeTime, trigger: c.high, stopLoss, barsLeft: rules.entryValidityBars };
            }
          }
        }
      }

      // 4. اختراق جديد عند إغلاق شمعة H1 (الإعداد يبدأ من شمعة M15 التالية)
      const h = d.h1ByClose.get(t);
      if (h !== undefined && !st.setup && !st.trade) {
        const b = breakoutAt(d.h1, d.atrH1, d.swH1.highs, h, rules);
        if (b) st.setup = { breakout: b, windowEnd: b.closeTime + rules.retestHours * 60 * 60 * 1000, touchTime: null, retestLow: null, confirm: null };
      }
    }
  }

  return { trades, skipped, equity, start: times[0], end: times.at(-1), finalBalance: acct.balance, openAtEnd: pairs.filter((p) => state[p].trade).length };
}

module.exports = { runBacktest, sizeTrade, floorToStep };
