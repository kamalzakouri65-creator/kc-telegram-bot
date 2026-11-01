// اختبار: الدخول عند عودة السعر إلى Order Block والخروج بهدف ثابت بالدولار (مثل 10$).
// للاختبار فقط، ولا يستعمله البوت.
//   mode 'touch'  : أمر معلّق عند حافة البلوك، يُنفَّذ بمجرد أن يلمسه السعر
//   mode 'reject' : ننتظر إغلاق الشمعة رافضة للبلوك (كما في استراتيجية order-block)
// الوقف خلف البلوك بهامش 0.25 × ATR. الهدف = سعر الدخول ± target.
// تقدير متحفظ: إذا لمست شمعة الدخول الوقف تُحسب خسارة، وإذا لمست شمعة لاحقة الوقف والهدف معاً يُحسب الوقف.
const { atr } = require('./indicators');
const { pivots, findBlock } = require('./orderblock');

// نفس إعدادات analyzeOrderBlock
const BLOCK_OPTS = { pivotLength: 3, maxAge: 100, minImpulseAtr: 1.5 };
const SL_BUFFER_ATR = 0.25;
const WINDOW = 500;

// يبحث عن دخول على الشمعة الأخيرة. يُرجع null أو { side, entry, stopLoss, stoppedNow }
function entryAt(candles, mode) {
  const i = candles.length - 1;
  if (i < 60) return null;
  const c = candles[i];
  const atr14 = atr(candles, 14);
  const piv = pivots(candles, BLOCK_OPTS.pivotLength);

  for (const dir of [1, -1]) {
    const block = findBlock(candles, atr14, piv, dir, BLOCK_OPTS);
    if (!block) continue;
    const touched = dir === 1 ? c.low <= block.top : c.high >= block.bottom;
    if (!touched) continue;
    const stopLoss = dir === 1 ? block.bottom - SL_BUFFER_ATR * atr14[i] : block.top + SL_BUFFER_ATR * atr14[i];
    const side = dir === 1 ? 'BUY' : 'SELL';

    if (mode === 'touch') {
      // إذا افتتحت الشمعة داخل البلوك نُنفَّذ على سعر الافتتاح
      const edge = dir === 1 ? block.top : block.bottom;
      const entry = dir === 1 ? Math.min(edge, c.open) : Math.max(edge, c.open);
      const stoppedNow = dir === 1 ? c.low <= stopLoss : c.high >= stopLoss;
      if (dir * (entry - stopLoss) > 0) return { side, entry, stopLoss, stoppedNow };
    } else {
      const mid = (block.top + block.bottom) / 2;
      const rejected = dir === 1 ? c.close > c.open && c.close > mid : c.close < c.open && c.close < mid;
      if (rejected && dir * (c.close - stopLoss) > 0) return { side, entry: c.close, stopLoss, stoppedNow: false };
    }
  }
  return null;
}

// النتائج بالدولار لحجم 0.01 لوت على الذهب (كل 1$ حركة = 1$)
function simulate(candles, { mode, target, spread = 0 }) {
  const trades = [];
  let open = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (open) {
      const dir = open.side === 'BUY' ? 1 : -1;
      const stopHit = dir === 1 ? c.low <= open.stopLoss : c.high >= open.stopLoss;
      const targetHit = dir === 1 ? c.high >= open.target : c.low <= open.target;
      if (stopHit || targetHit) {
        const exit = stopHit ? open.stopLoss : open.target;
        trades.push({ pnl: dir * (exit - open.entry) - spread, risk: dir * (open.entry - open.stopLoss) });
        open = null;
      }
      continue;
    }
    const e = entryAt(candles.slice(Math.max(0, i + 1 - WINDOW), i + 1), mode);
    if (!e) continue;
    const dir = e.side === 'BUY' ? 1 : -1;
    if (e.stoppedNow) {
      trades.push({ pnl: dir * (e.stopLoss - e.entry) - spread, risk: dir * (e.entry - e.stopLoss) });
    } else {
      open = { ...e, target: e.entry + dir * target };
    }
  }
  return summarize(trades);
}

function summarize(trades) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let streak = 0;
  let worstStreak = 0;
  for (const t of trades) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    streak = t.pnl < 0 ? streak + 1 : 0;
    worstStreak = Math.max(worstStreak, streak);
  }
  const wins = trades.filter((t) => t.pnl > 0).length;
  return {
    count: trades.length,
    wins,
    winRate: trades.length ? wins / trades.length : 0,
    totalUsd: equity,
    avgRiskUsd: trades.length ? trades.reduce((s, t) => s + t.risk, 0) / trades.length : 0,
    maxDrawdownUsd: maxDrawdown,
    worstLosingStreak: worstStreak,
  };
}

module.exports = { entryAt, simulate };

// التشغيل: npm run backtest-ob [-- XAU/USD 1h 0.35]
if (require.main === module) {
  require('dotenv').config();
  const { fetchCandles } = require('./market');
  const [symbol = 'XAU/USD', interval = '1h', spreadArg = '0.35'] = process.argv.slice(2);
  const spread = Number(spreadArg);

  (async () => {
    const candles = await fetchCandles(symbol, interval, process.env.TWELVE_DATA_API_KEY, 5000);
    console.log(`${symbol} ${interval}: ${candles.length} شمعة من ${candles[0].time} إلى ${candles.at(-1).time}`);
    console.log(`السبريد: ${spread} | النتائج بالدولار لحجم 0.01 لوت\n`);
    for (const mode of ['touch', 'reject']) {
      console.log(mode === 'touch' ? '== الدخول عند لمس البلوك ==' : '== الدخول بعد شمعة الرفض ==');
      for (const target of [5, 10, 15, 20, 30]) {
        const s = simulate(candles, { mode, target, spread });
        console.log(
          `هدف ${target}$: صفقات ${s.count} | ربح ${(s.winRate * 100).toFixed(0)}% | المجموع ${s.totalUsd.toFixed(0)}$ | ` +
            `متوسط الوقف ${s.avgRiskUsd.toFixed(1)}$ | أكبر تراجع ${s.maxDrawdownUsd.toFixed(0)}$ | سلسلة خسائر ${s.worstLosingStreak}`
        );
      }
      console.log('');
    }
  })().catch((err) => {
    console.error('فشل الاختبار:', err.message);
    process.exit(1);
  });
}
