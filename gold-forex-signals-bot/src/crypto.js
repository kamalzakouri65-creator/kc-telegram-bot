// إشارات العملات الرقمية: EMA + MACD على الإطار اليومي، شراء فقط (Binance Spot).
// اجتازت الاختبار التاريخي بمرحلتين (kc-crypto-daily): التطوير 2023-11 → 2026-11 (+15.5R) والتأكيد 2017–2023 (+20.7R، 4/4 عملات).
// الافتراضي: BTC و ETH و SOL و BNB. لإيقافها: CRYPTO_SYMBOLS= (فارغ) في ملف .env
const { STRATEGIES } = require('./strategies');

const DEFAULT_CRYPTO = 'BTC/USDT,ETH/USDT,SOL/USDT,BNB/USDT';

function cryptoMarkets(text = DEFAULT_CRYPTO) {
  return text
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .map((symbol) => ({ symbol, interval: '1day', strategies: ['ema-macd'], longOnly: true }));
}

// إشارات سوق واحد بعد تطبيق الإيقاف والشراء فقط
function marketSignals(market, candles, isEnabled = () => true) {
  const out = [];
  for (const key of market.strategies) {
    if (!isEnabled(market.symbol, market.interval, key)) continue;
    const signal = STRATEGIES[key].analyze(candles);
    if (!signal) continue;
    if (market.longOnly && signal.side !== 'BUY') continue;
    out.push({ key, signal });
  }
  return out;
}

module.exports = { cryptoMarkets, marketSignals, DEFAULT_CRYPTO };
