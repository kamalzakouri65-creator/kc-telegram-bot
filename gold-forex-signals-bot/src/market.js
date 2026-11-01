// جلب الشموع من Twelve Data (يدعم XAU/USD وأزواج الفوركس، والخطة المجانية تكفي)
const BASE_URL = 'https://api.twelvedata.com/time_series';

// options.timezone: مثلاً 'UTC' (الافتراضي توقيت السوق عند Twelve Data)
// options.endDate: لجلب شموع أقدم من هذا التاريخ، وعندها لا نحذف آخر شمعة لأنها مغلقة
async function fetchCandles(symbol, interval, apiKey, outputsize = 300, options = {}) {
  const params = { symbol, interval, outputsize, apikey: apiKey, order: 'ASC' };
  if (options.timezone) params.timezone = options.timezone;
  if (options.endDate) params.end_date = options.endDate;
  const url = new URL(BASE_URL);
  url.search = new URLSearchParams(params);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} عند جلب ${symbol}`);
  const data = await res.json();
  if (data.status === 'error') throw new Error(`${symbol}: ${data.message}`);

  // الشمعة الأخيرة ما زالت مفتوحة، فنحذفها حتى لا تتغير الإشارة بعد إرسالها
  const values = options.endDate ? data.values : data.values.slice(0, -1);
  return values.map((v) => ({
    time: v.datetime,
    open: Number(v.open),
    high: Number(v.high),
    low: Number(v.low),
    close: Number(v.close),
  }));
}

module.exports = { fetchCandles };
