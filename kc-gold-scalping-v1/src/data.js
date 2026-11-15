// تحميل شموع M1 من Twelve Data (GET، بيانات سوق فقط) إلى الخلف، مع الحفظ بعد كل صفحة حتى يمكن الاستئناف إذا انقطع التحميل.
// المفتاح من TWELVE_DATA_API_KEY أو قراءة فقط من ملف .env الخاص بالبوت، ولا يُطبع أبداً.
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { marketClosed, toMs } = require('./hours');

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

const FILE = () => path.join(config.paths.data, 'xau-m1.json');
function loadCandles() {
  try {
    return JSON.parse(fs.readFileSync(FILE(), 'utf8'));
  } catch {
    return [];
  }
}
function saveCandles(cs) {
  fs.mkdirSync(config.paths.data, { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(cs));
}

async function fetchPage(endDate, key) {
  const url = new URL(config.twelveData.baseUrl);
  const params = { symbol: config.dataSymbol, interval: config.interval, timezone: 'UTC', outputsize: config.twelveData.outputsize, apikey: key, order: 'DESC' };
  if (endDate) params.end_date = endDate;
  url.search = new URLSearchParams(params);
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === 'error') throw new Error(`Twelve Data: ${data.message}`);
  return (data.values ?? []).map((v) => ({ time: v.datetime, open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close) }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const minusMinute = (time) => new Date(toMs(time) - 60000).toISOString().slice(0, 19).replace('T', ' ');

// من الأحدث إلى الأقدم، مع الاستئناف من أقدم شمعة محفوظة
async function fetchHistory({ months = config.months, pauseMs = config.twelveData.pauseMs, now = new Date(), onPage } = {}) {
  const key = apiKey();
  const stop = new Date(now);
  stop.setUTCMonth(stop.getUTCMonth() - months);
  const stopAt = stop.toISOString().slice(0, 10);
  const byTime = new Map(loadCandles().map((c) => [c.time, c]));
  let endDate = byTime.size ? minusMinute([...byTime.keys()].sort()[0]) : null;
  let reason = 'بلغنا المدة المطلوبة';
  for (let page = 0; page < config.twelveData.maxPages; page++) {
    if (endDate && endDate.slice(0, 10) < stopAt) break;
    const rows = await fetchPage(endDate, key);
    if (!rows.length) {
      reason = 'المصدر لا يعطي بيانات أقدم';
      break;
    }
    for (const r of rows) byTime.set(r.time, r);
    const all = [...byTime.values()].sort((a, b) => (a.time < b.time ? -1 : 1));
    saveCandles(all);
    onPage?.(all.length, rows.at(-1).time);
    if (rows.length < config.twelveData.outputsize) {
      reason = 'المصدر لا يعطي بيانات أقدم';
      break;
    }
    endDate = minusMinute(rows.at(-1).time);
    await sleep(pauseMs);
  }
  return { candles: loadCandles(), reason };
}

// فحص الجودة بدون تعديل البيانات
function checkQuality(cs) {
  const report = { count: cs.length, duplicates: 0, inClosedHours: 0, flat: 0, gaps: [], missingInOpenHours: 0, jumps: [], months: {} };
  const seen = new Set();
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (seen.has(c.time)) report.duplicates++;
    seen.add(c.time);
    const t = toMs(c.time);
    if (marketClosed(t)) report.inClosedHours++;
    if (c.open === c.high && c.high === c.low && c.low === c.close) report.flat++;
    const m = c.time.slice(0, 7);
    report.months[m] = (report.months[m] ?? 0) + 1;
    if (i === 0) continue;
    const prev = cs[i - 1];
    const dt = (t - toMs(prev.time)) / 60000;
    if (dt > 1) {
      let missing = 0;
      for (let k = 1; k < dt; k++) if (!marketClosed(toMs(prev.time) + k * 60000)) missing++;
      if (missing > 0) {
        report.missingInOpenHours += missing;
        report.gaps.push({ after: prev.time, missing });
      }
    }
    const jump = Math.abs(c.open - prev.close) / prev.close;
    if (jump > 0.005 && dt > 0 && dt <= 5) report.jumps.push({ time: c.time, pct: +(jump * 100).toFixed(2) });
  }
  report.gaps.sort((a, b) => b.missing - a.missing);
  return report;
}

module.exports = { fetchHistory, fetchPage, checkQuality, loadCandles, saveCandles, apiKey };
