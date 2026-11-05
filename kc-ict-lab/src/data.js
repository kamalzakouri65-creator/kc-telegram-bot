// شموع الذهب من Twelve Data (بيانات سوق فقط، GET)، بصفحات إلى الخلف، مع حفظها في ملف.
// المفتاح من TWELVE_DATA_API_KEY أو قراءة فقط من ملف .env الخاص بالبوت، ولا يُطبع أبداً.
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

function apiKey() {
  if (process.env.TWELVE_DATA_API_KEY) return process.env.TWELVE_DATA_API_KEY;
  try {
    const text = fs.readFileSync(path.join(config.paths.root, '..', 'gold-forex-signals-bot', '.env'), 'utf8');
    const m = text.match(/^TWELVE_DATA_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  } catch {
    // لا يوجد ملف
  }
  throw new Error('لا يوجد مفتاح Twelve Data (TWELVE_DATA_API_KEY)');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(interval, endDate, key) {
  const { symbol, timezone, twelveData } = config;
  const url = new URL(twelveData.baseUrl);
  const params = { symbol, interval, timezone, outputsize: twelveData.outputsize, apikey: key, order: 'DESC' };
  if (endDate) params.end_date = endDate;
  url.search = new URLSearchParams(params);
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === 'error') throw new Error(`Twelve Data: ${data.message}`);
  return (data.values ?? []).map((v) => ({ time: v.datetime, open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close) }));
}

async function fetchHistory(interval, { years = config.backtest.years, onProgress, pauseMs = config.twelveData.pauseMs, now = new Date() } = {}) {
  const key = apiKey();
  const oldest = new Date(now);
  oldest.setFullYear(oldest.getFullYear() - years);
  const stopAt = oldest.toISOString().slice(0, 10);
  const byTime = new Map();
  let endDate = null;
  for (let page = 0; page < 40; page++) {
    const rows = await fetchPage(interval, endDate, key);
    if (!rows.length) break;
    for (const r of rows) byTime.set(r.time, r);
    onProgress?.(byTime.size, rows.at(-1).time);
    const earliest = rows.at(-1).time;
    if (earliest.slice(0, 10) <= stopAt || rows.length < config.twelveData.outputsize) break;
    const t = new Date(earliest.replace(' ', 'T') + 'Z');
    t.setUTCMinutes(t.getUTCMinutes() - 1);
    endDate = t.toISOString().slice(0, 19).replace('T', ' ');
    await sleep(pauseMs);
  }
  // اليوم الحالي قد يكون غير مكتمل، فنحذفه
  const today = now.toISOString().slice(0, 10);
  return [...byTime.values()].filter((c) => c.time.slice(0, 10) >= stopAt && c.time.slice(0, 10) < today).sort((a, b) => (a.time < b.time ? -1 : 1));
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

module.exports = { fetchHistory, apiKey, save, load };
