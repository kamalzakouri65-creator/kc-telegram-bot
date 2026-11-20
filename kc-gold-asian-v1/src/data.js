// بيانات الذهب M15 من kc-gold-lab: قراءة فقط، مع التحقق من البصمة قبل القراءة وبعدها. التنظيف في الذاكرة فقط.
const fs = require('fs');
const crypto = require('crypto');
const { config } = require('./config');
const { marketClosed, toMs, fmt } = require('./time');

const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// يقرأ الملف الأصلي ويعيده بصيغة أعمدة (مرتبة، بدون تعديل الأسعار)، مع إحصاء المكرر وغير المرتب
function loadSource(file = config.paths.sourceM15) {
  if (!fs.existsSync(file)) throw new Error(`لا يوجد ملف البيانات: ${file}`);
  const before = sha256File(file);
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  const after = sha256File(file);
  if (before !== after) throw new Error('تغيّر الملف الأصلي أثناء القراءة!');
  let unsorted = 0;
  const seen = new Map();
  let duplicates = 0;
  let prev = -Infinity;
  for (const r of rows) {
    const ms = toMs(r.time);
    if (ms < prev) unsorted++;
    prev = ms;
    if (seen.has(ms)) duplicates++;
    else seen.set(ms, [Number(r.open), Number(r.high), Number(r.low), Number(r.close)]);
  }
  const keys = [...seen.keys()].sort((a, b) => a - b);
  const bars = { t: keys, o: [], h: [], l: [], c: [] };
  for (const k of keys) {
    const [o, h, l, c] = seen.get(k);
    bars.o.push(o);
    bars.h.push(h);
    bars.l.push(l);
    bars.c.push(c);
  }
  return { bars, hash: before, raw: rows.length, duplicates, unsorted };
}

const invalid = (o, h, l, c) => ![o, h, l, c].every((x) => Number.isFinite(x) && x > 0) || h < Math.max(o, c) || l > Math.min(o, c);

function clean(bars) {
  const out = { t: [], o: [], h: [], l: [], c: [] };
  const removed = { closed: 0, invalid: 0 };
  for (let i = 0; i < bars.t.length; i++) {
    if (marketClosed(bars.t[i])) {
      removed.closed++;
      continue;
    }
    if (invalid(bars.o[i], bars.h[i], bars.l[i], bars.c[i])) {
      removed.invalid++;
      continue;
    }
    for (const k of ['t', 'o', 'h', 'l', 'c']) out[k].push(bars[k][i]);
  }
  return { bars: out, removed };
}

// فحص الجودة على البيانات قبل التنظيف (بدون تعديل)
function quality(bars) {
  const STEP = 15 * 60000;
  const q = { count: bars.t.length, first: bars.t[0], last: bars.t.at(-1), closed: 0, invalid: 0, flat: 0, offGrid: 0, missingOpen: 0, expectedOpen: 0, gaps: [], jumps: [], months: {} };
  for (let i = 0; i < bars.t.length; i++) {
    const t = bars.t[i];
    if (t % STEP !== 0) q.offGrid++;
    if (marketClosed(t)) q.closed++;
    if (invalid(bars.o[i], bars.h[i], bars.l[i], bars.c[i])) q.invalid++;
    if (bars.o[i] === bars.h[i] && bars.h[i] === bars.l[i] && bars.l[i] === bars.c[i]) q.flat++;
    const mo = fmt(t).slice(0, 7);
    q.months[mo] = (q.months[mo] ?? 0) + 1;
    if (i === 0) continue;
    const dt = (t - bars.t[i - 1]) / STEP;
    if (dt > 1) {
      let missing = 0;
      for (let k = 1; k < dt; k++) if (!marketClosed(bars.t[i - 1] + k * STEP)) missing++;
      if (missing) {
        q.missingOpen += missing;
        q.gaps.push({ after: bars.t[i - 1], missing });
      }
    }
    const jump = Math.abs(bars.o[i] - bars.c[i - 1]) / bars.c[i - 1];
    if (jump > 0.005) q.jumps.push({ time: t, pct: jump * 100, closed: marketClosed(t) });
  }
  for (let t = Math.ceil(q.first / STEP) * STEP; t <= q.last; t += STEP) if (!marketClosed(t)) q.expectedOpen++;
  q.gaps.sort((a, b) => b.missing - a.missing);
  return q;
}

module.exports = { sha256File, loadSource, clean, quality };
