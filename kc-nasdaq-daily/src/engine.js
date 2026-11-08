// محاكاة يومية، شراء فقط، صفقة واحدة في كل مرة. النتائج بوحدة R بعد السبريد والـ Swap.
const { analyze } = require('../../gold-forex-signals-bot/src/strategy');
const { config } = require('./config');

const WINDOW = 500;
const nights = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const costR = (entry, risk, entryDay, exitDay, spreadPct) => ((entry * (spreadPct + nights(entryDay, exitDay) * config.swapPctPerNight)) / 100) / risk;

function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  values.forEach((v, i) => {
    sum += v;
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  });
  return out;
}
function rsiWilder(closes, n) {
  const out = new Array(closes.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);
    if (i <= n) {
      gain += g / n;
      loss += l / n;
    } else {
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
    }
    if (i >= n) out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
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

// A) EMA + MACD من بوت الذهب: نصف عند الهدف 1 ونصف عند الهدف 2
function runEmaMacd(candles, { from, to = '9999', spreadPct }) {
  const trades = [];
  let open = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (open) {
      const stopHit = c.low <= open.stop;
      for (const h of open.halves) {
        if (h.r !== null) continue;
        if (stopHit) h.r = -1;
        else if (c.high >= h.target) h.r = (h.target - open.entry) / open.risk;
      }
      if (open.halves.every((h) => h.r !== null)) {
        const r = (open.halves[0].r + open.halves[1].r) / 2 - costR(open.entry, open.risk, open.time, c.time, spreadPct);
        trades.push({ time: open.time, closedAt: c.time, r });
        open = null;
      }
      continue;
    }
    if (c.time < from || c.time > to) continue;
    const s = analyze(candles.slice(Math.max(0, i + 1 - WINDOW), i + 1).map((x) => ({ ...x, time: x.time })));
    if (!s || s.side !== 'BUY') continue;
    const risk = s.entry - s.stopLoss;
    if (!(risk > 0)) continue;
    open = { time: c.time, entry: s.entry, stop: s.stopLoss, risk, halves: [{ target: s.takeProfit1, r: null }, { target: s.takeProfit2, r: null }] };
  }
  return trades;
}

// B) RSI(2): شراء التراجع في سوق صاعد، والخروج عند الارتداد فوق متوسط 5 أيام
function runRsi2(candles, { from, to = '9999', spreadPct }, p = config.rsi2) {
  const closes = candles.map((c) => c.close);
  const trend = sma(closes, p.smaTrend);
  const exitMa = sma(closes, p.smaExit);
  const r2 = rsiWilder(closes, p.rsiPeriod);
  const a = atr(candles);
  const trades = [];
  let open = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (open) {
      open.bars++;
      let exit = null;
      if (c.low <= open.stop) exit = Math.min(open.stop, c.open); // فجوة تحت الوقف: نخرج بسعر الافتتاح
      else if (c.close > exitMa[i] || open.bars >= p.maxBars) exit = c.close;
      if (exit !== null) {
        const r = (exit - open.entry) / open.risk - costR(open.entry, open.risk, open.time, c.time, spreadPct);
        trades.push({ time: open.time, closedAt: c.time, r });
        open = null;
      }
      continue;
    }
    if (c.time < from || c.time > to || trend[i] === null || a[i] === null || r2[i] === null) continue;
    if (c.close > trend[i] && r2[i] < p.entryBelow) {
      const risk = p.stopAtr * a[i];
      open = { time: c.time, entry: c.close, stop: c.close - risk, risk, bars: 0 };
    }
  }
  return trades;
}

function metrics(trades) {
  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const t of trades) {
    eq += t.r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  const wins = trades.filter((t) => t.r > 0);
  const gw = wins.reduce((s, t) => s + t.r, 0);
  const gl = -trades.filter((t) => t.r < 0).reduce((s, t) => s + t.r, 0);
  return { count: trades.length, winRate: trades.length ? (wins.length / trades.length) * 100 : 0, totalR: eq, profitFactor: gl ? gw / gl : trades.length ? Infinity : 0, maxDd: dd };
}

// النجاح: Nasdaq يجتاز الشروط، و S&P 500 موجب
function judge(ndx, spx, criteria = config.criteria) {
  const reasons = [];
  if (ndx.count < criteria.minTrades) reasons.push(`صفقات Nasdaq أقل من ${criteria.minTrades}`);
  if (!(ndx.profitFactor >= criteria.minProfitFactor)) reasons.push(`معامل ربح Nasdaq أقل من ${criteria.minProfitFactor}`);
  if (!(ndx.totalR > 0)) reasons.push('Nasdaq غير رابح');
  if (!(spx.totalR > 0)) reasons.push('S&P 500 غير رابح (فنتيجة Nasdaq صدفة على الأرجح)');
  return { pass: reasons.length === 0, reasons };
}

const STRATEGIES = { 'EMA + MACD': runEmaMacd, 'RSI(2)': runRsi2 };

module.exports = { runEmaMacd, runRsi2, metrics, judge, sma, rsiWilder, nights, STRATEGIES };
