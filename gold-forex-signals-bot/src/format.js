const { labelOf } = require('./strategies');
const { suggestLot, timeframeLabel, mt5Code } = require('./sizing');

// عدد الأرقام العشرية حسب الرمز: الذهب والين برقمين، وبقية الفوركس بخمسة
function decimals(symbol) {
  if (symbol.endsWith('/USDT')) return 2;
  if (symbol.startsWith('XAU') || symbol.endsWith('JPY')) return 2;
  if (symbol.startsWith('XAG')) return 3;
  return 5;
}

// سطر الحجم المقترح لحساب صغير (أقصى خسارة maxLossUsd عند الوقف)
function sizingLine(symbol, s, maxLossUsd) {
  const size = suggestLot(symbol, s.entry, s.stopLoss, maxLossUsd);
  if (!size) return [];
  const d = decimals(symbol);
  if (!size.ok)
    return [`❌ الوقف بعيد (${size.distance.toFixed(d)}): أصغر حجم 0.1 يخسر ~${size.minLoss.toFixed(2)}$ (أكثر من ${maxLossUsd}$) — تخطَّها`];
  return [`✅ مناسبة لحسابك: الحجم ${size.lot.toFixed(1)} لوت ← خسارة ~${size.loss.toFixed(2)}$ عند الوقف`];
}

function formatSignal(symbol, interval, s, strategy, { maxLossUsd } = {}) {
  const d = decimals(symbol);
  const icon = s.side === 'BUY' ? '🟢 شراء BUY' : '🔴 بيع SELL';
  return [
    `📊 ${symbol} — ${interval}${strategy ? ` — ${labelOf(strategy)}` : ''}`,
    icon,
    '',
    `💰 الدخول: ${s.entry.toFixed(d)}`,
    `🛑 وقف الخسارة: ${s.stopLoss.toFixed(d)}`,
    `🎯 الهدف 1: ${s.takeProfit1.toFixed(d)}`,
    `🎯 الهدف 2: ${s.takeProfit2.toFixed(d)}`,
    '',
    `⏱️ الإطار: ${timeframeLabel(interval)} — افتح الشارت على ${mt5Code(interval)}`,
    ...sizingLine(symbol, s, maxLossUsd),
    ...(symbol.endsWith('/USDT') ? ['🪙 Binance Spot — شراء فقط، بدون رافعة. إشارة متابعة: لا تدخل بمال حقيقي بعد'] : []),
    ...(s.zone ? [`🧱 ${s.zoneLabel ?? 'Order Block'}: ${s.zone.bottom.toFixed(d)} - ${s.zone.top.toFixed(d)}`] : []),
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
  const head = `${trade.symbol} ${trade.interval} ${labelOf(trade.strategy)} — ${sideLabel(trade.side)} ${trade.entry.toFixed(d)} (${trade.time})`;
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

// تنبيه عندما تأتي إشارة بنفس اتجاه صفقة مفتوحة، حتى لا تتضاعف المخاطرة
function formatOverlapNote(trade) {
  return `⚠️ توجد إشارة مفتوحة بنفس الاتجاه (${trade.interval} ${labelOf(trade.strategy)} من ${trade.entry.toFixed(
    decimals(trade.symbol)
  )}). إن كنت داخلها، لا تفتح صفقة ثانية حتى لا تتضاعف المخاطرة.`;
}

function formatResults(s) {
  const lines = ['📒 نتائج الإشارات', ''];
  if (s.closed === 0) lines.push('لا توجد إشارات مغلقة بعد.');
  else {
    lines.push(
      `المغلقة: ${s.closed} | رابحة: ${s.wins} | خاسرة: ${s.losses} | نسبة الربح: ${((s.wins / s.closed) * 100).toFixed(0)}%`,
      `المجموع: ${fmtR(s.totalR)}`,
      ...(Object.keys(s.byStrategy).length > 1
        ? [
            '',
            'حسب الاستراتيجية:',
            ...Object.entries(s.byStrategy).map(
              ([key, t]) => `• ${labelOf(key)}: ${t.closed} مغلقة | رابحة ${t.wins} | ${fmtR(t.totalR)}`
            ),
          ]
        : []),
      ...(s.bySide
        ? [
            '',
            'حسب الاتجاه:',
            ...Object.entries(s.bySide).map(([side, t]) =>
              t.closed ? `• ${sideLabel(side)}: ${t.closed} مغلقة | رابحة ${t.wins} | ${fmtR(t.totalR)}` : `• ${sideLabel(side)}: 0 مغلقة`
            ),
          ]
        : []),
      '',
      'آخر الإشارات:',
      ...s.recent.map((t) => `${t.r > 0 ? '✅' : '❌'} ${t.symbol} ${t.interval} ${labelOf(t.strategy)} ${sideLabel(t.side)} ${t.time} → ${fmtR(t.r)}`)
    );
  }
  if (s.open.length) {
    lines.push('', `⏳ مفتوحة (${s.open.length}):`);
    for (const t of s.open) {
      const tp1 = t.halves[0].r !== null ? ' — الهدف 1 تحقق' : '';
      lines.push(`• ${t.symbol} ${t.interval} ${labelOf(t.strategy)} ${sideLabel(t.side)} ${t.entry.toFixed(decimals(t.symbol))} (${t.time})${tp1}`);
    }
  }
  lines.push('', 'R = المبلغ الذي تخاطر به في الصفقة. النتائج بدون السبريد.');
  return lines.join('\n');
}

module.exports = { formatSignal, formatSnapshot, formatTradeEvent, formatResults, formatOverlapNote };
