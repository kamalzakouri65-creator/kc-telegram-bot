// EUR/USD ساعة من Twelve Data (GET، UTC، بيانات سوق فقط، يكمل من حيث توقف). المفتاح يُقرأ من .env البوت (قراءة فقط).
// الفوركس مغلق من الجمعة 17:00 حتى الأحد 17:00 بتوقيت نيويورك (مع التوقيت الصيفي): الشموع في هذا الوقت تُحذف.
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

const HOUR = 3600000;
function nthSunday(y, m, n) {
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
}
function usDst(ms) {
  const d = new Date(ms);
  const [y, m, day] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
  if (m < 2 || m > 10) return false;
  if (m > 2 && m < 10) return true;
  return m === 2 ? day >= nthSunday(y, 2, 2) : day < nthSunday(y, 10, 1);
}
function fxClosed(ms) {
  const ny = new Date(ms - (usDst(ms) ? 4 : 5) * HOUR);
  const day = ny.getUTCDay();
  const h = ny.getUTCHours();
  return day === 6 || (day === 5 && h >= 17) || (day === 0 && h < 17);
}
const toMs = (t) => Date.parse(t.replace(' ', 'T') + 'Z');
const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

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
const file = (n) => path.join(config.paths.data, `${n}.json`);
const load = (n) => {
  try {
    return JSON.parse(fs.readFileSync(file(n), 'utf8'));
  } catch {
    return null;
  }
};
const save = (n, v) => (fs.mkdirSync(config.paths.data, { recursive: true }), fs.writeFileSync(file(n), JSON.stringify(v)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchH1({ onPage } = {}) {
  const td = config.twelveData;
  const key = apiKey();
  const byTime = new Map((load('eurusd-h1') ?? []).map((c) => [c.time, c]));
  let endDate = byTime.size ? fmt(toMs([...byTime.keys()].sort()[0]) - 60000) : fmt(Date.now());
  let reason = 'بلغنا بداية الفترة';
  for (let page = 0; page < td.maxPages && endDate.slice(0, 10) >= td.from; page++) {
    const url = new URL(td.baseUrl);
    url.search = new URLSearchParams({ symbol: config.symbol, interval: '1h', timezone: 'UTC', outputsize: td.outputsize, apikey: key, order: 'DESC', end_date: endDate });
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
    save('eurusd-h1', [...byTime.values()].sort((a, b) => (a.time < b.time ? -1 : 1)));
    onPage?.(byTime.size, rows.at(-1).time);
    if (rows.length < td.outputsize) {
      reason = 'المصدر لا يعطي بيانات أقدم';
      break;
    }
    endDate = fmt(toMs(rows.at(-1).time) - 60000);
    await sleep(td.pauseMs);
  }
  return { candles: load('eurusd-h1') ?? [], reason };
}

// حذف الساعات المغلقة كلها، والشموع المكررة
function clean(rows) {
  const seen = new Set();
  return rows
    .map((c) => ({ ...c, ms: toMs(c.time) }))
    .filter((c) => !(fxClosed(c.ms) && fxClosed(c.ms + 59 * 60000)) && !seen.has(c.time) && seen.add(c.time))
    .sort((a, b) => a.ms - b.ms);
}

module.exports = { fetchH1, clean, load, save, fxClosed, toMs, fmt };
