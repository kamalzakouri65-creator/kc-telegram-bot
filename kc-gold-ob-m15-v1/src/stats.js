// الإحصائيات والتقسيم والحكم. الربح = R > 0، والخسارة = R < 0.
function metrics(trades) {
  const rs = trades.map((t) => t.r);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const gw = wins.reduce((a, b) => a + b, 0);
  const gl = -losses.reduce((a, b) => a + b, 0);
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  let run = 0;
  let worst = 0;
  for (const r of rs) {
    cum += r;
    peak = Math.max(peak, cum);
    maxDd = Math.max(maxDd, peak - cum);
    run = r < 0 ? run + 1 : 0;
    worst = Math.max(worst, run);
  }
  // التراجع بالنسبة المئوية من منحنى الرصيد
  let ePeak = trades.length ? trades[0].equityBefore : 0;
  let ddPct = 0;
  for (const t of trades) {
    ePeak = Math.max(ePeak, t.equityBefore, t.equityAfter);
    ddPct = Math.max(ddPct, ((ePeak - t.equityAfter) / ePeak) * 100);
  }
  const n = rs.length;
  return {
    n,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? (wins.length / n) * 100 : 0,
    pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    net: cum,
    exp: n ? cum / n : 0,
    maxDd,
    ddPct,
    worst,
    avgWin: wins.length ? gw / wins.length : 0,
    avgLoss: losses.length ? -gl / losses.length : 0,
    usd: trades.reduce((a, t) => a + t.pnl, 0),
  };
}

// حدود التقسيم الزمني 60/20/20 على فترة البيانات
function splitBounds(startMs, endMs, split) {
  const span = endMs - startMs;
  return { start: startMs, devEnd: startMs + span * split.dev, valEnd: startMs + span * (split.dev + split.val), end: endMs };
}
// الصفقة تُنسب لقسم وقت دخولها
const splitOf = (ms, b) => (ms < b.devEnd ? 'dev' : ms < b.valEnd ? 'val' : 'oos');

// الحكم المسجل مسبقاً
function verdict({ dev, val, oos }, doubledTotal, v) {
  if (oos.n < v.minOosTrades) return { verdict: 'INSUFFICIENT DATA', reasons: [`Out-of-Sample فيه ${oos.n} صفقة فقط (الحد الأدنى ${v.minOosTrades})`] };
  const reasons = [];
  for (const [name, m] of [['Development', dev], ['Validation', val], ['Out-of-Sample', oos]]) if (!(m.pf >= v.minPf)) reasons.push(`${name}: PF ${fmtPf(m.pf)} أقل من ${v.minPf}`);
  if (!(doubledTotal.net > 0)) reasons.push(`ضعف السبريد: الصافي ${doubledTotal.net.toFixed(1)}R ليس موجباً`);
  if (!(doubledTotal.pf > v.doubledMinPf)) reasons.push(`ضعف السبريد: PF ${fmtPf(doubledTotal.pf)} ليس أكبر من ${v.doubledMinPf.toFixed(2)}`);
  return { verdict: reasons.length ? 'NOT PROFITABLE' : 'PROFITABLE', reasons };
}
const fmtPf = (pf) => (Number.isFinite(pf) ? pf.toFixed(2) : '∞');

function quantiles(xs, qs) {
  if (!xs.length) return qs.map(() => NaN);
  const s = [...xs].sort((a, b) => a - b);
  return qs.map((q) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]);
}

module.exports = { metrics, splitBounds, splitOf, verdict, fmtPf, quantiles };
