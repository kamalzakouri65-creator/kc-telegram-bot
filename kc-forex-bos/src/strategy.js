// كسر الهيكل (BOS) على ساعة. كل قرار يستعمل فقط قمماً وقيعاناً مؤكدة قبل الشمعة الحالية (لا نظر للمستقبل).
const { config, PIP } = require('./config');

// قمة j: أعلى بشكل صارم من L شمعة قبلها و L بعدها. تُعرف عند إغلاق الشمعة j+L
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

// عدد مرات المرور بـ 21:00 UTC (Swap)
function nightsHeld(fromMs, toMs) {
  const DAY = 86400000;
  let n = 0;
  let t = Math.floor(fromMs / DAY) * DAY + 21 * 3600000;
  if (t <= fromMs) t += DAY;
  for (; t <= toMs; t += DAY) n++;
  return n;
}

function trades(c, { pivot = config.rule.pivot, rr = config.rule.rr, spreadPips = config.costs.spreadPips, from = '0000', to = '9999' } = {}) {
  const { highs, lows } = pivots(c, pivot);
  const a = atr(c);
  const out = [];
  let hi = 0;
  let lo = 0;
  let open = null;
  for (let i = 1; i < c.length; i++) {
    const bar = c[i];
    if (open) {
      const d = open.dir;
      const stopHit = d === 1 ? bar.low <= open.stop : bar.high >= open.stop;
      const targetHit = d === 1 ? bar.high >= open.target : bar.low <= open.target;
      let exit = null;
      if (stopHit) exit = d === 1 ? Math.min(open.stop, bar.open) : Math.max(open.stop, bar.open);
      else if (targetHit) exit = open.target;
      if (exit !== null) {
        const nights = nightsHeld(open.ms, bar.ms + 3600000 - 1);
        const costPips = spreadPips + config.costs.slippagePips + config.costs.swapPipsPerNight * nights;
        out.push({ time: open.time, closedAt: bar.time, dir: d, r: (d * (exit - open.entry)) / open.risk - (costPips * PIP) / open.risk });
        open = null;
      }
      continue;
    }
    // القمم والقيعان المعروفة قبل هذه الشمعة
    while (hi < highs.length && highs[hi].known <= i - 1) hi++;
    while (lo < lows.length && lows[lo].known <= i - 1) lo++;
    if (hi < 2 || lo < 2 || a[i] === null || bar.time < from || bar.time > to) continue;
    const [h1, h2] = [highs[hi - 2].price, highs[hi - 1].price];
    const [l1, l2] = [lows[lo - 2].price, lows[lo - 1].price];
    const prev = c[i - 1].close;
    let dir = 0;
    if (h2 > h1 && l2 > l1 && bar.close > h2 && prev <= h2) dir = 1;
    else if (h2 < h1 && l2 < l1 && bar.close < l2 && prev >= l2) dir = -1;
    if (!dir) continue;
    const entry = bar.close;
    const stop = dir === 1 ? l2 - config.rule.stopBufferAtr * a[i] : h2 + config.rule.stopBufferAtr * a[i];
    const risk = dir * (entry - stop);
    if (!(risk >= config.rule.minStopPips * PIP)) continue;
    open = { time: bar.time, ms: bar.ms, dir, entry, stop, risk, target: entry + dir * rr * risk };
  }
  return out;
}

module.exports = { pivots, atr, trades, nightsHeld };
