// جلب الشموع من Yahoo Finance للأسواق غير المتاحة في خطة Twelve Data المجانية (مثل الفضة).
// واجهة غير رسمية ومجانية، قد تتغير دون إنذار. الأوقات بتوقيت UTC.
const BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';

// الرمز عندنا -> الرمز عند Yahoo (SI=F = عقود الفضة الآجلة، تتداول تقريباً 24 ساعة)
const YAHOO_SYMBOLS = { 'XAG/USD': 'SI=F' };

// الإطارات المدعومة: Yahoo لا يقدم 4 ساعات، فنبنيها من شموع الساعة
const INTERVALS = {
  '1h': { yahoo: '60m', hours: 1, group: 1, maxDays: 729 },
  '4h': { yahoo: '60m', hours: 4, group: 4, maxDays: 729 },
  '1day': { yahoo: '1d', hours: 24, group: 1, maxDays: 365 * 20 },
};

const pad = (n) => String(n).padStart(2, '0');
// نفس صيغة Twelve Data: "2026-10-30 14:00:00"
function formatTime(seconds) {
  const d = new Date(seconds * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes()
  )}:00`;
}

// شموع الساعة -> شموع 4 ساعات تبدأ عند 00 و 04 و 08 ... بتوقيت UTC
function groupCandles(candles, group) {
  if (group === 1) return candles;
  const out = [];
  for (const c of candles) {
    const bucket = Math.floor(c.seconds / (group * 3600)) * group * 3600;
    const last = out.at(-1);
    if (last && last.seconds === bucket) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
    } else {
      out.push({ ...c, seconds: bucket });
    }
  }
  return out;
}

// يحوّل رد Yahoo إلى شموع، ويتجاهل الفترات بلا تداول (قيم null)
function parseChart(data) {
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(data?.chart?.error?.description ?? 'رد غير متوقع من Yahoo');
  const q = result.indicators?.quote?.[0] ?? {};
  const candles = [];
  (result.timestamp ?? []).forEach((seconds, k) => {
    const [open, high, low, close] = [q.open?.[k], q.high?.[k], q.low?.[k], q.close?.[k]];
    if ([open, high, low, close].some((v) => v == null)) return;
    candles.push({ seconds, open, high, low, close });
  });
  return candles;
}

async function fetchYahooCandles(symbol, interval, outputsize = 300) {
  const ticker = YAHOO_SYMBOLS[symbol];
  const spec = INTERVALS[interval];
  if (!spec) throw new Error(`${symbol}: الإطار ${interval} غير مدعوم من Yahoo (المتاح: ${Object.keys(INTERVALS).join(', ')})`);

  // السوق يغلق في نهاية الأسبوع، فنطلب أياماً أكثر من الحاجة
  const days = Math.min(spec.maxDays, Math.ceil(((outputsize + 1) * spec.hours * 1.6) / 24) + 7);
  const now = Math.floor(Date.now() / 1000);
  const url = new URL(BASE_URL + encodeURIComponent(ticker));
  url.search = new URLSearchParams({ interval: spec.yahoo, period1: now - days * 86400, period2: now });

  // Yahoo يرفض أحياناً الطلبات بدون User-Agent متصفح
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} عند جلب ${symbol} من Yahoo`);
  const candles = groupCandles(parseChart(await res.json()), spec.group);

  // الشمعة الأخيرة ما زالت مفتوحة، فنحذفها حتى لا تتغير الإشارة بعد إرسالها
  return candles
    .slice(0, -1)
    .slice(-outputsize)
    .map(({ seconds, open, high, low, close }) => ({ time: formatTime(seconds), open, high, low, close }));
}

// تاريخ كامل لرمز Yahoo مباشرة (للاختبارات)، بدون حذف آخر شمعة. شموع الساعة متاحة لآخر 729 يوماً فقط
async function fetchYahooHistory(ticker, yahooInterval, days) {
  const now = Math.floor(Date.now() / 1000);
  const url = new URL(BASE_URL + encodeURIComponent(ticker));
  url.search = new URLSearchParams({ interval: yahooInterval, period1: now - days * 86400, period2: now });
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} عند جلب ${ticker} من Yahoo`);
  const candles = parseChart(await res.json());
  if (candles.length < 500) throw new Error(`${ticker}: بيانات قليلة (${candles.length} شمعة)`);
  return candles;
}

module.exports = { fetchYahooCandles, fetchYahooHistory, YAHOO_SYMBOLS, parseChart, groupCandles, formatTime };
