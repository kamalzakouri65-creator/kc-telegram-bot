// حسابات إدارة المخاطرة لتحويل الإشارة إلى صفقة: اسم الرمز في MT5، حجم اللوت، ومستويات الوقف والهدف.
// كلها دوال بلا اتصال بالشبكة حتى يسهل اختبارها.

// XAU/USD -> XAUUSD (بعض الوسطاء يضيفون لاحقة مثل XAUUSDm).
// الخريطة تتجاوز ذلك لمن يسمّي الرمز باسم مختلف، مثل GOLD عند XM
function toMtSymbol(symbol, suffix = '', map = {}) {
  return map[symbol] ?? symbol.replace('/', '') + suffix;
}

// "XAU/USD=GOLD,EUR/USD=EURUSD" -> { 'XAU/USD': 'GOLD', 'EUR/USD': 'EURUSD' }
function parseSymbolMap(text = '') {
  const map = {};
  for (const pair of text.split(',')) {
    const [from, to] = pair.split('=').map((s) => s.trim());
    if (from && to) map[from] = to;
  }
  return map;
}

// كم تساوي وحدة واحدة من عملة التسعير بعملة الحساب
function quoteToAccountRate(symbol, price, accountCurrency) {
  const [base, quote] = symbol.split('/');
  if (quote === accountCurrency) return 1;
  if (base === accountCurrency) return 1 / price;
  throw new Error(`لا يمكن تحويل ربح ${symbol} إلى ${accountCurrency}`);
}

function roundTo(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function stepDecimals(step) {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

// حجم اللوت بحيث تكون الخسارة عند وقف الخسارة = نسبة المخاطرة من الرصيد.
// يُرجع 0 إذا كان أقل حجم مسموح يتجاوز المخاطرة المحددة، فلا نفتح صفقة أخطر مما طُلب.
function lotSize({ balance, riskPercent, slDistance, contractSize, rate, minVolume, maxVolume, volumeStep }) {
  const riskMoney = balance * (riskPercent / 100);
  const lossPerLot = slDistance * contractSize * rate;
  if (!(lossPerLot > 0)) return 0;
  const raw = riskMoney / lossPerLot;
  const stepped = Math.floor(raw / volumeStep + 1e-9) * volumeStep;
  const volume = roundTo(Math.min(stepped, maxVolume), stepDecimals(volumeStep));
  return volume >= minVolume ? volume : 0;
}

// نحافظ على مسافات الإشارة لكن نقيسها من سعر التنفيذ الفعلي (ask للشراء و bid للبيع)
function orderLevels(signal, price, digits) {
  const dir = signal.side === 'BUY' ? 1 : -1;
  const sl = Math.abs(signal.entry - signal.stopLoss);
  const tp1 = Math.abs(signal.takeProfit1 - signal.entry);
  const tp2 = Math.abs(signal.takeProfit2 - signal.entry);
  return {
    slDistance: sl,
    stopLoss: roundTo(price - dir * sl, digits),
    takeProfit1: roundTo(price + dir * tp1, digits),
    takeProfit2: roundTo(price + dir * tp2, digits),
  };
}

// نقسم الحجم على صفقتين (هدف 1 وهدف 2) إن أمكن، وإلا صفقة واحدة على الهدف 1
function splitVolume(volume, minVolume, volumeStep) {
  const d = stepDecimals(volumeStep);
  const half = roundTo(Math.floor(volume / 2 / volumeStep + 1e-9) * volumeStep, d);
  if (half < minVolume) return [volume];
  return [half, roundTo(volume - half, d)];
}

module.exports = { toMtSymbol, parseSymbolMap, quoteToAccountRate, lotSize, orderLevels, splitVolume };
