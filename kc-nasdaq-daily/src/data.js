// شموع يومية من Yahoo Finance (GET عام، بدون مفتاح)، مع الحفظ في ملفات.
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

const BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';

function parseDaily(json) {
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(json?.chart?.error?.description ?? 'رد غير متوقع من Yahoo');
  const q = r.indicators?.quote?.[0] ?? {};
  const out = [];
  (r.timestamp ?? []).forEach((s, k) => {
    const [open, high, low, close] = [q.open?.[k], q.high?.[k], q.low?.[k], q.close?.[k]];
    if ([open, high, low, close].some((v) => v == null)) return;
    out.push({ time: new Date(s * 1000).toISOString().slice(0, 10), open, high, low, close });
  });
  // يوم واحد = شمعة واحدة (أحياناً يكرر Yahoo آخر يوم)
  return [...new Map(out.map((c) => [c.time, c])).values()];
}

async function fetchDaily(ticker, from = config.dataFrom, now = new Date()) {
  const url = new URL(BASE_URL + encodeURIComponent(ticker));
  url.search = new URLSearchParams({ interval: '1d', period1: Math.floor(Date.parse(from) / 1000), period2: Math.floor(now / 1000) });
  const res = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} عند جلب ${ticker}`);
  const today = now.toISOString().slice(0, 10);
  // اليوم الحالي قد يكون غير مكتمل
  return parseDaily(await res.json()).filter((c) => c.time < today);
}

const file = (name) => path.join(config.paths.data, `${name.replace(/\W/g, '')}.json`);
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

module.exports = { fetchDaily, parseDaily, save, load };
