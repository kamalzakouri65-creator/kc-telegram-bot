const { labelOf } = require('./strategies');
const { suggestLot, timeframeLabel, mt5Code } = require('./sizing');
const { XM_NAMES } = require('./indices');
const { netR, netTotal } = require('./costs');

// عدد الأرقام العشرية حسب الرمز: الذهب والين برقمين، وبقية الفوركس بخمسة
function decimals(symbol) {
  if (symbol.endsWith('/USDT') || !symbol.includes('/')) return 2;
  if (symbol.startsWith('XAU') || symbol.endsWith('JPY')) return 2;
  if (symbol.startsWith('XAG')) return 3;
  return 5;
}

// سطر الحجم المقترح لحساب صغير (أقصى خسارة maxLossUsd عند الوقف)
function sizingLine(symbol, s, maxLossUsd) {
  const size = suggestLot(symbol, s.entry, s.stopLoss, maxLossUsd);
  if (!size) return [];
  const d = decimals(symbol);
  if (size.tooClose)
    return [`❌ الوقف قريب جداً (${size.distance.toFixed(d)}، الحد الأدنى ${size.minStop}): السبريد يأكل جزءاً كبيراً من الصفقة — تخطَّها`];
  if (!size.ok)
    return [`❌ الوقف بعيد (${size.distance.toFixed(d)}): أصغر حجم 0.1 يخسر ~${size.minLoss.toFixed(2)}$ (أكثر من ${maxLossUsd}$) — تخطَّها`];
  return [`✅ مناسبة لحسابك: الحجم ${size.lot.toFixed(1)} لوت ← خسارة ~${size.loss.toFixed(2)}$ عند الوقف`];
}

// المؤشرات في حساب XM MT5 Micro: أصغر لوت 0.1، وحجم العقد 1 (0.10$ لكل نقطة). القواعد المتفق عليها (2026-11-16):
// التداول على US500Cash فقط بـ 0.1 لوت ثابت؛ بقية المؤشرات للمعلومة فقط.
const INDEX_LOT = 0.1;
const TRADED_INDEX = 'S&P 500';
// تحديث 2026-11-17: رصيد 1,000$؛ نتخطى الإشارة إذا كانت الخسارة عند الوقف أكثر من 40$ (4%)
const MAX_INDEX_LOSS_USD = 40;
function indexLines(symbol, s) {
  const name = XM_NAMES[symbol];
  if (!name) return [];
  const loss = INDEX_LOT * Math.abs(s.entry - s.stopLoss);
  if (symbol !== TRADED_INDEX) return [`ℹ️ XM: ${name} — للمعلومة فقط، لا تتداول (الخسارة بأصغر لوت ${INDEX_LOT}: ~${loss.toFixed(0)}$)`];
  if (loss > MAX_INDEX_LOSS_USD)
    return [`⛔ تخطَّ هذه الإشارة: الخسارة عند الوقف ~${loss.toFixed(2)}$ أكبر من ${MAX_INDEX_LOSS_USD}$ (قاعدة الحساب). البوت يتابعها للمعلومة فقط`];
  return [
    `✅ XM: ${name} — شراء ${INDEX_LOT} لوت (حجم ثابت، لا أكثر)`,
    `🛑 الخسارة عند الوقف: ~${loss.toFixed(2)}$ — ضع الوقف بالضبط ولا تحرّكه`,
    '⏰ ادخل في أقرب وقت بعد الإشارة. إن لم تستطع اليوم، تخطَّها. لا تفتح صفقة ثانية إن كانت واحدة مفتوحة',
  ];
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
    ...(s.exitRule
      ? [`🚪 الخروج: عند أول إغلاق يومي فوق متوسط ${s.exitRule.sma} أيام، أو بعد ${s.exitRule.maxBars} أيام. البوت يرسل لك رسالة الخروج`]
      : [`🎯 الهدف 1: ${s.takeProfit1.toFixed(d)}`, `🎯 الهدف 2: ${s.takeProfit2.toFixed(d)}`]),
    '',
    `⏱️ الإطار: ${timeframeLabel(interval)} — افتح الشارت على ${mt5Code(interval)}`,
    ...sizingLine(symbol, s, maxLossUsd),
    ...(symbol.endsWith('/USDT') ? ['🪙 Binance Spot — شراء فقط، بدون رافعة. إشارة متابعة: لا تدخل بمال حقيقي بعد'] : []),
    ...indexLines(symbol, s),
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
  if (type === 'exit') {
    const why = trade.exitReason === 'time' ? `مرت ${trade.exitRule.maxBars} أيام` : `أُغلق السعر فوق متوسط ${trade.exitRule.sma} أيام`;
    return `🔔 ${head}\nاخرج الآن: ${why}. الخروج عند ${trade.exit.toFixed(d)}\nالنتيجة: ${fmtR(trade.r)} ${trade.r > 0 ? '✅' : '❌'}`;
  }
  if (trade.exitRule) return `❌ ${head}\nضرب وقف الخسارة، الخروج عند ${trade.exit.toFixed(d)}\nالنتيجة: ${fmtR(trade.r)}`;
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
      `المجموع: ${fmtR(s.totalR)} قبل التكاليف${s.closedTrades ? ` | ${netLabel(s.closedTrades)} بعد التكاليف (تقديري)` : ''}`,
      ...(s.closedTrades ? ['', 'حسب السوق (بعد التكاليف):', ...MARKETS.map((name) => marketLine(name, s.closedTrades.filter((t) => marketName(t.symbol) === name)))] : []),
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
      ...s.recent.map((t) => {
        const n = netR(t);
        return `${t.r > 0 ? '✅' : '❌'} ${t.symbol} ${t.interval} ${labelOf(t.strategy)} ${sideLabel(t.side)} ${t.time} → ${fmtR(t.r)}${n == null ? '' : ` (بعد التكاليف ${fmtR(n)})`}`;
      })
    );
  }
  if (s.open.length) {
    lines.push('', `⏳ مفتوحة (${s.open.length}):`);
    for (const t of s.open) {
      const tp1 = t.halves?.[0]?.r != null ? ' — الهدف 1 تحقق' : '';
      lines.push(`• ${t.symbol} ${t.interval} ${labelOf(t.strategy)} ${sideLabel(t.side)} ${t.entry.toFixed(decimals(t.symbol))} (${t.time})${tp1}`);
    }
  }
  lines.push('', COSTS_NOTE);
  return lines.join('\n');
}

const COSTS_NOTE = 'R = المبلغ الذي تخاطر به في الصفقة. "بعد التكاليف" تقديري: سبريد وانزلاق و Swap (والرسوم في الكريبتو)، بنفس أرقام الاختبارات.';
// مجموع بعد التكاليف، مع التنبيه إذا لم تُعرف تكلفة بعض الصفقات
function netLabel(list) {
  const { total, unknown } = netTotal(list);
  return `${fmtR(total)}${unknown ? ` (${unknown} بدون تكلفة معروفة)` : ''}`;
}
const MARKETS = ['الذهب', 'الفضة', 'العملات الرقمية', 'المؤشرات'];
function marketLine(name, list) {
  if (!list.length) return `• ${name}: 0 مغلقة`;
  return `• ${name}: ${list.length} مغلقة | رابحة ${list.filter((t) => t.r > 0).length} | ${netLabel(list)}`;
}

const marketName = (symbol) =>
  symbol.startsWith('XAU') ? 'الذهب' : symbol.startsWith('XAG') ? 'الفضة' : symbol.endsWith('/USDT') ? 'العملات الرقمية' : XM_NAMES[symbol] ? 'المؤشرات' : symbol;

// ملخص الأسبوع: الصفقات التي أُغلقت منذ since
function formatWeekly(closed, open, since, all) {
  const tally = (list) => ({ n: list.length, wins: list.filter((t) => t.r > 0).length, losses: list.filter((t) => t.r < 0).length, r: list.reduce((s, t) => s + t.r, 0) });
  const w = tally(closed);
  const lines = [`📅 ملخص الأسبوع (منذ ${since.slice(0, 10)})`, ''];
  if (!w.n) lines.push('لا صفقات مغلقة هذا الأسبوع.');
  else {
    lines.push(`المغلقة: ${w.n} | رابحة: ${w.wins} | خاسرة: ${w.losses} | المجموع: ${fmtR(w.r)} (بعد التكاليف ${netLabel(closed)})`, '');
    const groups = {};
    for (const t of closed) (groups[marketName(t.symbol)] ??= []).push(t);
    for (const [name, list] of Object.entries(groups)) {
      const g = tally(list);
      lines.push(`• ${name}: ${g.n} | رابحة ${g.wins} | ${fmtR(g.r)} (بعد التكاليف ${netLabel(list)})`);
    }
  }
  lines.push('', `⏳ مفتوحة الآن: ${open.length}`);
  if (all) lines.push(`📒 منذ البداية: ${all.closed} مغلقة | ${fmtR(all.totalR)}${all.closedTrades ? ` (بعد التكاليف ${netLabel(all.closedTrades)})` : ''}`);
  lines.push('', COSTS_NOTE);
  return lines.join('\n');
}

// رسالة الصباح: البوت يعمل، ومتى كان آخر فحص
function formatHeartbeat(lastScanAt, openCount, now = new Date()) {
  if (!lastScanAt) return `⚠️ البوت يعمل لكن لم يكتمل أي فحص بعد | مفتوحة: ${openCount}`;
  const minutes = Math.round((now - lastScanAt) / 60000);
  const head = minutes <= 30 ? '✅ البوت يعمل' : `⚠️ البوت يعمل لكن آخر فحص كان قبل ${minutes} دقيقة (مشكلة إنترنت؟)`;
  return `${head} — آخر فحص: ${lastScanAt.toISOString().slice(11, 16)} UTC | مفتوحة: ${openCount}`;
}

module.exports = { formatSignal, formatSnapshot, formatTradeEvent, formatResults, formatOverlapNote, formatWeekly, formatHeartbeat };
