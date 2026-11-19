// الفكرة 4 — الارتداد إلى فيبوناتشي 61.8% مع شمعة تأكيد، على إطار ساعة. مسجلة قبل أي نتيجة (2026-11-19) ووافق عليها صاحب المشروع.
//   الاتجاه: إغلاق الساعة فوق EMA 200 = شراء فقط، وتحته = بيع فقط.
//   الموجة (شراء): آخر قمة مؤكدة (أعلى من 5 شموع قبلها و 5 بعدها) وآخر قاع مؤكد قبلها، وطولها ≥ 2 × ATR(14).
//   الدخول: بعد تأكيد القمة، يلمس السعر مستوى 61.8% ثم تُغلق شمعة ساعة فوقه (قد تكون نفس الشمعة)، خلال 24 شمعة.
//   الإلغاء: تجاوز القمة قبل الدخول، أو لمس الوقف قبل الدخول، أو مرور 24 شمعة.
//   الوقف: تحت قاع الموجة بـ 0.1 × ATR. الهدف: القمة. البيع عكس ذلك. صفقة واحدة مفتوحة.
//   التكاليف: XM (0.52$ + 0.10$) و Swap 0.02% لكل ليلة. للمعلومة: النتيجة بتكلفة Exness Zero (~0.13$ + 0.10$).
//   المتانة: مستوى الدخول 50% / 61.8% / 78.6% × القمم بـ 3 / 5 / 8 شموع.
const { config } = require('./config');

const RULE4 = { level: 0.618, pivot: 5, minLegAtr: 2, window: 24, stopBufferAtr: 0.1, emaPeriod: 200 };
const GRID4 = { level: [0.5, 0.618, 0.786], pivot: [3, 5, 8] };
const SWAP_PCT = 0.02;
const EXNESS_ZERO_COST = 0.13 + 0.1;
const HOUR = 3600000;

// شموع ساعة من 15 دقيقة (الساعة تبدأ عند :00 UTC)
function toH1(m15) {
  const out = [];
  for (const b of m15) {
    const ms = Math.floor(b.ms / HOUR) * HOUR;
    const last = out.at(-1);
    if (last && last.ms === ms) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
    } else out.push({ ms, time: new Date(ms).toISOString().slice(0, 19).replace('T', ' '), open: b.open, high: b.high, low: b.low, close: b.close });
  }
  return out;
}

function ema(values, n) {
  const out = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = values.slice(0, n).reduce((s, x) => s + x, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) out[i] = prev = values[i] * k + prev * (1 - k);
  return out;
}
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

function idea4Trades(h1, rule = RULE4, { cost = config.costs.spread + config.costs.slippage, spreadMult = 1 } = {}) {
  const c = spreadMult === 1 ? cost : config.costs.spread * spreadMult + config.costs.slippage;
  const e = ema(h1.map((b) => b.close), rule.emaPeriod);
  const a = atr(h1);
  const { highs, lows } = pivots(h1, rule.pivot);
  // الإعدادات: لكل قمة (للشراء) أو قاع (للبيع) مؤكد، مع الطرف المعاكس الذي قبله
  const setups = [];
  for (const H of highs) {
    const L = [...lows].reverse().find((x) => x.j < H.j);
    if (L) setups.push({ dir: 1, start: H.known + 1, extreme: H.price, origin: L.price, atrIdx: H.known });
  }
  for (const L of lows) {
    const H = [...highs].reverse().find((x) => x.j < L.j);
    if (H) setups.push({ dir: -1, start: L.known + 1, extreme: L.price, origin: H.price, atrIdx: L.known });
  }
  setups.sort((x, y) => x.start - y.start);
  const out = [];
  let busyUntil = -1;
  for (const s of setups) {
    if (s.start <= busyUntil || s.start >= h1.length || a[s.atrIdx] === null) continue;
    const leg = Math.abs(s.extreme - s.origin);
    if (leg < rule.minLegAtr * a[s.atrIdx]) continue;
    const level = s.extreme - s.dir * rule.level * leg;
    let touched = false;
    let entryIdx = -1;
    for (let i = s.start; i < Math.min(h1.length, s.start + rule.window); i++) {
      const b = h1[i];
      if (s.dir === 1 ? b.high > s.extreme : b.low < s.extreme) break; // تجاوز القمة (القاع) قبل الدخول
      if (s.dir === 1 ? b.low <= s.origin : b.high >= s.origin) break; // لمس طرف الموجة قبل الدخول
      if (s.dir === 1 ? b.low <= level : b.high >= level) touched = true;
      if (touched && (s.dir === 1 ? b.close > level : b.close < level)) {
        entryIdx = i;
        break;
      }
    }
    if (entryIdx < 0 || e[entryIdx] === null || a[entryIdx] === null) continue;
    const eb = h1[entryIdx];
    if (s.dir === 1 ? !(eb.close > e[entryIdx]) : !(eb.close < e[entryIdx])) continue;
    const entry = eb.close;
    const stop = s.origin - s.dir * rule.stopBufferAtr * a[entryIdx];
    const risk = s.dir * (entry - stop);
    const target = s.extreme;
    if (!(risk > 0) || !(s.dir * (target - entry) > 0)) continue;
    let exitIdx = -1;
    let exit = null;
    let how = null;
    for (let i = entryIdx + 1; i < h1.length; i++) {
      const b = h1[i];
      const stopHit = s.dir === 1 ? b.low <= stop : b.high >= stop;
      const tHit = s.dir === 1 ? b.high >= target : b.low <= target;
      if (stopHit) [exitIdx, exit, how] = [i, s.dir === 1 ? Math.min(stop, b.open) : Math.max(stop, b.open), 'وقف'];
      else if (tHit) [exitIdx, exit, how] = [i, target, 'هدف'];
      if (exitIdx >= 0) break;
    }
    if (exitIdx < 0) continue;
    const xb = h1[exitIdx];
    const swap = (entry * SWAP_PCT * nights(eb.ms + HOUR, xb.ms + HOUR - 1)) / 100;
    const day = eb.time.slice(0, 10);
    out.push({ day, year: day.slice(0, 4), time: eb.time, exitTime: xb.time, dir: s.dir, how, rr: (s.dir * (target - entry)) / risk, r: (s.dir * (exit - entry) - c - swap) / risk });
    busyUntil = exitIdx;
  }
  return out;
}

module.exports = { RULE4, GRID4, EXNESS_ZERO_COST, toH1, idea4Trades, pivots };
