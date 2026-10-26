// متابعة نتيجة كل إشارة أُرسلت: هل وصلت للهدف 1 أو 2 أو ضربت الوقف.
// تُحسب كما في الاختبار التاريخي: نصف الصفقة عند الهدف 1 ونصف عند الهدف 2،
// وإذا لمست الشمعة الوقف والهدف معاً نعتبر الوقف هو الذي ضُرب.
// الإشارات تُحفظ في ملف حتى لا تضيع عند إعادة تشغيل البوت.
const fs = require('fs');
const path = require('path');

const tradeId = (symbol, interval, signal) => `${symbol}|${interval}|${signal.side}@${signal.time}`;

// يطبّق الشموع الجديدة على صفقة مفتوحة ويُرجع ما حدث: tp1 أو tp2 أو sl
function advance(trade, candles) {
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
    has: (symbol, interval, signal) => trades.some((t) => t.id === tradeId(symbol, interval, signal)),

    add(symbol, interval, signal) {
      trades.push({
        id: tradeId(symbol, interval, signal),
        symbol,
        interval,
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

    summary() {
      const closed = trades.filter((t) => t.closed);
      const wins = closed.filter((t) => t.r > 0).length;
      return {
        closed: closed.length,
        wins,
        losses: closed.filter((t) => t.r < 0).length,
        totalR: closed.reduce((s, t) => s + t.r, 0),
        open: trades.filter((t) => !t.closed),
        recent: closed.slice(-10),
      };
    },
  };
}

module.exports = { createTracker, advance, tradeId };
