// رسائل تيليغرام. التنسيق منفصل عن الإرسال، والإرسال منفصل عن اكتشاف الإشارات.
const { config } = require('../config');

const ts = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const price = (n) => n.toFixed(2);
const label = (pair) => config.pairs[pair]?.label ?? pair;
const base = (pair) => label(pair).split('/')[0];
const DISCLAIMER = '⚠️ إشارة معلوماتية فقط. لا يوجد أي تنفيذ آلي، والقرار والتأكيد لك.';

function formatSignal(s) {
  return [
    `🟢 إشارة شراء BUY — ${label(s.pair)} (Spot)`,
    '',
    `📥 منطقة الدخول: ${price(s.zoneBottom)} - ${price(s.zoneTop)}`,
    `🛑 وقف الخسارة: ${price(s.stopLoss)}`,
    `🎯 الهدف: ${price(s.takeProfit)}`,
    `⚖️ العائد/المخاطرة: ${s.netRewardRisk.toFixed(2)} : 1 (بعد الرسوم)`,
    '',
    `💵 المخاطرة: ${s.riskPct.toFixed(2)}% = ${s.riskAmount.toFixed(2)}$`,
    `📦 الحجم: ${s.qty} ${base(s.pair)} ≈ ${s.notional.toFixed(2)}$ (رسوم تقديرية ${s.feesEstimate.toFixed(3)}$)`,
    `📊 الثقة: ${s.confidence.label} (${s.confidence.score}/100) | ${s.structure}${s.fvg ? ' + FVG' : ''} | تأكيد M5: ${
      s.pattern === 'engulfing' ? 'ابتلاع صاعد' : 'اختراق'
    } | الحجم ×${s.volumeRatio.toFixed(1)}`,
    '',
    `🕒 وقت الإشارة: ${ts(s.time)}`,
    `⌛ تنتهي إن لم يدخل السعر المنطقة قبل: ${ts(s.expiresAt)}`,
    '',
    DISCLAIMER,
  ].join('\n');
}

function formatRejected(e) {
  return [`⛔ إعداد ${label(e.pair)} مرفوض (لا توجد إشارة)`, ...e.reasons.map((r) => `• ${r}`), `🕒 ${ts(e.time)}`].join('\n');
}

function formatSignalEnded(e) {
  const why = e.type === 'signalExpired' ? 'لم يدخل السعر منطقة الدخول في الوقت المحدد' : e.reason;
  return `⌛ انتهت إشارة ${label(e.pair)} دون دخول: ${why}\n🕒 ${ts(e.time)}`;
}

function formatClosed(e) {
  const t = e.trade;
  const icon = { target: '🏆 الهدف', stop: '❌ الوقف', breakeven: '➖ التعادل' }[t.outcome];
  return `${icon} — ${label(e.pair)} (متابعة افتراضية)\nالدخول ${price(t.entry)} ← الخروج ${price(t.exit)}\nالنتيجة: ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(
    2
  )}$ (${t.r >= 0 ? '+' : ''}${t.r.toFixed(2)}R)`;
}

function formatDailySummary({ day, signals, rejected, closed, pnl, balance }) {
  return [
    `📅 ملخص يوم ${day}`,
    `إشارات: ${signals} | مرفوضة: ${rejected} | صفقات مغلقة: ${closed}`,
    `النتيجة: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}$ | الرصيد الافتراضي: ${balance.toFixed(2)}$`,
  ].join('\n');
}

function formatWeeklyReport({ from, to, metrics: m }) {
  return [
    `📈 تقرير الأسبوع ${from} إلى ${to}`,
    `الصفقات: ${m.totalTrades} | نسبة الربح: ${m.winRate.toFixed(1)}% | معامل الربح: ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞'}`,
    `الصافي: ${m.netProfit >= 0 ? '+' : ''}${m.netProfit.toFixed(2)}$ | متوسط R: ${m.avgR.toFixed(2)} | أطول سلسلة خسائر: ${m.longestLosingStreak}`,
  ].join('\n');
}

const formatError = (err) => `🚨 خطأ في النظام: ${err.message ?? err}`;

// إرسال عبر واجهة بوت تيليغرام (الاتصال الخارجي الوحيد غير بيانات Binance)
function createTelegramSender({ token, chatId, fetchImpl = fetch }) {
  return async (text) => {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
  };
}

// لا تُرسل نفس الرسالة مرتين: كل رسالة لها مفتاح يُحفظ في السجل
function createNotifier({ send, journal }) {
  return async (key, text) => {
    if (journal.wasSent(key)) return false;
    await send(text);
    journal.markSent(key);
    return true;
  };
}

// مفتاح ونص الرسالة لكل حدث من المحرك (الأحداث الداخلية مثل setup لا تُرسل)
function messageFor(e) {
  switch (e.type) {
    case 'signal':
      return { key: `signal|${e.signal.id}`, text: formatSignal(e.signal) };
    case 'rejected':
      return { key: `rejected|${e.setup.id}`, text: formatRejected(e) };
    case 'signalExpired':
    case 'signalCancelled':
      return { key: `ended|${e.signal.id}`, text: formatSignalEnded(e) };
    case 'closed':
      return { key: `closed|${e.trade.id}`, text: formatClosed(e) };
    default:
      return null;
  }
}

module.exports = {
  formatSignal,
  formatRejected,
  formatSignalEnded,
  formatClosed,
  formatDailySummary,
  formatWeeklyReport,
  formatError,
  createTelegramSender,
  createNotifier,
  messageFor,
};
