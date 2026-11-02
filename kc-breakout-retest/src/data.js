// بيانات Binance العامة فقط (GET /api/v3/klines بدون مفاتيح)، والحفظ في ملفات، وفحص جودة البيانات.
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

const ALLOWED_PATHS = ['/api/v3/klines'];

const parseKline = (k) => ({
  openTime: k[0],
  open: Number(k[1]),
  high: Number(k[2]),
  low: Number(k[3]),
  close: Number(k[4]),
  volume: Number(k[5]),
  closeTime: k[6],
});

async function publicGet(pathname, params) {
  if (!ALLOWED_PATHS.includes(pathname)) throw new Error(`مسار غير مسموح: ${pathname}`);
  const url = new URL(pathname, config.binance.baseUrl);
  url.search = new URLSearchParams(params);
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHistory(symbol, interval, startTime, endTime, { onProgress, pauseMs = 250 } = {}) {
  const step = config.intervalMs[interval];
  const byTime = new Map();
  let from = startTime;
  while (from < endTime) {
    const rows = await publicGet('/api/v3/klines', { symbol, interval, startTime: from, endTime, limit: config.binance.klinesLimit });
    if (rows.length === 0) break;
    for (const r of rows) byTime.set(r[0], parseKline(r));
    from = rows.at(-1)[0] + step;
    onProgress?.(byTime.size);
    if (rows.length < config.binance.klinesLimit) break;
    await sleep(pauseMs);
  }
  // الشموع المغلقة فقط
  return [...byTime.values()].sort((a, b) => a.openTime - b.openTime).filter((c) => c.closeTime < endTime);
}

// فحص الجودة: الشموع المفقودة (فجوات) والمكررة. لا نملأ أي فجوة ولا نعدّل أي شمعة.
function checkQuality(candles, intervalMs) {
  let duplicates = 0;
  const gaps = [];
  for (let i = 1; i < candles.length; i++) {
    const diff = candles[i].openTime - candles[i - 1].openTime;
    if (diff === 0) duplicates++;
    else if (diff !== intervalMs) gaps.push({ after: candles[i - 1].openTime, missing: diff / intervalMs - 1 });
  }
  return { count: candles.length, duplicates, gaps, missingTotal: gaps.reduce((s, g) => s + g.missing, 0) };
}

const file = (name) => path.join(config.paths.data, `${name}.json`);
const save = (name, value) => {
  fs.mkdirSync(config.paths.data, { recursive: true });
  fs.writeFileSync(file(name), JSON.stringify(value));
};
const load = (name) => {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return null;
  }
};

module.exports = { ALLOWED_PATHS, publicGet, fetchHistory, checkQuality, parseKline, save, load };
