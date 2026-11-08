// متابعة نتيجة كل إشارة أُرسلت: هل وصلت للهدف 1 أو 2 أو ضربت الوقف.
// تُحسب كما في الاختبار التاريخي: نصف الصفقة عند الهدف 1 ونصف عند الهدف 2،
// وإذا لمست الشمعة الوقف والهدف معاً نعتبر الوقف هو الذي ضُرب.
// الإشارات تُحفظ في ملف حتى لا تضيع عند إعادة تشغيل البوت.
const fs = require('fs');
const path = require('path');

const { DEFAULT_STRATEGY } = require('./strategies');

// معرّف إشارات ema-macd بقي بصيغته القديمة حتى تتطابق الإشارات المحفوظة من قبل
const tradeId = (symbol, interval, signal, strategy = DEFAULT_STRATEGY) =>
  `${symbol}|${interval}|${signal.side}@${signal.time}` + (strategy === DEFAULT_STRATEGY ? '' : `|${strategy}`);

// يطبّق الشموع الجديدة على صفقة مفتوحة ويُرجع ما حدث: tp1 أو tp2 أو sl
function advance(trade, candles) {
  if (trade.exitRule) return advanceExitRule(trade, candles);
  const events = [];
  const dir = trade.side === 'BUY' ? 1 : -1;
  const risk = dir * (trade.entry - trade.stopLoss);
  for (const c of candles) {
    if (trade.closed) break;
    if (c.time <= trade.checkedUntil) continue;
    trade.checkedUntil = c.time;

    const stopHit = dir === 1 ? c.low <= trade.stopLoss : c.high >= trade.stopLoss;
    for (const half of trade.halves) {
      if (half.r !== null) continue;
      const targetHit = dir === 1 ? c.high >= half.target : c.low <= half.target;
      if (stopHit) half.r = -1;
      else if (targetHit) {
        half.r = (dir * (half.target - trade.entry)) / risk;
        if (half === trade.halves[0]) events.push({ type: 'tp1', time: c.time });
      }
    }
    if (trade.halves.every((h) => h.r !== null)) {
      trade.closed = true;
      trade.closedAt = c.time;
      trade.r = trade.halves.reduce((s, h) => s + h.r, 0) / trade.halves.length;
      events.push({ type: stopHit ? 'sl' : 'tp2', time: c.time });
    }
  }
  return events;
}

// صفقات بقاعدة خروج (RSI(2) على المؤشرات): الوقف أولاً، ثم الخروج عند أول إغلاق فوق متوسط N يوم أو بعد عدد أيام.
// فجوة افتتاح تحت الوقف تُغلق بسعر الافتتاح. النتيجة بوحدة R (المخاطرة = الدخول − الوقف).
function advanceExitRule(trade, candles) {
  const events = [];
  const risk = trade.entry - trade.stopLoss;
  const { sma: n, maxBars } = trade.exitRule;
  for (let j = 0; j < candles.length && !trade.closed; j++) {
    const c = candles[j];
    if (c.time <= trade.checkedUntil) continue;
    trade.checkedUntil = c.time;
    trade.bars = (trade.bars ?? 0) + 1;
    let exit = null;
    let reason = null;
    if (c.low <= trade.stopLoss) [exit, reason] = [Math.min(trade.stopLoss, c.open), 'stop'];
    else if (j >= n - 1) {
      const avg = candles.slice(j - n + 1, j + 1).reduce((s, x) => s + x.close, 0) / n;
      if (c.close > avg) [exit, reason] = [c.close, 'sma'];
    }
    if (exit === null && trade.bars >= maxBars) [exit, reason] = [c.close, 'time'];
    if (exit !== null) {
      Object.assign(trade, { closed: true, closedAt: c.time, exit, exitReason: reason, r: (exit - trade.entry) / risk });
      events.push({ type: reason === 'stop' ? 'sl' : 'exit', time: c.time });
    }
  }
  return events;
}

function createTracker(file) {
  let trades = [];
  try {
    trades = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // لا يوجد ملف بعد
  }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(trades, null, 2));
  };

  return {
    has: (symbol, interval, signal, strategy) => trades.some((t) => t.id === tradeId(symbol, interval, signal, strategy)),

    // الإشارات المفتوحة على نفس الرمز وفي نفس الاتجاه، للتنبيه من مضاعفة المخاطرة
    openSameSide: (symbol, side) => trades.filter((t) => !t.closed && t.symbol === symbol && t.side === side),

    hasOpen: (symbol, interval, strategy) => trades.some((t) => !t.closed && t.symbol === symbol && t.interval === interval && t.strategy === strategy),

    add(symbol, interval, signal, strategy = DEFAULT_STRATEGY) {
      if (signal.exitRule) {
        trades.push({ id: tradeId(symbol, interval, signal, strategy), symbol, interval, strategy, side: signal.side, time: signal.time, entry: signal.entry, stopLoss: signal.stopLoss, exitRule: signal.exitRule, bars: 0, checkedUntil: signal.time, closed: false });
        save();
        return;
      }
      trades.push({
        id: tradeId(symbol, interval, signal, strategy),
        symbol,
        interval,
        strategy,
        side: signal.side,
        time: signal.time,
        entry: signal.entry,
        stopLoss: signal.stopLoss,
        halves: [
          { target: signal.takeProfit1, r: null },
          { target: signal.takeProfit2, r: null },
        ],
        checkedUntil: signal.time,
        closed: false,
      });
      save();
    },

    // يُرجع الأحداث الجديدة لكل صفقة مفتوحة على هذا الرمز والإطار
    update(symbol, interval, candles) {
      const results = [];
      for (const t of trades) {
        if (t.closed || t.symbol !== symbol || t.interval !== interval) continue;
        for (const e of advance(t, candles)) results.push({ ...e, trade: t });
      }
      if (results.length) save();
      return results;
    },

    // الصفقات التي أُغلقت منذ وقت معيّن (للملخص الأسبوعي)
    closedSince: (since) => trades.filter((t) => t.closed && (t.closedAt ?? t.checkedUntil) >= since),

    summary() {
      const closed = trades.filter((t) => t.closed);
      const tally = (list) => ({
        closed: list.length,
        wins: list.filter((t) => t.r > 0).length,
        losses: list.filter((t) => t.r < 0).length,
        totalR: list.reduce((s, t) => s + t.r, 0),
      });
      const byStrategy = {};
      for (const key of new Set(closed.map((t) => t.strategy ?? DEFAULT_STRATEGY))) {
        byStrategy[key] = tally(closed.filter((t) => (t.strategy ?? DEFAULT_STRATEGY) === key));
      }
      // البيع والشراء دائماً، حتى يظهر متى لا توجد بيانات لاتجاه ما
      const bySide = { SELL: tally(closed.filter((t) => t.side === 'SELL')), BUY: tally(closed.filter((t) => t.side === 'BUY')) };
      return {
        ...tally(closed),
        byStrategy,
        bySide,
        open: trades.filter((t) => !t.closed),
        recent: closed.slice(-10),
      };
    },
  };
}

module.exports = { createTracker, advance, tradeId };
