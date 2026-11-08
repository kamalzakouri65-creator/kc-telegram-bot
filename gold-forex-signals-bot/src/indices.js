// المؤشرات الأمريكية: RSI(2) يومي، شراء فقط، صفقة واحدة مفتوحة لكل مؤشر (كما في الاختبار).
// البيانات اليومية من Yahoo. الافتراضي: NASDAQ 100 و S&P 500. لإيقافها: INDEX_SYMBOLS= (فارغ) في .env
const DEFAULT_INDICES = 'NASDAQ 100,S&P 500';
const XM_NAMES = { 'NASDAQ 100': 'US100Cash', 'S&P 500': 'US500Cash' };

function indexMarkets(text = DEFAULT_INDICES) {
  return text
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => XM_NAMES[s])
    .map((symbol) => ({ symbol, interval: '1day', strategies: ['rsi2'], longOnly: true, onePosition: true }));
}

const isIndex = (symbol) => Boolean(XM_NAMES[symbol]);

module.exports = { indexMarkets, isIndex, XM_NAMES, DEFAULT_INDICES };
