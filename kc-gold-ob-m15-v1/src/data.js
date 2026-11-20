// بيانات الذهب M1 الخاصة بالمشروع (data/xau-m1.json بصيغة أعمدة). الملف الأصلي في kc-gold-scalping-v1 يُقرأ فقط ولا يُكتب فيه أبداً.
// التحميل من Twelve Data (GET، UTC، بيانات سوق فقط)، يكمل من حيث توقف ويحفظ بعد كل صفحة. المفتاح لا يُطبع أبداً.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('./config');
const { marketClosed, toMs, fmt } = require('./time');

const FILE = () => path.join(config.paths.data, 'xau-m1.json');
const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function apiKey() {
  if (process.env.TWELVE_DATA_API_KEY) return process.env.TWELVE_DATA_API_KEY;
  try {
    const m = fs.readFileSync(config.paths.botEnv, 'utf8').match(/^TWELVE_DATA_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  } catch {
    // لا يوجد ملف
  }
  throw new Error('لا يوجد مفتاح Twelve Data (TWELVE_DATA_API_KEY)');
}

// تخزين: { t: [دقائق منذ 1970]، o، h، l، c }
function loadMap() {
  const map = new Map();
  try {
    const d = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    for (let i = 0; i < d.t.length; i++) map.set(d.t[i], [d.o[i], d.h[i], d.l[i], d.c[i]]);
  } catch {
    // لا يوجد ملف بعد
  }
  return map;
}
function saveMap(map) {
  const keys = [...map.keys()].sort((a, b) => a - b);
  const d = { symbol: config.symbol, tz: 'UTC', note: 'Twelve Data M1 (Mid مفترض)', t: keys, o: [], h: [], l: [], c: [] };
  for (const k of keys) {
    const [o, h, l, c] = map.get(k);
    d.o.push(o);
    d.h.push(h);
    d.l.push(l);
    d.c.push(c);
  }
  fs.mkdirSync(config.paths.data, { recursive: true });
  const tmp = FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d));
  fs.renameSync(tmp, FILE());
}
// M1 للاختبار: { t: [ms]، o، h، l، c } مرتبة
function loadM1() {
  const d = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
  return { t: d.t.map((m) => m * 60000), o: d.o, h: d.h, l: d.l, c: d.c };
}
const exists = () => fs.existsSync(FILE());

// نسخة أولى من الملف الأصلي (قراءة فقط) مع التحقق أن الأصل لم يتغير
function seedFromSource(log) {
  const src = config.paths.sourceM1;
  if (!fs.existsSync(src)) {
    log('⚠️ الملف الأصلي غير موجود، سنحمّل كل البيانات من Twelve Data.');
    return null;
  }
  const before = sha256File(src);
  const rows = JSON.parse(fs.readFileSync(src, 'utf8'));
  const map = new Map();
  let dup = 0;
  for (const r of rows) {
    const m = toMs(r.time) / 60000;
    if (map.has(m)) dup++;
    else map.set(m, [Number(r.open), Number(r.high), Number(r.low), Number(r.close)]);
  }
  saveMap(map);
  const after = sha256File(src);
  log(`نُسخت ${map.size} شمعة من الملف الأصلي (قراءة فقط، مكرر محذوف: ${dup}). الأصل لم يتغير: ${before === after ? '✅' : '❌'}`);
  if (before !== after) throw new Error('تغيّر الملف الأصلي أثناء القراءة!');
  return { before, after };
}

function minMax(map) {
  let min = Infinity;
  let max = -Infinity;
  for (const k of map.keys()) {
    if (k < min) min = k;
    if (k > max) max = k;
  }
  return { min, max };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchPage(endDate, key) {
  const url = new URL(config.twelveData.baseUrl);
  const params = { symbol: config.symbol, interval: '1min', timezone: 'UTC', outputsize: config.twelveData.outputsize, apikey: key, order: 'DESC' };
  if (endDate) params.end_date = endDate;
  url.search = new URLSearchParams(params);
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === 'error') {
    if (data.code === 400 && /no data/i.test(data.message ?? '')) return [];
    throw new Error(`Twelve Data: ${data.message}`);
  }
  return (data.values ?? []).map((v) => [toMs(v.datetime) / 60000, Number(v.open), Number(v.high), Number(v.low), Number(v.close)]);
}

async function fetchAll({ log = console.log, pauseMs = config.twelveData.pauseMs } = {}) {
  let map = loadMap();
  if (!map.size) {
    seedFromSource(log);
    map = loadMap();
  }
  const key = apiKey();
  let pages = 0;
  const merge = (rows) => {
    for (const [m, o, h, l, c] of rows) map.set(m, [o, h, l, c]);
    saveMap(map);
  };
  // 1) الأحدث: من الآن للخلف حتى نلتقي بآخر دقيقة محفوظة
  const newest = map.size ? minMax(map).max : null;
  let end = null;
  for (let p = 0; p < 10; p++) {
    const rows = await fetchPage(end, key);
    pages++;
    if (!rows.length) break;
    merge(rows);
    const oldest = rows.at(-1)[0];
    log(`  الأحدث: ${map.size} شمعة، أقدم هذه الصفحة ${fmt(oldest * 60000)}`);
    if (newest === null || oldest <= newest || rows.length < config.twelveData.outputsize) break;
    end = fmt((oldest - 1) * 60000) + ':00';
    await sleep(pauseMs);
  }
  // 2) الأقدم: حتى 24 شهراً قبل آخر دقيقة
  const last = minMax(map).max * 60000;
  const target = new Date(last);
  target.setUTCMonth(target.getUTCMonth() - config.months);
  let reason = `بلغنا ${config.months} شهراً`;
  for (let p = 0; p < config.twelveData.maxPages; p++) {
    const first = minMax(map).min * 60000;
    if (first <= target.getTime()) break;
    await sleep(pauseMs);
    const rows = await fetchPage(fmt(first - 60000) + ':00', key);
    pages++;
    if (!rows.length) {
      reason = 'المصدر لا يعطي بيانات أقدم';
      break;
    }
    merge(rows);
    log(`  الأقدم: ${map.size} شمعة، أقدم دقيقة ${fmt(rows.at(-1)[0] * 60000)}`);
    if (rows.length < config.twelveData.outputsize) {
      reason = 'المصدر لا يعطي بيانات أقدم';
      break;
    }
  }
  const { min, max } = minMax(map);
  return { count: map.size, first: min * 60000, last: max * 60000, pages, reason };
}

// التنظيف: حذف أوقات إغلاق السوق والشموع غير الصالحة (لا تعديل على الأسعار)
function clean(m1) {
  const out = { t: [], o: [], h: [], l: [], c: [] };
  const removed = { closed: 0, invalid: 0 };
  for (let i = 0; i < m1.t.length; i++) {
    const [o, h, l, c] = [m1.o[i], m1.h[i], m1.l[i], m1.c[i]];
    if (marketClosed(m1.t[i])) {
      removed.closed++;
      continue;
    }
    if (![o, h, l, c].every((x) => Number.isFinite(x) && x > 0) || h < Math.max(o, c) || l > Math.min(o, c)) {
      removed.invalid++;
      continue;
    }
    out.t.push(m1.t[i]);
    out.o.push(o);
    out.h.push(h);
    out.l.push(l);
    out.c.push(c);
  }
  return { m1: out, removed };
}

// فترة الاختبار: آخر 24 شهراً (أو كل المتاح)
function windowOf(m1, months) {
  const end = m1.t[m1.t.length - 1];
  const d = new Date(end);
  d.setUTCMonth(d.getUTCMonth() - months);
  const start = Math.max(m1.t[0], d.getTime());
  return { start, end, months: (end - start) / (30.4375 * 86400000), full: m1.t[0] <= d.getTime() };
}

// فحص الجودة بدون تعديل البيانات
function quality(m1) {
  const q = { count: m1.t.length, first: m1.t[0], last: m1.t.at(-1), duplicates: 0, unsorted: 0, closed: 0, invalid: 0, flat: 0, missingOpen: 0, expectedOpen: 0, gaps: [], jumps: [], months: {} };
  for (let i = 0; i < m1.t.length; i++) {
    const t = m1.t[i];
    const [o, h, l, c] = [m1.o[i], m1.h[i], m1.l[i], m1.c[i]];
    if (marketClosed(t)) q.closed++;
    if (![o, h, l, c].every((x) => Number.isFinite(x) && x > 0) || h < Math.max(o, c) || l > Math.min(o, c)) q.invalid++;
    if (o === h && h === l && l === c) q.flat++;
    const mo = fmt(t).slice(0, 7);
    q.months[mo] = (q.months[mo] ?? 0) + 1;
    if (i === 0) continue;
    const dt = (t - m1.t[i - 1]) / 60000;
    if (dt === 0) q.duplicates++;
    if (dt < 0) q.unsorted++;
    if (dt > 1) {
      let missing = 0;
      for (let k = 1; k < dt; k++) if (!marketClosed(m1.t[i - 1] + k * 60000)) missing++;
      if (missing) {
        q.missingOpen += missing;
        q.gaps.push({ after: m1.t[i - 1], missing });
      }
    }
    const jump = Math.abs(o - m1.c[i - 1]) / m1.c[i - 1];
    if (jump > 0.005 && dt > 0 && dt <= 5) q.jumps.push({ time: t, pct: jump * 100 });
  }
  for (let t = Math.ceil(q.first / 60000) * 60000; t <= q.last; t += 60000) if (!marketClosed(t)) q.expectedOpen++;
  q.gaps.sort((a, b) => b.missing - a.missing);
  return q;
}

module.exports = { FILE, sha256File, loadM1, exists, fetchAll, clean, windowOf, quality, seedFromSource, apiKey };
