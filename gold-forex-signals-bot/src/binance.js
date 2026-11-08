// شموع العملات الرقمية من بيانات Binance العامة (GET بدون أي مفتاح أو حساب). الأوقات بتوقيت UTC.
const BASE_URL = 'https://data-api.binance.vision/api/v3/klines';
const INTERVALS = { '1h': '1h', '4h': '4h', '1day': '1d' };

const isCrypto = (symbol) => /\/USDT$/.test(symbol);
const pad = (n) => String(n).padStart(2, '0');
const formatTime = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
};

async function fetchBinanceCandles(symbol, interval, outputsize = 300, now = Date.now()) {
  const tf = INTERVALS[interval];
  if (!tf) throw new Error(`${symbol}: الإطار ${interval} غير مدعوم (المتاح: ${Object.keys(INTERVALS).join(', ')})`);
  const url = new URL(BASE_URL);
  url.search = new URLSearchParams({ symbol: symbol.replace('/', ''), interval: tf, limit: Math.min(1000, outputsize + 1) });
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`HTTP ${res.status} عند جلب ${symbol} من Binance`);
  const rows = await res.json();
  // الشمعة الأخيرة ما زالت مفتوحة (وقت إغلاقها في المستقبل)، فنحذفها حتى لا تتغير الإشارة بعد إرسالها
  return rows
    .filter((k) => k[6] < now)
    .map((k) => ({ time: formatTime(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]) }));
}

module.exports = { fetchBinanceCandles, isCrypto };
