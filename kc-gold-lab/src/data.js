// ذهب 15 دقيقة من Twelve Data (GET، UTC، بيانات سوق فقط، يكمل من حيث توقف). المفتاح من .env البوت (قراءة فقط).
// الشموع في أوقات إغلاق الذهب (عطلة نهاية الأسبوع والاستراحة اليومية) تُحذف.
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { toMs } = require('./timezone');
const { marketClosed } = require('../../kc-trend-audit/src/hours');

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

async function fetchM15({ onPage } = {}) {
  const td = config.twelveData;
  const key = apiKey();
  const byTime = new Map((load('xau-m15') ?? []).map((c) => [c.time, c]));
  let endDate = byTime.size ? fmt(toMs([...byTime.keys()].sort()[0]) - 60000) : fmt(Date.now());
  let reason = 'بلغنا بداية الفترة';
  for (let page = 0; page < td.maxPages && endDate.slice(0, 10) >= td.from; page++) {
    const url = new URL(td.baseUrl);
    url.search = new URLSearchParams({ symbol: 'XAU/USD', interval: '15min', timezone: 'UTC', outputsize: td.outputsize, apikey: key, order: 'DESC', end_date: endDate });
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
    save('xau-m15', [...byTime.values()].sort((a, b) => (a.time < b.time ? -1 : 1)));
    onPage?.(byTime.size, rows.at(-1).time);
    if (rows.length < td.outputsize) {
      reason = 'المصدر لا يعطي بيانات أقدم';
      break;
    }
    endDate = fmt(toMs(rows.at(-1).time) - 60000);
    await sleep(td.pauseMs);
  }
  return { candles: load('xau-m15') ?? [], reason };
}

function clean(rows) {
  const seen = new Set();
  return rows
    .map((c) => ({ ...c, ms: toMs(c.time) }))
    .filter((c) => !marketClosed(c.ms) && !seen.has(c.time) && seen.add(c.time))
    .sort((a, b) => a.ms - b.ms);
}

module.exports = { fetchM15, clean, load, save };
