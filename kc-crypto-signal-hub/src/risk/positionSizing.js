// حجم الصفقة بحيث تكون الخسارة الصافية عند الوقف (مع الرسوم والانزلاق) = نسبة المخاطرة من الرصيد.
// لا نرفع الحجم أبداً للوصول إلى الحد الأدنى للطلب: إذا كانت الصفقة غير صالحة أو غير مجدية تُرفض.

const floorToStep = (qty, step) => {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number((Math.floor(qty / step + 1e-9) * step).toFixed(decimals));
};

function sizePosition({ balance, entry, stopLoss, pair, risk, rewardRisk }) {
  const reasons = [];
  const fee = risk.feeRate;
  const slip = risk.slippagePct / 100;
  const riskAmount = balance * (risk.riskPct / 100);

  if (!(entry > stopLoss) || !(stopLoss > 0)) {
    return { ok: false, reasons: ['الوقف ليس تحت سعر الدخول'] };
  }

  // تكاليف كل وحدة: رسوم الدخول والخروج، وانزلاق الدخول والخروج بالوقف
  const costPerUnit = entry * fee + stopLoss * fee + entry * slip + stopLoss * slip;
  const lossPerUnit = entry - stopLoss + costPerUnit;
  const feeShare = costPerUnit / lossPerUnit;

  const qty = floorToStep(riskAmount / lossPerUnit, pair.stepSize);
  const notional = qty * entry;

  // الهدف بحيث الربح الصافي (بعد رسوم الدخول والخروج وانزلاق الدخول) = rewardRisk × الخسارة الصافية
  const takeProfit = (entry * (1 + fee + slip) + rewardRisk * lossPerUnit) / (1 - fee);

  if (qty <= 0) reasons.push('الحجم أصغر من أقل وحدة مسموحة في Binance');
  if (qty > 0 && notional < pair.minNotional) reasons.push(`قيمة الصفقة ${notional.toFixed(2)}$ أقل من الحد الأدنى ${pair.minNotional}$`);
  if (notional > balance) reasons.push(`الصفقة تحتاج ${notional.toFixed(2)}$ وهو أكثر من الرصيد ${balance.toFixed(2)}$ (الوقف قريب جداً)`);
  if (feeShare > risk.maxFeeShare) {
    reasons.push(`غير مجدية: الرسوم والانزلاق ${(feeShare * 100).toFixed(0)}% من الخسارة عند الوقف`);
  }

  const lossAtStop = qty * lossPerUnit;
  const gainAtTarget = qty * ((takeProfit - entry) - entry * fee - takeProfit * fee - entry * slip);
  return {
    ok: reasons.length === 0,
    reasons,
    qty,
    notional,
    riskAmount,
    lossAtStop,
    gainAtTarget,
    feesEstimate: qty * (entry * fee + takeProfit * fee),
    feeShare,
    takeProfit,
    netRewardRisk: lossAtStop > 0 ? gainAtTarget / lossAtStop : 0,
  };
}

module.exports = { sizePosition, floorToStep };
