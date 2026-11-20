// الفكرة 5 (الأخيرة) — SMC متعدد الأطر: BOS + Order Block مع FVG على الساعة، فلتر فخ السيولة، تأكيد CHoCH على 15 دقيقة،
// ووقف متحرك تحت القيعان الأعلى. مسجلة قبل أي نتيجة (2026-11-19) ووافق عليها صاحب المشروع.
//   BOS (ساعة): إغلاق فوق آخر قمة مؤكدة (أعلى من L شموع قبلها و L بعدها، L=5) وكان الإغلاق السابق تحتها.
//   OB: آخر شمعة ساعة هابطة قبل شمعة الكسر (بعد القمة المكسورة). FVG داخل الاندفاع (من OB حتى الكسر) ≥ 0.3 × ATR(ساعة).
//   فخ السيولة: قاعان مؤكدان متتاليان (ساعة) بين أعلى المنطقة وقمة الكسر بفرق < 0.1 × ATR → نتخطى المنطقة.
//   الصلاحية: 48 ساعة بعد الكسر، وتُلغى بإغلاق ساعة تحت المنطقة.
//   التأكيد: بعد لمس المنطقة، إغلاق 15 دقيقة فوق آخر قمة 15 دقيقة مؤكدة (L=3) خلال 8 ساعات من اللمس.
//   الوقف: تحت أدنى سعر منذ اللمس − 0.1 × ATR(ساعة). الوقف المتحرك: تحت كل قاع 15 دقيقة مؤكد أعلى من الوقف (− 0.1 × ATR(15)).
//   الحد الزمني 72 ساعة. البيع عكس كل شيء. صفقة واحدة مفتوحة. المتانة: L الساعة 3/5/8 × L الـ 15 دقيقة 2/3/5.
const { config } = require('./config');
const { toH1 } = require('./idea4');

const RULE5 = { h1Pivot: 5, m15Pivot: 3, fvgAtr: 0.3, trapAtr: 0.1, validH1: 48, confirmM15: 32, stopBufferAtr: 0.1, maxHoldM15: 288 };
const GRID5 = { h1Pivot: [3, 5, 8], m15Pivot: [2, 3, 5] };
const SWAP_PCT = 0.02;
const HOUR = 3600000;

function atr(c, n = 14) {
  const out = new Array(c.length).fill(null);
  let v = null;
  for (let i = 1; i < c.length; i++) {
    const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    v = i <= n ? (v ?? 0) + tr / n : (v * (n - 1) + tr) / n;
    if (i >= n) out[i] = v;
  }
  return out;
}
function pivots(c, L) {
  const highs = [];
  const lows = [];
  for (let j = L; j + L < c.length; j++) {
    let isH = true;
    let isL = true;
    for (let k = j - L; k <= j + L && (isH || isL); k++) {
      if (k === j) continue;
      if (c[k].high >= c[j].high) isH = false;
      if (c[k].low <= c[j].low) isL = false;
    }
    if (isH) highs.push({ j, price: c[j].high, known: j + L });
    if (isL) lows.push({ j, price: c[j].low, known: j + L });
  }
  return { highs, lows };
}
const nights = (fromMs, toMs) => {
  let n = 0;
  let t = Math.floor(fromMs / 86400000) * 86400000 + 21 * HOUR;
  if (t <= fromMs) t += 86400000;
  for (; t <= toMs; t += 86400000) n++;
  return n;
};
const flip = (bars) => bars.map((b) => ({ ...b, open: -b.open, high: -b.low, low: -b.high, close: -b.close }));

// صفقات الشراء على بيانات (قد تكون مقلوبة للبيع)
function longCandidates(m15, rule, diag = null) {
  const D = diag ?? {};
  const inc = (k) => (D[k] = (D[k] ?? 0) + 1);
  const h1 = toH1(m15);
  const hIdx = new Map(h1.map((b, i) => [b.ms, i]));
  const m2h = m15.map((b) => hIdx.get(Math.floor(b.ms / HOUR) * HOUR));
  const lastOfHour = m15.map((b, i) => i + 1 >= m15.length || m2h[i + 1] !== m2h[i]);
  const firstM15OfH1 = new Map();
  m15.forEach((b, i) => {
    if (!firstM15OfH1.has(m2h[i])) firstM15OfH1.set(m2h[i], i);
  });
  const aH = atr(h1);
  const aM = atr(m15);
  const pH = pivots(h1, rule.h1Pivot);
  const pM = pivots(m15, rule.m15Pivot);
  const out = [];
  let hp = 0;
  let lp = 0;
  for (let i = 1; i < h1.length; i++) {
    while (hp < pH.highs.length && pH.highs[hp].known <= i - 1) hp++;
    while (lp < pH.lows.length && pH.lows[lp].known <= i) lp++;
    if (!hp || aH[i] === null) continue;
    const H = pH.highs[hp - 1];
    if (!(h1[i].close > H.price && h1[i - 1].close <= H.price)) continue;
    inc('1. كسر هيكل BOS');
    // OB: آخر شمعة هابطة قبل شمعة الكسر وبعد القمة
    let k = -1;
    for (let x = i - 1; x > H.j; x--) if (h1[x].close < h1[x].open) {
      k = x;
      break;
    }
    if (k < 0) continue;
    inc('2. وُجد OB');
    let fvg = false;
    for (let m = k + 1; m <= i - 1 && !fvg; m++) if (h1[m + 1].low - h1[m - 1].high >= rule.fvgAtr * aH[i]) fvg = true;
    if (!fvg) continue;
    inc('3. ومعه FVG');
    const zone = { low: h1[k].low, high: h1[k].high };
    // فخ السيولة: قاعان متتاليان متساويان بين أعلى المنطقة وقمة الكسر
    const between = pH.lows.slice(0, lp).filter((l) => l.price > zone.high && l.price < H.price);
    let trap = false;
    for (let q = 1; q < between.length && !trap; q++) if (Math.abs(between[q].price - between[q - 1].price) < rule.trapAtr * aH[i]) trap = true;
    if (trap) continue;
    inc('4. نجا من فلتر الفخ');
    // المتابعة على 15 دقيقة
    const start = firstM15OfH1.get(i + 1);
    if (start === undefined) continue;
    const endH = i + rule.validH1;
    let touch = -1;
    let sweep = Infinity;
    let mp = 0;
    let entry = -1;
    for (let t = start; t < m15.length && m2h[t] <= endH; t++) {
      const b = m15[t];
      while (mp < pM.highs.length && pM.highs[mp].known <= t - 1) mp++;
      if (touch < 0 && b.low <= zone.high) touch = t;
      if (touch >= 0) {
        sweep = Math.min(sweep, b.low);
        if (t - touch > rule.confirmM15) break;
        const ph = mp ? pM.highs[mp - 1] : null;
        if (ph && b.close > ph.price && m15[t - 1].close <= ph.price) {
          entry = t;
          break;
        }
      }
      if (lastOfHour[t] && b.close < zone.low) break; // إغلاق ساعة تحت المنطقة
    }
    if (touch >= 0) inc('5. لمس المنطقة خلال 48 ساعة');
    if (entry < 0) continue;
    inc('6. تأكيد CHoCH خلال 8 ساعات');
    const e = m15[entry].close;
    let stop = sweep - rule.stopBufferAtr * aH[i];
    const risk = e - stop;
    if (!(risk > 0)) continue;
    let exitIdx = -1;
    let exit = null;
    let how = null;
    let lowPtr = 0;
    let best = e;
    let worst = e;
    for (let t = entry + 1; t < m15.length; t++) {
      const b = m15[t];
      best = Math.max(best, b.high);
      worst = Math.min(worst, b.low);
      if (b.low <= stop) {
        [exitIdx, exit, how] = [t, Math.min(stop, b.open), stop > e ? 'وقف متحرك (ربح)' : 'وقف'];
        break;
      }
      if (t - entry >= rule.maxHoldM15) {
        [exitIdx, exit, how] = [t, b.close, 'وقت'];
        break;
      }
      // رفع الوقف تحت القيعان الأعلى المؤكدة بعد الدخول
      while (lowPtr < pM.lows.length && pM.lows[lowPtr].known <= t) {
        const l = pM.lows[lowPtr++];
        if (l.j > entry && aM[t] !== null) {
          const ns = l.price - rule.stopBufferAtr * aM[t];
          if (ns > stop) stop = ns;
        }
      }
    }
    if (exitIdx < 0) continue;
    out.push({ entryIdx: entry, exitIdx, entry: e, exit, risk, how, mfe: (best - e) / risk, mae: (e - worst) / risk, hours: (exitIdx - entry) / 4, zoneAtr: (zone.high - zone.low) / aH[i] });
  }
  return out;
}

function idea5Trades(m15, rule = RULE5, { cost = config.costs.spread + config.costs.slippage, spreadMult = 1 } = {}) {
  const c = spreadMult === 1 ? cost : config.costs.spread * spreadMult + config.costs.slippage;
  const cands = [...longCandidates(m15, rule).map((x) => ({ ...x, dir: 1 })), ...longCandidates(flip(m15), rule).map((x) => ({ ...x, dir: -1 }))].sort((a, b) => a.entryIdx - b.entryIdx);
  const out = [];
  let busy = -1;
  for (const x of cands) {
    if (x.entryIdx <= busy) continue;
    busy = x.exitIdx;
    const eb = m15[x.entryIdx];
    const xb = m15[x.exitIdx];
    const price = Math.abs(x.entry);
    const swap = (price * SWAP_PCT * nights(eb.ms + 900000, xb.ms + 900000 - 1)) / 100;
    const day = eb.time.slice(0, 10);
    out.push({ day, year: day.slice(0, 4), time: eb.time, exitTime: xb.time, dir: x.dir, how: x.how, r: (x.exit - x.entry - c - swap) / x.risk });
  }
  return out;
}

// التشخيص (للتطوير فقط): قمع الإشارات لكل اتجاه، وتفاصيل كل صفقة (أقصى ربح وخسارة ظاهرين، المدة)
function idea5Diagnose(m15, rule = RULE5) {
  const buyDiag = {};
  const sellDiag = {};
  const buys = longCandidates(m15, rule, buyDiag).map((x) => ({ ...x, dir: 1 }));
  const sells = longCandidates(flip(m15), rule, sellDiag).map((x) => ({ ...x, dir: -1 }));
  const day = (x) => m15[x.entryIdx].time.slice(0, 10);
  return { buyDiag, sellDiag, cands: [...buys, ...sells].map((x) => ({ ...x, day: day(x), year: day(x).slice(0, 4) })) };
}

module.exports = { RULE5, GRID5, idea5Trades, idea5Diagnose };
