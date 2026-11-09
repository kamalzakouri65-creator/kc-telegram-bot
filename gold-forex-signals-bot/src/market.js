// جلب الشموع من Twelve Data (يدعم XAU/USD وأزواج الفوركس، والخطة المجانية تكفي)
// والأسواق غير المتاحة فيها مجاناً (مثل الفضة) تُجلب من Yahoo Finance
const { fetchYahooCandles, YAHOO_SYMBOLS } = require('./yahoo');
const { fetchBinanceCandles, isCrypto } = require('./binance');
const { dropWeekendCandles } = require('./market-hours');

const BASE_URL = 'https://api.twelvedata.com/time_series';

// options.timezone: مثلاً 'UTC' (الافتراضي توقيت السوق عند Twelve Data)
// options.endDate: لجلب شموع أقدم من هذا التاريخ، وعندها لا نحذف آخر شمعة لأنها مغلقة
async function fetchCandles(symbol, interval, apiKey, outputsize = 300, options = {}) {
  // العملات الرقمية (مثل BTC/USDT) من بيانات Binance العامة
  if (isCrypto(symbol)) return fetchBinanceCandles(symbol, interval, outputsize);
  if (YAHOO_SYMBOLS[symbol]) {
    if (options.endDate) throw new Error(`${symbol}: جلب البيانات القديمة غير مدعوم من Yahoo`);
    return fetchYahooCandles(symbol, interval, outputsize);
  }
  // UTC دائماً: بدونه يرسل Twelve Data أوقاتاً بتوقيت آخر (كانت متقدمة ~11 ساعة)، فتختلف عن باقي المصادر
  const params = { symbol, interval, outputsize, apikey: apiKey, order: 'ASC', timezone: options.timezone ?? 'UTC' };
  if (options.endDate) params.end_date = options.endDate;
  const url = new URL(BASE_URL);
  url.search = new URLSearchParams(params);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} عند جلب ${symbol}`);
  const data = await res.json();
  if (data.status === 'error') throw new Error(`${symbol}: ${data.message}`);

  // الشمعة الأخيرة ما زالت مفتوحة، فنحذفها حتى لا تتغير الإشارة بعد إرسالها
  const values = options.endDate ? data.values : data.values.slice(0, -1);
  const candles = values.map((v) => ({
    time: v.datetime,
    open: Number(v.open),
    high: Number(v.high),
    low: Number(v.low),
    close: Number(v.close),
  }));
  // شموع العطلة المجمّدة تُحذف إذا كانت الأوقات بتوقيت UTC
  return (options.timezone ?? 'UTC') === 'UTC' ? dropWeekendCandles(candles, interval) : candles;
}

module.exports = { fetchCandles };
