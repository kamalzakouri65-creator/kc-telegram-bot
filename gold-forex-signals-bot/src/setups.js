// إيقاف استراتيجية على زوج وإطار محددين، مثل DISABLED_SETUPS=XAG/USD:1h:pullback
// الافتراضي (بدون أي تعديل في .env): إيقاف الفضة 1h Pullback، لأنها خسرت −12.3R في اختبار سنتين (2024-11 → 2026-11).
// لإعادة تشغيل كل شيء: DISABLED_SETUPS= (فارغ) في ملف .env
const { STRATEGIES, labelOf } = require('./strategies');

const DEFAULT_DISABLED = 'XAG/USD:1h:pullback';

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
