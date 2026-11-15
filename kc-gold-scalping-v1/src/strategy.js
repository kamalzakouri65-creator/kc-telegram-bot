// اكتشاف الإعدادات (Setups) حسب rules.js. نكتشف الشراء فقط، والبيع بقلب الأسعار (السعر ← سالب السعر) ثم نعيد قلب النتيجة،
// حتى يكون البيع عكس الشراء تماماً بنفس الكود. كل قرار يستعمل فقط شموعاً مغلقة ومعروفة في وقته (confirmIdx / availIdx).
const { prepare, countConfirmed } = require('./bars');
const { RULES, COSTS } = require('./rules');

const flip = (raw) => raw.map((c) => ({ ...c, open: -c.open, high: -c.low, low: -c.high, close: -c.close }));

// اتجاه M15 عند شمعة M1 رقم i: آخر قمتين وآخر قاعين مؤكدين
function m15Trend(d, i) {
  const nh = countConfirmed(d.pivM15.highs, i);
  const nl = countConfirmed(d.pivM15.lows, i);
  if (nh < 2 || nl < 2) return 0;
  const [h1, h2] = [d.pivM15.highs[nh - 2].price, d.pivM15.highs[nh - 1].price];
  const [l1, l2] = [d.pivM15.lows[nl - 2].price, d.pivM15.lows[nl - 1].price];
  if (h2 > h1 && l2 > l1) return 1;
  if (h2 < h1 && l2 < l1) return -1;
  return 0;
}

// إعدادات الشراء على بيانات مجهزة (قد تكون مقلوبة)
function bullishSetups(d, rules = RULES, cost = COSTS.spread + COSTS.slippage + COSTS.commission) {
  const { m1, m5, atrM1, pivM1, pivM5 } = d;
  const L = rules.pivot;
  const out = [];
  const consumed = new Set();
  let busyUntil = -1; // إعداد واحد في كل مرة: لا نبحث عن جديد قبل انتهاء الحالي
  let lowPtr = 0;
  for (let b = L + 1; b < m5.length; b++) {
    const sweepAvail = m5[b].availIdx;
    if (sweepAvail <= busyUntil) continue;
    if (m15Trend(d, sweepAvail) !== 1) continue;
    // مستويات السيولة: قيعان M5 مؤكدة قبل شمعة الـ Sweep، من آخر 48 شمعة، ولم تُكسر
    let level = null;
    while (lowPtr < pivM5.lows.length && pivM5.lows[lowPtr].j < b - rules.liquidityLookbackM5) lowPtr++;
    for (let q = lowPtr; q < pivM5.lows.length; q++) {
      const p = pivM5.lows[q];
      if (p.j + L > b - 1) break;
      if (consumed.has(p.j)) continue;
      let unswept = true;
      for (let k = p.j + 1; k < b && unswept; k++) if (m5[k].low < p.price) unswept = false;
      if (!unswept) continue;
      if (m5[b].low < p.price && m5[b].close > p.price && (!level || p.price < level.price)) level = p;
    }
    if (!level) continue;
    consumed.add(level.j);
    const sweepLow = m5[b].low;
    // BOS / CHoCH على M1
    let brk = null;
    for (let i = sweepAvail + 1; i <= Math.min(m1.length - 2, sweepAvail + rules.breakWindowM1); i++) {
      if (m1[i].low < sweepLow) break; // قاع جديد تحت الـ Sweep يُلغي الإعداد
      const n = countConfirmed(pivM1.highs, i - 1);
      if (!n) continue;
      const h = pivM1.highs[n - 1];
      if (h.j < m5[b].firstIdx - rules.swingHighMaxAgeM1) continue;
      if (!(m1[i].close > h.price && m1[i - 1].close <= h.price)) continue;
      const kind = n >= 2 && pivM1.highs[n - 2].price > h.price ? 'CHoCH' : 'BOS';
      brk = { i, kind };
      break;
    }
    if (!brk) continue;
    const i = brk.i;
    busyUntil = i;
    // Displacement: شمعة الكسر نفسها
    const c = m1[i];
    const body = c.close - c.open;
    const range = c.high - c.low;
    if (i < rules.displacementBodyAvg + 1 || !(body > 0) || !(range > 0)) continue;
    let sum = 0;
    for (let k = i - rules.displacementBodyAvg; k < i; k++) sum += Math.abs(m1[k].close - m1[k].open);
    const avgBody = sum / rules.displacementBodyAvg;
    if (!(body >= rules.displacementBodyMult * avgBody && (body / range) * 100 >= rules.displacementBodyPct)) continue;
    // FVG: بين الشمعة قبل الـ Displacement والشمعة بعده
    const top = m1[i + 1].low;
    const bottom = m1[i - 1].high;
    if (atrM1[i] == null || !(top - bottom >= rules.fvgMinAtr * atrM1[i])) continue;
    busyUntil = i + 1;
    // إعادة الاختبار خلال 30 شمعة بعد تكوّن الفجوة
    let fill = null;
    for (let k = i + 2; k <= Math.min(m1.length - 1, i + 1 + rules.retestWindowM1); k++) {
      if (m1[k].low <= top) {
        fill = { k, price: Math.min(top, m1[k].open) };
        break;
      }
      if (m1[k].close < bottom) break;
    }
    busyUntil = fill ? fill.k : i + 1 + rules.retestWindowM1;
    if (!fill) continue;
    const stop = sweepLow - rules.stopBufferAtr * atrM1[i];
    const risk = fill.price - stop;
    if (!(risk > 0) || risk < rules.minRiskCostMult * cost) continue;
    out.push({ fillIdx: fill.k, entry: fill.price, stop, risk, kind: brk.kind, sweepIdx: sweepAvail, breakIdx: i });
  }
  return out;
}

// كل الإعدادات (شراء وبيع) بأسعار حقيقية، مرتبة بوقت التنفيذ
function findSetups(raw, rules = RULES, cost) {
  const up = prepare(raw, rules.pivot);
  const down = prepare(flip(raw), rules.pivot);
  const buys = bullishSetups(up, rules, cost).map((s) => ({ ...s, dir: 1 }));
  const sells = bullishSetups(down, rules, cost).map((s) => ({ ...s, dir: -1, entry: -s.entry, stop: -s.stop }));
  return { m1: up.m1, setups: [...buys, ...sells].sort((a, b) => a.fillIdx - b.fillIdx) };
}

module.exports = { findSetups, bullishSetups, m15Trend, flip };
