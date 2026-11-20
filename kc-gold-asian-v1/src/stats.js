// الإحصائيات والتقسيم والحكم. الربح = R > 0، والخسارة = R < 0.
function metrics(trades) {
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  let run = 0;
  let worst = 0;
  let gw = 0;
  let gl = 0;
  let wins = 0;
  let losses = 0;
  for (const t of trades) {
    cum += t.r;
    peak = Math.max(peak, cum);
    maxDd = Math.max(maxDd, peak - cum);
    run = t.r < 0 ? run + 1 : 0;
    worst = Math.max(worst, run);
    if (t.r > 0) (gw += t.r), wins++;
    if (t.r < 0) (gl -= t.r), losses++;
  }
  let ePeak = trades.length ? trades[0].equityBefore : 0;
  let ddPct = 0;
  for (const t of trades) {
    ePeak = Math.max(ePeak, t.equityBefore ?? 0, t.equityAfter ?? 0);
    if (ePeak > 0) ddPct = Math.max(ddPct, ((ePeak - t.equityAfter) / ePeak) * 100);
  }
  const n = trades.length;
  return {
    n,
    wins,
    losses,
    winRate: n ? (wins / n) * 100 : 0,
    pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    net: cum,
    exp: n ? cum / n : 0,
    maxDd,
    ddPct,
    worst,
    avgWin: wins ? gw / wins : 0,
    avgLoss: losses ? -gl / losses : 0,
    usd: trades.reduce((a, t) => a + (t.pnl ?? 0), 0),
  };
}

function splitBounds(startMs, endMs, split) {
  const span = endMs - startMs;
  return { start: startMs, devEnd: startMs + span * split.dev, valEnd: startMs + span * (split.dev + split.val), end: endMs };
}
const splitOf = (ms, b) => (ms < b.devEnd ? 'dev' : ms < b.valEnd ? 'val' : 'holdout');

// الحكم المسجل مسبقاً (البند 9 في SPEC)
function verdict(c, C) {
  const fails = [];
  if (!(c.total.pf >= C.minPf)) fails.push(`PF الإجمالي ${fmtPf(c.total.pf)} أقل من ${C.minPf}`);
  if (!(c.total.exp > 0)) fails.push(`Expectancy الإجمالي ${c.total.exp.toFixed(3)}R ليس موجباً`);
  if (!(c.holdout.net > 0)) fails.push(`صافي Historical Holdout ${c.holdout.net.toFixed(1)}R ليس موجباً`);
  if (!(c.last6.net >= C.last6mMinR)) fails.push(`صافي آخر 6 أشهر ${c.last6.net.toFixed(1)}R أقل من ${C.last6mMinR}R`);
  if (!(c.doubled.net > 0)) fails.push(`الصافي بضعف السبريد ${c.doubled.net.toFixed(1)}R ليس موجباً`);
  if (!(c.positiveCombos >= C.minPositiveCombos)) fails.push(`المتانة: ${c.positiveCombos} من 9 تركيبات رابحة (المطلوب ${C.minPositiveCombos})`);
  const fewHoldout = c.holdout.n < C.minHoldoutTrades;
  const countNote = `Historical Holdout فيه ${c.holdout.n} صفقة (الحد الأدنى ${C.minHoldoutTrades})`;
  if (fails.length) return { verdict: 'FAIL', reasons: fewHoldout ? [...fails, countNote] : fails };
  if (fewHoldout) return { verdict: 'INSUFFICIENT DATA', reasons: [countNote] };
  return { verdict: 'PASS', reasons: [] };
}
const fmtPf = (pf) => (Number.isFinite(pf) ? pf.toFixed(2) : '∞');

module.exports = { metrics, splitBounds, splitOf, verdict, fmtPf };
