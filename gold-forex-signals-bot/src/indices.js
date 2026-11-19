// المؤشرات الأمريكية: RSI(2) يومي، شراء فقط، صفقة واحدة مفتوحة لكل مؤشر (كما في الاختبار).
// البيانات اليومية من Yahoo. الافتراضي: NASDAQ 100 و S&P 500 و Dow Jones (نجح في 3 فترات 1992–2026، للمراقبة؛ يتحرك مع S&P 500). لإيقافها: INDEX_SYMBOLS= (فارغ) في .env
// تحديث 2026-11-19: صندوقا القطاعات XLY (نجح بقوة 1999–2026، PF 1.61 بالدخول عند افتتاح الغد) و XLK (نجح لكن ضعيف، للمعلومة)
const DEFAULT_INDICES = 'NASDAQ 100,S&P 500,DOW JONES,XLY,XLK';
const XM_NAMES = { 'NASDAQ 100': 'US100Cash', 'S&P 500': 'US500Cash', 'DOW JONES': 'US30Cash', XLY: 'XLY', XLK: 'XLK' };
// صناديق ETF في XM: تُتداول فقط وقت السوق الأمريكي، فالدخول والخروج عند افتتاح اليوم التالي
const ETFS = new Set(['XLY', 'XLK']);

function indexMarkets(text = DEFAULT_INDICES) {
  return text
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => XM_NAMES[s])
    .map((symbol) => ({ symbol, interval: '1day', strategies: ['rsi2'], longOnly: true, onePosition: true }));
}

const isIndex = (symbol) => Boolean(XM_NAMES[symbol]);

module.exports = { indexMarkets, isIndex, XM_NAMES, DEFAULT_INDICES, ETFS };
