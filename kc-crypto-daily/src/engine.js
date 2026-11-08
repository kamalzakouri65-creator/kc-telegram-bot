// محاكاة شراء فقط بنفس إدارة البوت: نصف عند الهدف 1 ونصف عند الهدف 2، والوقف أولاً عند التعارض.
// الاستراتيجيتان من بوت الذهب كما هما (قراءة فقط).
const { analyze } = require('../../gold-forex-signals-bot/src/strategy');
const { analyzePullback } = require('../../gold-forex-signals-bot/src/pullback');
const { config } = require('./config');

const STRATEGIES = { 'EMA + MACD': analyze, Pullback: analyzePullback };
const WINDOW = 500;

// costPct: التكلفة الكلية للصفقة كنسبة من السعر (رسوم الدخول والخروج + الانزلاق)
function runLongOnly(candles, analyzeFn, { from, to = '9999', costPct = 2 * (config.costs.feePct + config.costs.slippagePct) } = {}) {
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
        trades.push({ time: open.time, closedAt: c.time, entry: open.entry, stopLoss: open.stopLoss, r: (open.halves[0].r + open.halves[1].r) / 2 - cost });
        open = null;
      }
      continue;
    }
    if (c.time < from || c.time > to) continue;
    const s = analyzeFn(candles.slice(Math.max(0, i + 1 - WINDOW), i + 1));
    if (!s || s.side !== 'BUY') continue;
    const risk = s.entry - s.stopLoss;
    if (!(risk > 0)) continue;
    open = { time: s.time, entry: s.entry, stopLoss: s.stopLoss, risk, halves: [{ target: s.takeProfit1, r: null }, { target: s.takeProfit2, r: null }] };
  }
  return trades;
}

function metrics(trades) {
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of trades) {
    equity += t.r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  const wins = trades.filter((t) => t.r > 0);
  const gw = wins.reduce((s, t) => s + t.r, 0);
  const gl = -trades.filter((t) => t.r < 0).reduce((s, t) => s + t.r, 0);
  return { count: trades.length, winRate: trades.length ? (wins.length / trades.length) * 100 : 0, totalR: equity, profitFactor: gl ? gw / gl : trades.length ? Infinity : 0, maxDd };
}

// الحكم على استراتيجية عبر العملات الأربع
function judge(byPair, criteria = config.criteria) {
  const all = Object.values(byPair).flat().sort((a, b) => (a.closedAt < b.closedAt ? -1 : 1));
  const m = metrics(all);
  const positive = Object.values(byPair).filter((t) => metrics(t).totalR > 0).length;
  const reasons = [];
  if (positive < criteria.minPositivePairs) reasons.push(`رابحة على ${positive} عملات فقط (المطلوب ${criteria.minPositivePairs})`);
  if (!(m.profitFactor >= criteria.minProfitFactor)) reasons.push(`معامل الربح أقل من ${criteria.minProfitFactor}`);
  if (m.count < criteria.minTrades) reasons.push(`صفقات أقل من ${criteria.minTrades}`);
  return { ...m, positive, pass: reasons.length === 0, reasons };
}

module.exports = { runLongOnly, metrics, judge, STRATEGIES };
