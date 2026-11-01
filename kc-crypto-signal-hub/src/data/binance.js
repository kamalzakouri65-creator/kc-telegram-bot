// بيانات Binance العامة فقط: شموع السوق عبر طلبات GET بدون أي مفتاح أو توقيع.
// هذا الملف هو الوحيد الذي يتصل بـ Binance، والمسار الوحيد المسموح هو ALLOWED_PATHS.
const fs = require('fs');
const path = require('path');
const { config } = require('../config');
const { parseKline, closedOnly, mergeCandles } = require('./candles');

const ALLOWED_PATHS = ['/api/v3/klines'];

async function publicGet(pathname, params, { baseUrl = config.binance.baseUrl } = {}) {
  if (!ALLOWED_PATHS.includes(pathname)) throw new Error(`مسار غير مسموح: ${pathname}`);
  const url = new URL(pathname, baseUrl);
  url.search = new URLSearchParams(params);
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Binance HTTP ${res.status} (${pathname} ${params.symbol ?? ''} ${params.interval ?? ''})`);
  return res.json();
}

// آخر الشموع المغلقة فقط، للمراقبة الحية
async function fetchRecent(symbol, interval, limit = 500, now = Date.now()) {
  const rows = await publicGet('/api/v3/klines', { symbol, interval, limit: Math.min(limit + 1, 1000) });
  return closedOnly(rows.map(parseKline), now).slice(-limit);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// تاريخ طويل على دفعات من 1000 شمعة، للاختبار التاريخي
async function fetchHistory(symbol, interval, startTime, endTime = Date.now(), { onProgress, pauseMs = 250 } = {}) {
  const intervalMs = config.intervalMs[interval];
  let all = [];
  let from = startTime;
  while (from < endTime) {
    const rows = await publicGet('/api/v3/klines', {
      symbol,
      interval,
      startTime: from,
      endTime,
      limit: config.binance.klinesLimit,
    });
    if (rows.length === 0) break;
    all = mergeCandles(all, rows.map(parseKline));
    from = all.at(-1).openTime + intervalMs;
    onProgress?.(all.length);
    if (rows.length < config.binance.klinesLimit) break;
    await sleep(pauseMs);
  }
  return closedOnly(all, endTime);
}

// نحفظ البيانات في ملف حتى يكون الاختبار التاريخي قابلاً للتكرار بنفس النتائج
const cacheFile = (symbol, interval, dir = config.paths.cache) => path.join(dir, `${symbol}-${interval}.json`);

function loadCache(symbol, interval, dir) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(symbol, interval, dir), 'utf8'));
  } catch {
    return null;
  }
}

function saveCache(symbol, interval, candles, dir = config.paths.cache) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cacheFile(symbol, interval, dir), JSON.stringify(candles));
}

module.exports = { ALLOWED_PATHS, publicGet, fetchRecent, fetchHistory, loadCache, saveCache, cacheFile };
