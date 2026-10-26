// عدد الأرقام العشرية حسب الرمز: الذهب والين برقمين، وبقية الفوركس بخمسة
function decimals(symbol) {
  if (symbol.startsWith('XAU') || symbol.endsWith('JPY')) return 2;
  return 5;
}

function formatSignal(symbol, interval, s) {
  const d = decimals(symbol);
  const icon = s.side === 'BUY' ? '🟢 شراء BUY' : '🔴 بيع SELL';
  return [
    `📊 ${symbol} — ${interval}`,
    icon,
    '',
    `💰 الدخول: ${s.entry.toFixed(d)}`,
    `🛑 وقف الخسارة: ${s.stopLoss.toFixed(d)}`,
    `🎯 الهدف 1: ${s.takeProfit1.toFixed(d)}`,
    `🎯 الهدف 2: ${s.takeProfit2.toFixed(d)}`,
    '',
    `RSI: ${s.rsi.toFixed(1)} | ATR: ${s.atr.toFixed(d)}`,
    `🕒 ${s.time}`,
    '',
    '⚠️ إشارة آلية للتحليل فقط وليست نصيحة مالية.',
  ].join('\n');
}

function formatSnapshot(symbol, s) {
  const d = decimals(symbol);
  return `• ${symbol}: ${s.price.toFixed(d)} | الاتجاه ${s.trend} | RSI ${s.rsi.toFixed(1)} | MACD ${
    s.macdAbove ? 'إيجابي' : 'سلبي'
  }`;
}

module.exports = { formatSignal, formatSnapshot };
