// بيانات Binance العامة فقط (GET /api/v3/klines بدون أي مفتاح)، والحفظ في ملفات.
const fs = require('fs');
const path = require('path');
const { config, DAY } = require('./config');

const ALLOWED_PATHS = ['/api/v3/klines'];

async function publicGet(pathname, params) {
  if (!ALLOWED_PATHS.includes(pathname)) throw new Error(`مسار غير مسموح: ${pathname}`);
  const url = new URL(pathname, config.binance.baseUrl);
  url.search = new URLSearchParams(params);
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  return res.json();
}

const pad = (n) => String(n).padStart(2, '0');
const dayString = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

// كل الشموع اليومية المغلقة من startMs حتى الآن
async function fetchDaily(symbol, startMs, now = Date.now()) {
  const rows = new Map();
  let from = startMs;
  while (from < now) {
    const batch = await publicGet('/api/v3/klines', { symbol, interval: config.interval, startTime: from, limit: config.binance.limit });
    if (!batch.length) break;
    for (const k of batch) if (k[6] < now) rows.set(k[0], k);
    from = batch.at(-1)[0] + DAY;
    if (batch.length < config.binance.limit) break;
  }
  return [...rows.values()]
    .sort((a, b) => a[0] - b[0])
    .map((k) => ({ time: `${dayString(k[0])} 00:00:00`, open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]) }));
}

const file = (name) => path.join(config.paths.data, `${name}.json`);
function save(name, value) {
  fs.mkdirSync(config.paths.data, { recursive: true });
  fs.writeFileSync(file(name), JSON.stringify(value));
}
function load(name) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { fetchDaily, publicGet, ALLOWED_PATHS, save, load, dayString };
