const { config, DECISIONS } = require('./config');

function metrics(trades, startBalance) {
  let equity = startBalance;
  let peak = startBalance;
  let maxDd = 0;
  let maxDdPct = 0;
  let streak = 0;
  let longest = 0;
  for (const t of trades) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
    maxDdPct = Math.max(maxDdPct, ((peak - equity) / peak) * 100);
    streak = t.pnl < 0 ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const sum = (list, f) => list.reduce((s, t) => s + f(t), 0);
  const avg = (list, f) => (list.length ? sum(list, f) / list.length : 0);
  const grossWin = sum(wins, (t) => t.pnl);
  const grossLoss = -sum(losses, (t) => t.pnl);
  return {
    total: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    net: equity - startBalance,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDd,
    maxDdPct,
    avgWin: avg(wins, (t) => t.pnl),
    avgLoss: avg(losses, (t) => t.pnl),
    avgWinR: avg(wins, (t) => t.r),
    avgLossR: avg(losses, (t) => t.r),
    avgR: avg(trades, (t) => t.r),
    longestLosingStreak: longest,
  };
}

const n = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '∞');
const day = (t) => new Date(t).toISOString().slice(0, 10);
const ts = (t) => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : '');

function block(title, m) {
  return [
    `== ${title} ==`,
    `الصفقات: ${m.total} | رابحة: ${m.wins} | خاسرة: ${m.losses} | نسبة الربح: ${n(m.winRate, 1)}%`,
    `صافي الربح: ${n(m.net)}$ | معامل الربح: ${n(m.profitFactor)} | أكبر تراجع: ${n(m.maxDd)}$ (${n(m.maxDdPct, 1)}%)`,
    `متوسط الربح: ${n(m.avgWin, 3)}$ (${n(m.avgWinR)}R) | متوسط الخسارة: ${n(m.avgLoss, 3)}$ (${n(m.avgLossR)}R) | RR الفعلي: ${
      m.avgLossR ? n(m.avgWinR / -m.avgLossR) : '-'
    } | متوسط R: ${n(m.avgR)}`,
    `أطول سلسلة خسائر: ${m.longestLosingStreak}`,
    '',
  ];
}

function buildReport({ result, altResult, quality, meta }) {
  const start = config.risk.initialBalance;
  const cutoff = result.start + (result.end - result.start) * config.backtest.trainShare;
  const inS = result.trades.filter((t) => t.entryTime < cutoff);
  const outS = result.trades.filter((t) => t.entryTime >= cutoff);
  const pairs = Object.keys(config.pairs);
  const reasons = {};
  for (const s of result.skipped) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;

  return [
    'KC Breakout + Retest V1 — اختبار تاريخي (بدون أي تداول)',
    `المصدر: Binance (data-api.binance.vision) | التحميل: ${meta?.fetchedAt ?? '-'}`,
    `الفترة: ${day(result.start)} إلى ${day(result.end)} (UTC) | الرصيد الابتدائي: ${start}$ | المخاطرة: ${config.risk.riskPct}%`,
    `الرسوم: ${config.risk.feeRate * 100}% لكل جهة | الانزلاق: ${config.risk.slippagePct}% دخولاً وخروجاً`,
    '',
    'جودة البيانات:',
    ...Object.entries(quality ?? {}).map(([k, q]) => `• ${k}: ${q.count} شمعة | مكررة: ${q.duplicates} | فجوات: ${q.gaps.length} (${q.missingTotal} شمعة مفقودة)`),
    '',
    ...block('الإجمالي', metrics(result.trades, start)),
    ...pairs.flatMap((p) => block(p, metrics(result.trades.filter((t) => t.pair === p), start))),
    ...block(`داخل العينة 70% (حتى ${day(cutoff)})`, metrics(inS, start)),
    ...block(`خارج العينة 30% (بعد ${day(cutoff)})`, metrics(outS, start)),
    ...pairs.flatMap((p) => [
      `${p} داخل العينة: ${metrics(inS.filter((t) => t.pair === p), start).total} صفقة، صافي ${n(metrics(inS.filter((t) => t.pair === p), start).net)}$ | خارج العينة: ${
        metrics(outS.filter((t) => t.pair === p), start).total
      } صفقة، صافي ${n(metrics(outS.filter((t) => t.pair === p), start).net)}$`,
    ]),
    '',
    `مقارنة الرسوم (للمعلومة فقط): بـ ${config.risk.altFeeRate * 100}% (BNB) صافي الربح = ${n(metrics(altResult.trades, start).net)}$`,
    '',
    `الفرص المتخطاة: ${result.skipped.length}`,
    ...Object.entries(reasons)
      .sort((a, b) => b[1] - a[1])
      .map(([r, c]) => `• ${r}: ${c}`),
    '',
    result.openAtEnd ? `ملاحظة: ${result.openAtEnd} صفقة مفتوحة في نهاية البيانات لم تُحسب.\n` : '',
    'قرارات التفسير (مسجلة قبل الاختبار):',
    ...DECISIONS,
    '',
    'القواعد لم تُعدّل. النتائج الماضية لا تضمن المستقبل.',
  ].join('\n');
}

const csv = (rows) => rows.map((r) => r.map((v) => (typeof v === 'string' && v.includes(',') ? `"${v}"` : v)).join(',')).join('\n');

function tradesCsv(trades) {
  return csv([
    ['pair', 'signal_time', 'entry_time', 'exit_time', 'zone_level', 'zone_bottom', 'zone_top', 'touches', 'breakout_time', 'breakout_body_pct', 'breakout_volume_x', 'breakout_close_above_atr', 'retest_touch_time', 'retest_low', 'entry', 'stop_loss', 'take_profit', 'qty', 'notional', 'risk_usd', 'fees_usd', 'slippage_usd', 'outcome', 'pnl_usd', 'r', 'balance_after'],
    ...trades.map((t) => [
      t.pair,
      ts(t.signalTime),
      ts(t.entryTime),
      ts(t.exitTime),
      t.zone.level.toFixed(2),
      t.zone.bottom.toFixed(2),
      t.zone.top.toFixed(2),
      t.zone.touches,
      ts(t.breakout.time),
      t.breakout.bodyPct.toFixed(0),
      t.breakout.volumeRatio.toFixed(2),
      t.breakout.closeAboveAtr.toFixed(2),
      ts(t.retest.touchTime),
      t.retest.low?.toFixed(2),
      t.entry.toFixed(2),
      t.stopLoss.toFixed(2),
      t.takeProfit.toFixed(2),
      t.qty,
      t.notional.toFixed(2),
      t.riskAmount.toFixed(3),
      t.fees.toFixed(4),
      t.slippageCost.toFixed(4),
      t.outcome,
      t.pnl.toFixed(4),
      t.r.toFixed(3),
      t.balanceAfter.toFixed(4),
    ]),
  ]);
}

const equityCsv = (result) =>
  csv([['time', 'balance'], [ts(result.start), config.risk.initialBalance], ...result.equity.map((e) => [ts(e.time), e.balance.toFixed(4)])]);

module.exports = { metrics, buildReport, tradesCsv, equityCsv };
