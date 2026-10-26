// جلب الشموع من Twelve Data (يدعم XAU/USD وأزواج الفوركس، والخطة المجانية تكفي)
const BASE_URL = 'https://api.twelvedata.com/time_series';

async function fetchCandles(symbol, interval, apiKey, outputsize = 300) {
  const url = new URL(BASE_URL);
  url.search = new URLSearchParams({ symbol, interval, outputsize, apikey: apiKey, order: 'ASC' });

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} عند جلب ${symbol}`);
  const data = await res.json();
  if (data.status === 'error') throw new Error(`${symbol}: ${data.message}`);

  // الشمعة الأخيرة ما زالت مفتوحة، فنحذفها حتى لا تتغير الإشارة بعد إرسالها
  return data.values.slice(0, -1).map((v) => ({
    time: v.datetime,
    open: Number(v.open),
    high: Number(v.high),
    low: Number(v.low),
    close: Number(v.close),
  }));
}

module.exports = { fetchCandles };
