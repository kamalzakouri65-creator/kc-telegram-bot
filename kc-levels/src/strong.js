// المستويات القوية (فكرة كمال من شارت H4) — القواعد ثابتة قبل التشغيل (2026-11-12):
//   القاع: أدنى من 3 شموع قبله و 3 بعده، ولا يُعرف إلا بعد مرور 3 شموع.
//   مستوى الدعم: قاعان مؤكدان على الأقل من آخر 200 شمعة، الفرق بينهما ≤ 0.5 × ATR، وبينهما 10 شموع على الأقل.
//     المستوى = متوسط القاعين. يُلغى إذا أُغلقت شمعة تحته بعد آخر لمسة، ويُستعمل مرة واحدة.
//   الدخول: أمر شراء معلّق عند المستوى: أول شمعة تأتي من فوقه وتلمسه = تنفيذ عند المستوى.
//   الوقف: المستوى − 1 × ATR، والهدف: المستوى + 2 × ATR (ATR عند شمعة التنفيذ السابقة).
//   لمس الوقف في شمعة التنفيذ = خسارة، والهدف لا يُحسب فيها. صفقة شراء واحدة في كل مرة.
//   البيع عند المقاومة بالعكس تماماً (يُحسب منفصلاً بقلب الشموع). السبريد يُخصم من كل صفقة.
const { atr } = require('../../gold-forex-signals-bot/src/indicators');

const P = { pivot: 3, lookback: 200, clusterAtr: 0.5, minGap: 10, stopAtr: 1, targetAtr: 2 };
const flip = (cs) => cs.map((c) => ({ ...c, open: -c.open, high: -c.low, low: -c.high, close: -c.close }));

function isLow(cs, j, L) {
  for (let k = 1; k <= L; k++) if (!(cs[j].low < cs[j - k].low && cs[j].low <= cs[j + k].low)) return false;
  return true;
}

// صفقات الشراء عند الدعم القوي
function buyAtSupport(cs, spread, p = P) {
  const a = atr(cs, 14);
  const L = p.pivot;
  const used = new Set();
  const trades = [];
  let open = null;
  for (let i = p.lookback; i < cs.length; i++) {
    const c = cs[i];
    if (open) {
      let exit = null;
      if (c.low <= open.stop) exit = open.stop;
      else if (c.high >= open.target) exit = open.target;
      if (exit !== null) {
        trades.push({ time: open.time, closedAt: c.time, r: (exit - open.entry - spread) / open.risk });
        open = null;
      }
      continue;
    }
    if (a[i - 1] == null) continue;
    const lows = [];
    for (let j = i - L - 1; j >= Math.max(L, i - p.lookback); j--) if (isLow(cs, j, L)) lows.push(j);
    // أقرب مستوى قوي تحت سعر الافتتاح
    let best = null;
    for (let x = 0; x < lows.length; x++) {
      for (let y = x + 1; y < lows.length; y++) {
        const [late, early] = [lows[x], lows[y]];
        if (late - early < p.minGap || Math.abs(cs[late].low - cs[early].low) > p.clusterAtr * a[i - 1]) continue;
        const key = `${early}-${late}`;
        if (used.has(key)) continue;
        const level = (cs[late].low + cs[early].low) / 2;
        let broken = false;
        for (let k = late + 1; k < i && !broken; k++) if (cs[k].close < level) broken = true;
        if (broken || !(c.open > level)) continue;
        if (!best || level > best.level) best = { level, key };
      }
    }
    if (!best || !(c.low <= best.level)) continue;
    used.add(best.key);
    const risk = p.stopAtr * a[i - 1];
    open = { time: c.time, entry: best.level, stop: best.level - risk, target: best.level + p.targetAtr * a[i - 1], risk };
    if (c.low <= open.stop) {
      trades.push({ time: c.time, closedAt: c.time, r: (open.stop - open.entry - spread) / risk });
      open = null;
    }
  }
  return trades;
}

function strongLevels(cs, spread) {
  const buys = buyAtSupport(cs, spread).map((t) => ({ ...t, side: 'BUY' }));
  const sells = buyAtSupport(flip(cs), spread).map((t) => ({ ...t, side: 'SELL' }));
  return [...buys, ...sells].sort((x, y) => (x.time < y.time ? -1 : 1));
}

module.exports = { strongLevels, buyAtSupport, P };
