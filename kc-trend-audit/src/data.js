// البيانات: (1) ذهب H1 من Twelve Data لـ Out-of-Sample (GET، UTC، بيانات سوق فقط، يحفظ بعد كل دفعة)،
// (2) H1 من بيانات M1 الموجودة. شموع الإغلاق (العطلة المجمّدة والاستراحة) تُحذف، و H4 تُبنى من H1 بدءاً من 00:00 UTC.
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { marketClosed, toMs, fmt, HOUR } = require('./hours');

function apiKey() {
  if (process.env.TWELVE_DATA_API_KEY) return process.env.TWELVE_DATA_API_KEY;
  try {
    const m = fs.readFileSync(path.join(config.paths.root, '..', 'gold-forex-signals-bot', '.env'), 'utf8').match(/^TWELVE_DATA_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  } catch {
    // لا يوجد ملف
  }
  throw new Error('لا يوجد مفتاح Twelve Data (TWELVE_DATA_API_KEY)');
}

const file = (name) => path.join(config.paths.data, `${name}.json`);
const load = (name) => {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return null;
  }
};
const save = (name, v) => {
  fs.mkdirSync(config.paths.data, { recursive: true });
  fs.writeFileSync(file(name), JSON.stringify(v));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOosH1({ pauseMs = config.twelveData.pauseMs, onPage } = {}) {
  const key = apiKey();
  const byTime = new Map((load('xau-h1-oos') ?? []).map((c) => [c.time, c]));
  const { warmupFrom, to } = config.oos;
  let endDate = byTime.size ? fmt(toMs([...byTime.keys()].sort()[0]) - 60000) : `${to} 23:59:00`;
  let reason = 'بلغنا بداية الفترة';
  for (let page = 0; page < 40 && endDate.slice(0, 10) >= warmupFrom; page++) {
    const url = new URL(config.twelveData.baseUrl);
    url.search = new URLSearchParams({ symbol: 'XAU/USD', interval: '1h', timezone: 'UTC', outputsize: config.twelveData.outputsize, apikey: key, order: 'DESC', end_date: endDate });
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
    const data = await res.json();
    if (data.status === 'error') throw new Error(`Twelve Data: ${data.message}`);
    const rows = (data.values ?? []).map((v) => ({ time: v.datetime, open: +v.open, high: +v.high, low: +v.low, close: +v.close }));
    if (!rows.length) {
      reason = 'المصدر لا يعطي بيانات أقدم';
      break;
    }
    for (const r of rows) byTime.set(r.time, r);
    save('xau-h1-oos', [...byTime.values()].sort((a, b) => (a.time < b.time ? -1 : 1)));
    onPage?.(byTime.size, rows.at(-1).time);
    if (rows.length < config.twelveData.outputsize) {
      reason = 'المصدر لا يعطي بيانات أقدم';
      break;
    }
    endDate = fmt(toMs(rows.at(-1).time) - 60000);
    await sleep(pauseMs);
  }
  return { candles: load('xau-h1-oos') ?? [], reason };
}

// شمعة H1 تُحذف إذا كانت الساعة كلها في وقت الإغلاق
const openHour = (ms) => !(marketClosed(ms) && marketClosed(ms + 59 * 60000));

function cleanH1(rows) {
  return rows.map((c) => ({ ...c, ms: toMs(c.time) })).filter((c) => openHour(c.ms)).sort((a, b) => a.ms - b.ms);
}

function group(bars, hours) {
  const size = hours * HOUR;
  const out = [];
  for (const c of bars) {
    const b = Math.floor(c.ms / size) * size;
    const last = out.at(-1);
    if (last && last.ms === b) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
    } else out.push({ ms: b, time: fmt(b), open: c.open, high: c.high, low: c.low, close: c.close });
  }
  return out;
}

// H1 من M1 (بعد حذف دقائق الإغلاق)
function h1FromM1(m1) {
  const kept = m1.map((c) => ({ ...c, ms: toMs(c.time) })).filter((c) => !marketClosed(c.ms)).sort((a, b) => a.ms - b.ms);
  return group(kept, 1);
}

module.exports = { fetchOosH1, cleanH1, group, h1FromM1, load, save };
