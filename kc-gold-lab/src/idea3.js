// الفكرة 3 — الارتداد خلال اليوم: RSI(2) على 15 دقيقة في اتجاه الترند اليومي. مسجلة قبل أي نتيجة (2026-11-19).
//   الاتجاه: إغلاق الأمس (يوم لندن) فوق متوسط 20 يوماً = شراء فقط، وتحته = بيع فقط.
//   الدخول: RSI(2) < 10 للشراء، > 90 للبيع، بين 07:00 و 20:00 لندن، عند إغلاق الشمعة.
//   الوقف: 2 × ATR(14) على 15 دقيقة (تخطي إذا كان أقل من 3$). الخروج: أول إغلاق فوق متوسط 5 شموع (تحته للبيع)،
//   أو بعد 8 شموع، أو عند 20:00 لندن. صفقة واحدة مفتوحة. المتانة: RSI 5/10/15 × متوسط الخروج 3/5/8.
const { config } = require('./config');
const { london } = require('./timezone');
const { byLondonDay } = require('./sessions');
const { trendByDay } = require('./trend');
const { tradeCost } = require('./costs');
const { sma, rsiWilder } = require('../../kc-nasdaq-daily/src/engine');

const RULE3 = { rsiBelow: 10, exitSma: 5, maxBars: 8, stopAtr: 2, minRisk: 3, from: 7, to: 20, trendDays: 20 };
const GRID3 = { rsiBelow: [5, 10, 15], exitSma: [3, 5, 8] };

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

function idea3Trades(bars, rule = RULE3, { spreadMult = 1 } = {}) {
  const closes = bars.map((b) => b.close);
  const r2 = rsiWilder(closes, 2);
  const ma = sma(closes, rule.exitSma);
  const a = atr(bars);
  const trend = trendByDay(byLondonDay(bars), rule.trendDays);
  const cost = tradeCost(spreadMult);
  const out = [];
  let open = null;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const t = london(b.ms);
    const h = t.hour + t.minute / 60;
    if (open) {
      let exit = null;
      let how = null;
      let at = b.time;
      if (t.day !== open.day || h >= rule.to) [exit, how, at] = [bars[i - 1].close, 'وقت', bars[i - 1].time];
      else {
        open.bars++;
        const stopHit = open.dir === 1 ? b.low <= open.stop : b.high >= open.stop;
        if (stopHit) [exit, how] = [open.dir === 1 ? Math.min(open.stop, b.open) : Math.max(open.stop, b.open), 'وقف'];
        else if (open.dir === 1 ? b.close > ma[i] : b.close < ma[i]) [exit, how] = [b.close, 'متوسط'];
        else if (open.bars >= rule.maxBars) [exit, how] = [b.close, 'مدة'];
      }
      if (exit !== null) {
        out.push({ day: open.day, year: open.day.slice(0, 4), time: open.time, exitTime: at, dir: open.dir, how, r: (open.dir * (exit - open.entry) - cost) / open.risk });
        open = null;
        if (how === 'وقت') i--; // نعيد فحص هذه الشمعة كدخول محتمل
      }
      continue;
    }
    if (h < rule.from || h >= rule.to || r2[i] === null || a[i] === null || ma[i] === null) continue;
    const dir = trend.get(t.day);
    if (!dir) continue;
    const signal = dir === 1 ? r2[i] < rule.rsiBelow : r2[i] > 100 - rule.rsiBelow;
    if (!signal) continue;
    const risk = rule.stopAtr * a[i];
    if (risk < rule.minRisk) continue;
    open = { day: t.day, time: b.time, dir, entry: b.close, stop: b.close - dir * risk, risk, bars: 0 };
  }
  return out;
}

module.exports = { RULE3, GRID3, idea3Trades };
