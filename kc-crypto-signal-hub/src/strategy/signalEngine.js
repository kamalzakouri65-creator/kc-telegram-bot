// محرك الإشارات: آلة حالات تعمل شمعة M5 بعد شمعة، ويستعملها الاختبار التاريخي والمراقبة الحية معاً.
// يرى عند كل خطوة الشموع المغلقة حتى وقتها فقط (H1 و M15 و M5)، فلا يوجد نظر للمستقبل ولا إعادة رسم.
//
// المراحل:
//   1. عند إغلاق شمعة M15: نبحث عن إعداد (اتجاه H1 صاعد + سحب سيولة + كسر هيكل + بلوك مع اندفاع + عودة للبلوك)
//   2. خلال 3 شموع M15 بعدها: ننتظر تأكيد M5 (ابتلاع أو اختراق) مع فلتر الحجم ← إشارة شراء
//   3. الإشارة صالحة 3 شموع M15: إن لم يدخل السعر منطقة الدخول تنتهي
//   4. بعد الدخول (الافتراضي في المتابعة): الوقف أو الهدف
const { config: defaults } = require('../config');
const { ema, atr, sma } = require('./indicators');
const { pivots, trendAt, bullishBreakAt } = require('./structure');
const { sweepBefore } = require('./liquidity');
const { bullishOrderBlock, firstReturnAt } = require('./orderBlock');
const { m5Confirmation } = require('./confirmations');
const { lastClosedIndex } = require('../data/candles');
const { sizePosition } = require('../risk/positionSizing');
const risk = require('../risk/riskManager');

// المؤشرات تُحسب مرة واحدة على كل الشموع. كلها سببية فقيمتها عند أي شمعة لا تتأثر بما بعدها.
function buildContext({ h1, m15, m5 }, cfg = defaults) {
  const s = cfg.strategy;
  return {
    h1: { c: h1, ema: ema(h1.map((c) => c.close), s.emaPeriod), piv: pivots(h1, s.pivotLength) },
    m15: { c: m15, atr: atr(m15, s.atrPeriod), piv: pivots(m15, s.pivotLength) },
    m5: { c: m5, volSma: sma(m5.map((c) => c.volume), s.volumePeriod) },
  };
}

// حالة كل زوج وحدها، أما حالة المخاطرة فواحدة للحساب كله (الحدود اليومية وإشارة واحدة نشطة تشمل الزوجين)
function createPairState() {
  return { armed: null, signal: null, trade: null, usedSetups: [] };
}

function confidenceOf(setup, volumeRatio) {
  let score = 50;
  if (setup.ob.fvg) score += 15;
  if (setup.ob.displacementAtr >= 1.5) score += 10;
  if (setup.bos.kind === 'CHoCH') score += 10;
  if (volumeRatio >= 1.5) score += 15;
  return { score, label: score >= 80 ? 'عالية' : score >= 65 ? 'متوسطة' : 'عادية' };
}

// إعداد شراء عند إغلاق شمعة M15 رقم m، أو null
function detectSetup(ctx, m, pairKey, cfg = defaults) {
  const s = cfg.strategy;
  const { c, atr: atr15, piv } = ctx.m15;
  const t = c[m].closeTime;

  const h = lastClosedIndex(ctx.h1.c, t);
  if (h < 0 || ctx.h1.ema[h] == null) return null;
  if (!(ctx.h1.c[h].close > ctx.h1.ema[h])) return null;
  if (trendAt(ctx.h1.piv, h) !== 'bullish') return null;
  // فلتر تجريبي (متوقف افتراضياً): لا شراء بعد صعود قوي خلال آخر 24 شمعة H1
  if (s.maxRally24hPct != null && h >= 24) {
    const change = ((ctx.h1.c[h].close - ctx.h1.c[h - 24].close) / ctx.h1.c[h - 24].close) * 100;
    if (change > s.maxRally24hPct) return null;
  }

  let bos = null;
  for (let k = m - 1; k >= Math.max(1, m - s.maxBarsAfterBos) && !bos; k--) bos = bullishBreakAt(c, piv, k);
  if (!bos) return null;

  const sweep = sweepBefore(c, piv, bos.index, s.sweepLookback);
  if (!sweep) return null;
  const ob = bullishOrderBlock(c, atr15, sweep.index, bos.index, s.displacementAtr);
  if (!ob || !firstReturnAt(c, ob, bos.index, m) || !atr15[m]) return null;

  return {
    id: `${pairKey}|${c[ob.index].openTime}|${c[bos.index].openTime}`,
    bos: { kind: bos.kind, level: bos.level, time: c[bos.index].openTime },
    sweep: { level: sweep.sweptLevel, low: sweep.sweepLow, time: c[sweep.index].openTime },
    ob,
    stopLoss: sweep.sweepLow - s.slBufferAtr * atr15[m],
  };
}

const markUsed = (state, id) => {
  state.usedSetups.push(id);
  if (state.usedSetups.length > 500) state.usedSetups.shift();
};

// خطوة واحدة عند إغلاق شمعة M5 رقم i لزوج واحد. تُرجع قائمة أحداث.
function step(ctx, state, riskState, i, pairKey, cfg = defaults) {
  const s = cfg.strategy;
  const r = cfg.risk;
  const fee = r.feeRate;
  const slip = r.slippagePct / 100;
  const m5 = ctx.m5.c;
  const c = m5[i];
  const t = c.closeTime;
  const m15Ms = cfg.intervalMs['15m'];
  const events = [];

  const finishedDay = risk.rollDay(riskState, t);
  if (finishedDay) events.push({ type: 'dayEnd', day: finishedDay, time: t });

  // الإشارة تنتظر دخول السعر منطقة الدخول
  if (state.signal && !state.trade) {
    const sig = state.signal;
    let fill = null;
    if (c.open <= sig.stopLoss) fill = 'invalid';
    else if (c.open <= sig.zoneTop) fill = c.open;
    else if (c.low <= sig.zoneTop) fill = sig.zoneTop;
    if (fill === 'invalid') {
      events.push({ type: 'signalCancelled', signal: sig, reason: 'السعر نزل تحت الوقف قبل الدخول', time: t });
      risk.onCancelled(riskState);
      state.signal = null;
    } else if (fill !== null) {
      state.trade = { ...sig, entry: fill * (1 + slip), filledAt: c.openTime, stop: sig.stopLoss, beMoved: false };
      state.signal = null;
      events.push({ type: 'filled', trade: state.trade, time: t });
    } else if (t >= sig.expiresAt) {
      events.push({ type: 'signalExpired', signal: sig, time: t });
      risk.onCancelled(riskState);
      state.signal = null;
    }
  }

  // الصفقة الافتراضية: الوقف أولاً إذا لمست الشمعة الوقف والهدف معاً (تقدير متحفظ)
  if (state.trade) {
    const tr = state.trade;
    let exit = null;
    let outcome = null;
    if (c.low <= tr.stop) {
      exit = Math.min(c.open, tr.stop) * (1 - slip);
      outcome = tr.beMoved ? 'breakeven' : 'stop';
    } else if (c.high >= tr.takeProfit) {
      exit = Math.max(c.open, tr.takeProfit);
      outcome = 'target';
    }
    if (exit !== null) {
      const pnl = tr.qty * (exit - tr.entry) - tr.qty * tr.entry * fee - tr.qty * exit * fee;
      risk.onClosed(riskState, pnl);
      events.push({ type: 'closed', trade: { ...tr, exit, closedAt: t, outcome, pnl, r: pnl / tr.riskAmount }, time: t });
      state.trade = null;
    } else if (s.breakEven && !tr.beMoved && c.high >= tr.entry + tr.oneR) {
      // من الشمعة التالية: الوقف عند سعر التعادل بعد الرسوم، ولا يُوسّع الوقف أبداً
      tr.stop = Math.max(tr.stop, (tr.entry * (1 + fee)) / (1 - fee));
      tr.beMoved = true;
    }
  }

  // انتظار تأكيد M5 لإعداد قائم
  if (state.armed && !state.signal && !state.trade && t > state.armed.armedAt) {
    const setup = state.armed;
    const conf = m5Confirmation(m5, ctx.m5.volSma, i, s.breakoutLookback);
    if (conf.pattern && conf.volumeOk && c.close > setup.stopLoss) {
      state.armed = null;
      const entryRef = c.close;
      const zoneTop = entryRef * (1 + s.maxEntryChasePct / 100);
      const pair = cfg.pairs[pairKey];
      const limits = risk.canOpen(riskState, r);
      // الحجم والهدف يُحسبان على أسوأ سعر في منطقة الدخول
      const size = sizePosition({ balance: riskState.balance, entry: zoneTop, stopLoss: setup.stopLoss, pair, risk: r, rewardRisk: s.rewardRisk });
      const reasons = [...limits.reasons, ...(size.reasons ?? [])];
      if (reasons.length) {
        events.push({ type: 'rejected', setup, reasons, time: t });
      } else {
        const signal = {
          id: setup.id,
          pair: pairKey,
          time: t,
          zoneBottom: entryRef,
          zoneTop,
          stopLoss: setup.stopLoss,
          takeProfit: size.takeProfit,
          oneR: zoneTop - setup.stopLoss,
          qty: size.qty,
          notional: size.notional,
          riskAmount: size.lossAtStop,
          riskPct: (size.lossAtStop / riskState.balance) * 100,
          netRewardRisk: size.netRewardRisk,
          feesEstimate: size.feesEstimate,
          pattern: conf.pattern,
          volumeRatio: conf.volumeRatio,
          confidence: confidenceOf(setup, conf.volumeRatio),
          structure: setup.bos.kind,
          fvg: Boolean(setup.ob.fvg),
          expiresAt: t + s.setupExpiryM15 * m15Ms,
        };
        risk.onOpened(riskState, setup.id);
        state.signal = signal;
        events.push({ type: 'signal', signal, time: t });
      }
    } else if (t >= setup.expiresAt) {
      state.armed = null;
      events.push({ type: 'setupExpired', setup, time: t });
    }
  }

  // عند إغلاق شمعة M15: البحث عن إعداد جديد
  const m = lastClosedIndex(ctx.m15.c, t);
  if (m >= 0 && ctx.m15.c[m].closeTime === t && !state.armed && !state.signal && !state.trade) {
    const setup = detectSetup(ctx, m, pairKey, cfg);
    if (setup && !state.usedSetups.includes(setup.id)) {
      markUsed(state, setup.id);
      const limits = risk.canOpen(riskState, r);
      if (!limits.ok) events.push({ type: 'rejected', setup, reasons: limits.reasons, time: t });
      else {
        state.armed = { ...setup, armedAt: t, expiresAt: t + s.setupExpiryM15 * m15Ms };
        events.push({ type: 'setup', setup: state.armed, time: t });
      }
    }
  }

  return events;
}

module.exports = { buildContext, createPairState, detectSetup, step, confidenceOf };
