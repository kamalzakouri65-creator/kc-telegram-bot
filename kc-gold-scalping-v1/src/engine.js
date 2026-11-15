// محاكاة التنفيذ (ورقي فقط): الجلسات، والأخبار، وصفقة واحدة، وحدود اليوم، والحجم، و Break Even، والإغلاق 13:00 نيويورك.
// mode 'R': مخاطرة 1R ثابتة (حجم مثالي)، لقياس الاستراتيجية نفسها.
// mode 'usd': حساب 500$ بمخاطرة 1% من الرصيد الحالي، والحجم بخطوات 0.01، وتُتخطى الصفقة إذا كان أصغر حجم أكبر من المخاطرة.
const { RULES, SESSIONS, FORCE_EXIT, NEWS_MINUTES, FOMC, RISK, COSTS } = require('./rules');
const { nyClock } = require('./hours');

const pad = (n) => String(n).padStart(2, '0');
const nyInfo = (ms) => {
  const d = nyClock(ms);
  return { date: d.toISOString().slice(0, 10), hm: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`, minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay(), dom: d.getUTCDate(), month: d.getUTCMonth() };
};
const sessionOf = (hm) => SESSIONS.find((s) => hm >= s.from && hm < s.to)?.name ?? null;

// NFP: أول جمعة في الشهر (يناير: الجمعة الثانية) 08:30 نيويورك. FOMC: 14:00 نيويورك
function newsBlocked(info) {
  const near = (h, m) => Math.abs(info.minutes - (h * 60 + m)) <= NEWS_MINUTES;
  const firstFriday = info.dow === 5 && info.dom <= 7;
  const nfpDay = info.month === 0 ? info.dow === 5 && info.dom >= 8 && info.dom <= 14 : firstFriday;
  if (nfpDay && near(8, 30)) return 'NFP';
  if (FOMC.includes(info.date) && near(14, 0)) return 'FOMC';
  return null;
}

function simulate(m1, setups, { mode = 'R', spread = COSTS.spread, slippage = COSTS.slippage, commission = COSTS.commission, rules = RULES, risk = RISK } = {}) {
  const cost = spread + slippage + commission;
  const trades = [];
  const skipped = {};
  const skip = (why) => (skipped[why] = (skipped[why] ?? 0) + 1);
  let busyUntil = -1;
  let balance = risk.balance;
  const day = { date: null, count: 0, streak: 0, pnl: 0, startBalance: balance };
  for (const s of setups) {
    const k = s.fillIdx;
    if (k <= busyUntil) {
      skip('صفقة مفتوحة');
      continue;
    }
    const info = nyInfo(m1[k].ms);
    const session = sessionOf(info.hm);
    if (!session) {
      skip('خارج الجلسات');
      continue;
    }
    const news = newsBlocked(info);
    if (news) {
      skip(`أخبار ${news}`);
      continue;
    }
    if (day.date !== info.date) Object.assign(day, { date: info.date, count: 0, streak: 0, pnl: 0, startBalance: balance });
    if (day.count >= risk.maxTradesPerDay) {
      skip('3 صفقات في اليوم');
      continue;
    }
    if (day.streak >= risk.maxConsecutiveLosses) {
      skip('3 خسائر متتالية');
      continue;
    }
    const dayLimit = mode === 'R' ? risk.maxDailyLossPct / risk.riskPct : (day.startBalance * risk.maxDailyLossPct) / 100;
    if (-day.pnl >= dayLimit) {
      skip('حد الخسارة اليومية');
      continue;
    }
    let lots = null;
    if (mode === 'usd') {
      const riskUsd = (balance * risk.riskPct) / 100;
      lots = Math.floor(riskUsd / (s.risk * risk.contractSize) / risk.lotStep + 1e-9) * risk.lotStep;
      if (lots < risk.minLot) {
        skip('أصغر حجم أكبر من 1%');
        continue;
      }
    }
    // إدارة الصفقة
    const dir = s.dir;
    const target = s.entry + dir * rules.rewardRisk * s.risk;
    let stop = s.stop;
    let be = false;
    let exit = null;
    const hitStop = (c) => (dir === 1 ? c.low <= stop : c.high >= stop);
    if (hitStop(m1[k])) exit = { idx: k, price: stop, how: 'وقف' };
    for (let t = k + 1; !exit && t < m1.length; t++) {
      const ti = nyInfo(m1[t].ms);
      if (ti.date !== info.date || ti.hm >= FORCE_EXIT) {
        exit = { idx: t - 1, price: m1[t - 1].close, how: 'وقت' };
        break;
      }
      const c = m1[t];
      if (hitStop(c)) exit = { idx: t, price: stop, how: be ? 'تعادل' : 'وقف' };
      else if (dir === 1 ? c.high >= target : c.low <= target) exit = { idx: t, price: target, how: 'هدف' };
      else if (!be && dir * ((dir === 1 ? c.high : c.low) - s.entry) >= rules.breakEvenR * s.risk) {
        be = true;
        stop = s.entry; // من الشمعة التالية
      }
    }
    if (!exit) exit = { idx: m1.length - 1, price: m1.at(-1).close, how: 'وقت' };
    const r = (dir * (exit.price - s.entry) - cost) / s.risk;
    const usd = mode === 'usd' ? lots * risk.contractSize * (dir * (exit.price - s.entry) - cost) : null;
    const pnl = mode === 'usd' ? usd : r;
    balance += mode === 'usd' ? usd : 0;
    day.count++;
    day.pnl += pnl;
    day.streak = pnl < 0 ? day.streak + 1 : 0;
    busyUntil = exit.idx;
    trades.push({ date: info.date, month: info.date.slice(0, 7), session, side: dir === 1 ? 'BUY' : 'SELL', kind: s.kind, entryTime: m1[k].time, exitTime: m1[exit.idx].time, entry: s.entry, stop: s.stop, target, risk: s.risk, exit: exit.price, how: exit.how, r, lots, usd, balance: mode === 'usd' ? balance : null });
  }
  return { trades, skipped, endBalance: balance };
}

module.exports = { simulate, newsBlocked, sessionOf, nyInfo };
