// حجم الصفقة اليدوية لحساب XM Micro: أكبر حجم (بخطوات 0.1 لوت) لا تتجاوز خسارته عند الوقف الحد المحدد.
// هذا للعرض فقط في رسالة الإشارة، ولا علاقة له بالتداول الآلي.

// عدد الأونصات في 1 لوت في حساب XM Micro (من مواصفات GOLDmicro وصفقة SILVERmicro)
const MICRO_UNITS_PER_LOT = { 'XAU/USD': 1, 'XAG/USD': 50 };
const LOT_STEP = 0.1;

function suggestLot(symbol, entry, stopLoss, maxLossUsd) {
  const units = MICRO_UNITS_PER_LOT[symbol];
  if (!units || !(maxLossUsd > 0)) return null;
  const distance = Math.abs(entry - stopLoss);
  const lossPerStep = distance * units * LOT_STEP;
  const steps = Math.floor(maxLossUsd / lossPerStep + 1e-9);
  if (steps < 1) return { ok: false, distance, minLoss: lossPerStep };
  const lot = Math.round(steps * LOT_STEP * 10) / 10;
  return { ok: true, distance, lot, loss: steps * lossPerStep };
}

// اسم الإطار كما يظهر في MT5
const TIMEFRAMES = {
  '5min': '5 دقائق (M5)',
  '15min': '15 دقيقة (M15)',
  '30min': '30 دقيقة (M30)',
  '1h': 'ساعة واحدة (H1)',
  '4h': '4 ساعات (H4)',
  '1day': 'يوم واحد (D1)',
};
const timeframeLabel = (interval) => TIMEFRAMES[interval] ?? interval;
const mt5Code = (interval) => (TIMEFRAMES[interval] ?? '').match(/\((\w+)\)/)?.[1] ?? interval;

module.exports = { suggestLot, timeframeLabel, mt5Code, MICRO_UNITS_PER_LOT };
