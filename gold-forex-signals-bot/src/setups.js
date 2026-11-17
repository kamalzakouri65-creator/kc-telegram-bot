// إيقاف استراتيجية على زوج وإطار محددين، مثل DISABLED_SETUPS=XAG/USD:1h:pullback
// الافتراضي (بدون أي تعديل في .env)، تحديث 2026-11-17 بموافقة صاحب المشروع: إيقاف كل الفضة والذهب 1h.
// السبب: تدقيق 2020–2024 أظهر أن الذهب 1h خاسر بعد التكاليف، والفضة بنفس القواعد غير مثبتة (ولا بيانات مستقلة لها).
// وفي نفس اليوم: إيقاف الذهب 4h أيضاً (رابح لكن ضعيف، PF 1.12–1.18) — قرار: كل ما فشل أو ضعف نتخلى عنه.
// الصفقات المفتوحة تُتابع حتى تُغلق.
// لإعادة تشغيل كل شيء: DISABLED_SETUPS= (فارغ) في ملف .env
const { STRATEGIES, labelOf } = require('./strategies');

const DEFAULT_DISABLED =
  'XAU/USD:1h:ema-macd,XAU/USD:1h:pullback,XAU/USD:4h:ema-macd,XAU/USD:4h:pullback,XAG/USD:1h:ema-macd,XAG/USD:1h:pullback,XAG/USD:4h:ema-macd,XAG/USD:4h:pullback';

function parseDisabled(text) {
  const set = new Set();
  const invalid = [];
  for (const item of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [symbol, interval, strategy] = item.split(':').map((s) => s.trim());
    if (!symbol || !interval || !STRATEGIES[strategy]) invalid.push(item);
    else set.add(`${symbol}|${interval}|${strategy}`);
  }
  return { set, invalid };
}

const isEnabled = (disabled, symbol, interval, strategy) => !disabled.has(`${symbol}|${interval}|${strategy}`);

const describe = (disabled) =>
  [...disabled].map((k) => {
    const [symbol, interval, strategy] = k.split('|');
    return `${symbol} ${interval} ${labelOf(strategy)}`;
  });

module.exports = { parseDisabled, isEnabled, describe, DEFAULT_DISABLED };
