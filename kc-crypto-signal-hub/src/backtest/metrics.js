// مقاييس الأداء من قائمة صفقات مغلقة: { pnl, r }
function computeMetrics(trades, startBalance) {
  let equity = startBalance;
  let peak = startBalance;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let streak = 0;
  let longestLosingStreak = 0;
  for (const t of trades) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
    streak = t.pnl < 0 ? streak + 1 : 0;
    longestLosingStreak = Math.max(longestLosingStreak, streak);
  }
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = -losses.reduce((s, t) => s + t.pnl, 0);
  const n = trades.length;
  const netProfit = equity - startBalance;
  return {
    totalTrades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? (wins.length / n) * 100 : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    netProfit,
    netProfitPct: (netProfit / startBalance) * 100,
    maxDrawdown,
    maxDrawdownPct,
    avgR: n ? trades.reduce((s, t) => s + t.r, 0) / n : 0,
    // التوقع: متوسط الربح أو الخسارة لكل صفقة بالدولار
    expectancy: n ? netProfit / n : 0,
    longestLosingStreak,
  };
}

module.exports = { computeMetrics };
