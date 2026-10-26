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
    ...(s.zone ? [`🧱 Order Block: ${s.zone.bottom.toFixed(d)} - ${s.zone.top.toFixed(d)}`] : []),
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

const sideLabel = (side) => (side === 'BUY' ? 'شراء' : 'بيع');
const fmtR = (r) => `${r > 0 ? '+' : ''}${r.toFixed(2)}R`;

// رسالة عند وصول إشارة سابقة للهدف 1 أو 2 أو الوقف
function formatTradeEvent({ type, trade }) {
  const d = decimals(trade.symbol);
  const head = `${trade.symbol} — ${sideLabel(trade.side)} ${trade.entry.toFixed(d)} (${trade.time})`;
  if (type === 'tp1') {
    return `🎯 ${head}\nتحقق الهدف 1: ${trade.halves[0].target.toFixed(d)}\nنصف الصفقة أُغلق على ${fmtR(trade.halves[0].r)}، والنصف الآخر مستمر نحو الهدف 2.`;
  }
  if (type === 'tp2') {
    return `🏆 ${head}\nتحقق الهدف 2: ${trade.halves[1].target.toFixed(d)}\nالصفقة أُغلقت بالكامل: ${fmtR(trade.r)} ✅`;
  }
  const afterTp1 = trade.halves[0].r > 0;
  return `${afterTp1 ? '🛑' : '❌'} ${head}\nضرب وقف الخسارة: ${trade.stopLoss.toFixed(d)}${
    afterTp1 ? ' بعد تحقق الهدف 1' : ''
  }\nالنتيجة: ${fmtR(trade.r)}`;
}

function formatResults(s) {
  const lines = ['📒 نتائج الإشارات', ''];
  if (s.closed === 0) lines.push('لا توجد إشارات مغلقة بعد.');
  else {
    lines.push(
      `المغلقة: ${s.closed} | رابحة: ${s.wins} | خاسرة: ${s.losses} | نسبة الربح: ${((s.wins / s.closed) * 100).toFixed(0)}%`,
      `المجموع: ${fmtR(s.totalR)}`,
      '',
      'آخر الإشارات:',
      ...s.recent.map((t) => `${t.r > 0 ? '✅' : '❌'} ${t.symbol} ${sideLabel(t.side)} ${t.time} → ${fmtR(t.r)}`)
    );
  }
  if (s.open.length) {
    lines.push('', `⏳ مفتوحة (${s.open.length}):`);
    for (const t of s.open) {
      const tp1 = t.halves[0].r !== null ? ' — الهدف 1 تحقق' : '';
      lines.push(`• ${t.symbol} ${sideLabel(t.side)} ${t.entry.toFixed(decimals(t.symbol))} (${t.time})${tp1}`);
    }
  }
  lines.push('', 'R = المبلغ الذي تخاطر به في الصفقة. النتائج بدون السبريد.');
  return lines.join('\n');
}

module.exports = { formatSignal, formatSnapshot, formatTradeEvent, formatResults };
