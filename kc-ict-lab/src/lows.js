// فكرة كمال: "عندما يصل السعر لقاع سابق يرتد في أغلب الأوقات". npm run lows
// القواعد ثابتة قبل التشغيل (2026-11-12)، على الذهب، بيانات Twelve Data الموجودة (5 و 15 دقيقة، و 1h مبنية من 15 دقيقة):
//   القاع: أدنى من 3 شموع قبله و 3 بعده، ولا يُعرف إلا بعد مرور 3 شموع. من آخر 100 شمعة.
//   القاع صالح إذا لم تُغلق أي شمعة تحته منذ تكوّنه، ويُستعمل مرة واحدة فقط.
//   الدخول: أمر شراء معلّق عند مستوى القاع. أول شمعة تأتي من فوقه وتلمسه = تنفيذ عند المستوى.
//   الوقف 5$ تحت الدخول، والهدف 15$ فوقه (ثابتان). إذا لمست شمعة التنفيذ الوقف = خسارة،
//   والهدف لا يُحسب في شمعة التنفيذ (احتياطاً). صفقة واحدة في كل مرة. سبريد XM 0.57$ يُخصم من كل صفقة.
//   شموع العطلة (الجمعة 17:00 → الأحد 18:00 بتوقيت نيويورك) تُحذف.
// النجاح: 100 صفقة، PF ≥ 1.2 بعد السبريد، الفترتان (70% / 30%) رابحتان، على إطارين على الأقل من 3.
const data = require('./data');

const P = { pivot: 3, lookback: 100, stop: 5, target: 15, spread: 0.57 };
const CRITERIA = { minTrades: 100, minProfitFactor: 1.2, minPasses: 2 };

function weekendClosed(time) {
  const d = new Date(time.slice(0, 10) + 'T00:00:00Z').getUTCDay();
  const h = Number(time.slice(11, 13));
  return d === 6 || (d === 5 && h >= 17) || (d === 0 && h < 18);
}

function group(candles, n) {
  const out = [];
  for (const c of candles) {
    const hour = c.time.slice(0, 13);
    const last = out.at(-1);
    if (n === 4 && last && last.time.slice(0, 13) === hour) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
    } else out.push({ ...c, time: n === 4 ? `${hour}:00:00` : c.time });
  }
  return out;
}

function simulate(candles, p = P) {
  const cs = candles.filter((c) => !weekendClosed(c.time));
  const L = p.pivot;
  const used = new Set();
  const trades = [];
  let open = null;
  for (let i = L * 2 + 1; i < cs.length; i++) {
    const c = cs[i];
    if (open) {
      if (c.low <= open.stop) [open.exit, open.outcome] = [open.stop, 'stop'];
      else if (c.high >= open.target) [open.exit, open.outcome] = [open.target, 'target'];
      if (open.exit != null) {
        trades.push({ time: open.time, closedAt: c.time, r: (open.exit - open.entry - p.spread) / p.stop, outcome: open.outcome });
        open = null;
      }
      continue;
    }
    // القيعان المؤكدة قبل الشمعة الحالية، غير المكسورة، وغير المستعملة
    let level = null;
    for (let j = i - L - 1; j >= Math.max(L, i - p.lookback); j--) {
      if (used.has(j)) continue;
      let pivot = true;
      for (let k = 1; k <= L && pivot; k++) if (!(cs[j].low < cs[j - k].low && cs[j].low <= cs[j + k].low)) pivot = false;
      if (!pivot) continue;
      let broken = false;
      for (let k = j + 1; k < i && !broken; k++) if (cs[k].close < cs[j].low) broken = true;
      if (broken) continue;
      // الأقرب تحت السعر الحالي
      if (level === null || cs[j].low > level.price) level = { j, price: cs[j].low };
    }
    if (!level || !(c.open > level.price && c.low <= level.price)) continue;
    used.add(level.j);
    const entry = level.price;
    open = { time: c.time, entry, stop: entry - p.stop, target: entry + p.target };
    // شمعة التنفيذ: لمس الوقف فيها = خسارة
    if (c.low <= open.stop) {
      trades.push({ time: c.time, closedAt: c.time, r: (open.stop - entry - p.spread) / p.stop, outcome: 'stop' });
      open = null;
    }
  }
  return { trades, days: cs };
}

function evaluate(trades, candles, c = CRITERIA) {
  const cut = candles[Math.floor(candles.length * 0.7)].time;
  const sum = (ts) => ts.reduce((s, t) => s + t.r, 0);
  const wins = trades.filter((t) => t.r > 0);
  const gw = sum(wins);
  const gl = -sum(trades.filter((t) => t.r < 0));
  const r = {
    count: trades.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    totalR: sum(trades),
    profitFactor: gl ? gw / gl : trades.length ? Infinity : 0,
    first: sum(trades.filter((t) => t.time < cut)),
    last: sum(trades.filter((t) => t.time >= cut)),
  };
  const reasons = [];
  if (r.count < c.minTrades) reasons.push(`صفقات أقل من ${c.minTrades}`);
  if (!(r.profitFactor >= c.minProfitFactor)) reasons.push(`PF أقل من ${c.minProfitFactor}`);
  if (!(r.first > 0)) reasons.push('الفترة الأولى خاسرة');
  if (!(r.last > 0)) reasons.push('الفترة الأخيرة خاسرة');
  return { ...r, pass: !reasons.length, reasons };
}

module.exports = { simulate, evaluate, weekendClosed, group, P };

if (require.main === module) {
  // أرقام أخرى للوقف والهدف: npm run lows -- 3 6   (الوقف ثم الهدف بالدولار)
  const [stopArg, targetArg] = process.argv.slice(2).map(Number);
  if (stopArg > 0 && targetArg > 0) Object.assign(P, { stop: stopArg, target: targetArg });
  const fmt = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
  const need = ((P.stop + P.spread) / (P.stop + P.target)) * 100;
  console.log(`شراء عند القيعان السابقة — الذهب — وقف ${P.stop}$ وهدف ${P.target}$، سبريد ${P.spread}$`);
  console.log(`الصدفة وحدها (سوق عشوائي): ~${((P.stop / (P.stop + P.target)) * 100).toFixed(0)}% تصل للهدف.`);
  console.log(`نسبة الربح اللازمة للتعادل: ~${need.toFixed(0)}%. الشروط: ${CRITERIA.minTrades} صفقة، PF ≥ ${CRITERIA.minProfitFactor}، الفترتان رابحتان، على إطارين من 3.\n`);
  const c5 = data.load('XAU-5min');
  const c15 = data.load('XAU-15min');
  if (!c5 || !c15) {
    console.log('لا توجد بيانات. شغّل أولاً: npm run fetch-data');
    process.exit(1);
  }
  let passes = 0;
  for (const [tf, cs] of [['5min', c5], ['15min', c15], ['1h', group(c15, 4)]]) {
    const { trades, days } = simulate(cs);
    const r = evaluate(trades, days);
    if (r.pass) passes++;
    const targets = trades.filter((t) => t.outcome === 'target').length;
    console.log(`${r.pass ? '✅' : '❌'} ${tf}: ${r.count} صفقة | الهدف ${targets} (${r.winRate.toFixed(0)}%) | PF ${Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞'} | ${fmt(r.totalR)}R`);
    console.log(`   الفترة الأولى ${fmt(r.first)}R | الأخيرة ${fmt(r.last)}R${r.pass ? '' : ` | السبب: ${r.reasons.join('، ')}`}`);
  }
  console.log(`\n${passes >= CRITERIA.minPasses ? `✅ نجحت على ${passes} من 3` : `❌ نجحت على ${passes} فقط من 3: لا نعتمدها`}`);
  console.log(`R = المخاطرة (${P.stop}$ لكل وحدة). الربح الكامل = +${((P.target - P.spread) / P.stop).toFixed(2)}R، والخسارة = −${((P.stop + P.spread) / P.stop).toFixed(2)}R.`);
}
