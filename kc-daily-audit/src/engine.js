// محركات بنافذة قابلة للتغيير. القواعد من البوت (قراءة فقط)، والإدارة والتكاليف منسوخة حرفياً من kc-nasdaq-daily و kc-crypto-daily.
const { analyzeRsi2, sma } = require('../../gold-forex-signals-bot/src/rsi2');
const { nights } = require('../../kc-nasdaq-daily/src/engine');
const { config: ndxConfig } = require('../../kc-nasdaq-daily/src/config');
const { config: cryptoConfig } = require('../../kc-crypto-daily/src/config');

const costR = (entry, risk, entryDay, exitDay, spreadPct) => ((entry * (spreadPct + nights(entryDay, exitDay) * ndxConfig.swapPctPerNight)) / 100) / risk;

// RSI(2): الإشارة من آخر `window` شمعة فقط (مثل البوت الحي)، والخروج كما في kc-nasdaq-daily
function runRsi2Windowed(candles, { from, to = '9999', spreadPct, window = Infinity }) {
  const p = ndxConfig.rsi2;
  const exitMa = sma(candles.map((c) => c.close), p.smaExit);
  const trades = [];
  let open = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (open) {
      open.bars++;
      let exit = null;
      if (c.low <= open.stop) exit = Math.min(open.stop, c.open);
      else if (c.close > exitMa[i] || open.bars >= p.maxBars) exit = c.close;
      if (exit !== null) {
        trades.push({ time: open.time, closedAt: c.time, r: (exit - open.entry) / open.risk - costR(open.entry, open.risk, open.time, c.time, spreadPct) });
        open = null;
      }
      continue;
    }
    if (c.time < from || c.time > to) continue;
    const s = analyzeRsi2(candles.slice(Number.isFinite(window) ? Math.max(0, i + 1 - window) : 0, i + 1));
    if (!s) continue;
    open = { time: c.time, entry: s.entry, stop: s.stopLoss, risk: s.entry - s.stopLoss, bars: 0 };
  }
  return trades;
}

// الكريبتو: نسخة من runLongOnly في kc-crypto-daily مع نافذة متغيرة
function runCryptoWindowed(candles, analyzeFn, { from = '0000', to = '9999', window = 500 } = {}) {
  const costPct = 2 * (cryptoConfig.costs.feePct + cryptoConfig.costs.slippagePct);
  const trades = [];
  let open = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (open) {
      const stopHit = c.low <= open.stopLoss;
      for (const half of open.halves) {
        if (half.r !== null) continue;
        if (stopHit) half.r = -1;
        else if (c.high >= half.target) half.r = (half.target - open.entry) / open.risk;
      }
      if (open.halves.every((h) => h.r !== null)) {
        const cost = (open.entry * costPct) / 100 / open.risk;
        trades.push({ time: open.time, closedAt: c.time, r: (open.halves[0].r + open.halves[1].r) / 2 - cost });
        open = null;
      }
      continue;
    }
    if (c.time < from || c.time > to) continue;
    const s = analyzeFn(candles.slice(Math.max(0, i + 1 - window), i + 1));
    if (!s || s.side !== 'BUY') continue;
    const risk = s.entry - s.stopLoss;
    if (!(risk > 0)) continue;
    open = { time: s.time, entry: s.entry, stopLoss: s.stopLoss, risk, halves: [{ target: s.takeProfit1, r: null }, { target: s.takeProfit2, r: null }] };
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
  return { n: trades.length, winRate: trades.length ? (wins.length / trades.length) * 100 : 0, net: eq, pf: gl ? gw / gl : trades.length && gw > 0 ? Infinity : 0, maxDd: dd };
}

const flatShare = (candles) => (candles.length ? candles.filter((c) => c.high === c.low).length / candles.length : 1);

module.exports = { runRsi2Windowed, runCryptoWindowed, metrics, flatShare, costR };
