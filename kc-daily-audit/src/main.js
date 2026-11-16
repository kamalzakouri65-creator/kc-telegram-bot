// npm run fetch-data   بيانات يومية: NASDAQ 100 و S&P 500 من Yahoo منذ 1984، والعملات الأربع من Binance منذ 2017
// npm run audit        (أ) المؤشرات 1985–2004 مرة واحدة  (ب) أثر نافذة البوت الحي (300 شمعة) على المؤشرات والكريبتو
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { runRsi2Windowed, runCryptoWindowed, metrics, flatShare } = require('./engine');
// قراءة فقط من المشاريع السابقة والبوت
const { config: ndxConfig } = require('../../kc-nasdaq-daily/src/config');
const { runRsi2 } = require('../../kc-nasdaq-daily/src/engine');
const yahoo = require('../../kc-nasdaq-daily/src/data');
const binance = require('../../kc-crypto-daily/src/data');
const { config: cryptoConfig } = require('../../kc-crypto-daily/src/config');
const { analyze } = require('../../gold-forex-signals-bot/src/strategy');

const file = (name) => path.join(config.paths.data, `${name.replace(/\W/g, '')}.json`);
const save = (name, v) => (fs.mkdirSync(config.paths.data, { recursive: true }), fs.writeFileSync(file(name), JSON.stringify(v)));
const load = (name) => {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return null;
  }
};

const sgn = (x, d = 1) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
const pf = (m) => (m.n === 0 ? '—' : Number.isFinite(m.pf) ? m.pf.toFixed(2) : '∞');
const row = (label, m) => `${label}: ${m.n} صفقة | ربح ${m.winRate.toFixed(0)}% | PF ${pf(m)} | ${sgn(m.net)}R | تراجع ${m.maxDd.toFixed(1)}R`;
const common = (a, b) => {
  const s = new Set(b.map((t) => t.time));
  return a.filter((t) => s.has(t.time)).length;
};

async function fetchData() {
  for (const m of ndxConfig.markets) {
    const c = await yahoo.fetchDaily(m.ticker, config.indices.dataFrom);
    save(m.ticker, c);
    console.log(`${m.name}: ${c.length} يوم من ${c[0]?.time} إلى ${c.at(-1)?.time}`);
  }
  for (const p of config.crypto.pairs) {
    const c = await binance.fetchDaily(p, Date.parse(config.crypto.dataFrom));
    save(p, c);
    console.log(`${p}: ${c.length} يوم من ${c[0]?.time.slice(0, 10)} إلى ${c.at(-1)?.time.slice(0, 10)}`);
  }
  console.log('\nالخطوة التالية: npm run audit');
}

function audit() {
  const L = ['KC DAILY AUDIT — المؤشرات (RSI2) والكريبتو (EMA+MACD يومي)، القواعد من البوت كما هي', ''];
  const I = config.indices;

  // (أ) المؤشرات 1985–2004
  L.push(`━━ (أ) المؤشرات: فترة لم تُستعمل أبداً (${I.from} → ${I.to})، نفس القواعد والتكاليف، تشغيل مرة واحدة`);
  const verdicts = [];
  for (const m of ndxConfig.markets) {
    const all = load(m.ticker);
    if (!all?.length) {
      L.push(`⚠️ لا توجد بيانات ${m.name}. شغّل أولاً: npm run fetch-data`);
      verdicts.push(null);
      continue;
    }
    const period = all.filter((c) => c.time >= I.from && c.time <= I.to);
    const flat = flatShare(period);
    const trades = runRsi2(all, { from: I.from, to: I.to, spreadPct: m.spreadPct });
    const mm = metrics(trades);
    L.push(`• ${m.name}: بيانات ${period[0]?.time} → ${period.at(-1)?.time} (${period.length} يوم)، شموع بلا مدى ${(flat * 100).toFixed(1)}%`);
    L.push(`   ${row('المجموع', mm)}${trades.length ? ` | أول صفقة ${trades[0].time}` : ''}`);
    for (let y = 1985; y <= 2004; y += I.bucketYears) {
      const t = trades.filter((x) => +x.time.slice(0, 4) >= y && +x.time.slice(0, 4) < y + I.bucketYears);
      L.push(`   ${row(`${y}–${Math.min(y + I.bucketYears - 1, 2004)}`, metrics(t))}`);
    }
    const reasons = [];
    if (flat > I.maxFlatShare) reasons.push(`البيانات غير موثوقة (${(flat * 100).toFixed(1)}% شموع بلا مدى)`);
    if (!(mm.pf >= I.criteria.minProfitFactor)) reasons.push(`PF ${pf(mm)} أقل من ${I.criteria.minProfitFactor}`);
    if (!(mm.net > 0)) reasons.push(`الصافي ${sgn(mm.net)}R غير موجب`);
    verdicts.push({ name: m.name, reasons, unreliable: flat > I.maxFlatShare });
  }
  L.push('');

  // (ب) نافذة 300 على المؤشرات (2005 → اليوم)
  L.push('━━ (ب-1) المؤشرات: الإشارة من آخر 300 يوم (مثل البوت الحي) مقابل كل التاريخ (مثل الاختبار)، من 2005');
  for (const m of ndxConfig.markets) {
    const all = load(m.ticker);
    if (!all?.length) continue;
    const full = runRsi2(all, { from: '2005-01-01', spreadPct: m.spreadPct });
    const live = runRsi2Windowed(all, { from: '2005-01-01', spreadPct: m.spreadPct, window: config.windows.live });
    L.push(`• ${m.name}: صفقات مشتركة ${common(full, live)} من ${full.length}`);
    L.push(`   ${row('كل التاريخ', metrics(full))}`);
    L.push(`   ${row('نافذة 300', metrics(live))}`);
  }
  L.push('');

  // (ب) نافذة 300 على الكريبتو
  L.push(`━━ (ب-2) الكريبتو: نافذة 300 (البوت الحي) مقابل 500 (الاختبار)، من ${config.crypto.dataFrom} (ليست Out-of-Sample)`);
  const by = { 500: {}, 300: {} };
  for (const p of config.crypto.pairs) {
    const c = load(p);
    if (!c?.length) {
      L.push(`⚠️ لا توجد بيانات ${p}. شغّل أولاً: npm run fetch-data`);
      continue;
    }
    by[500][p] = runCryptoWindowed(c, analyze, { window: config.windows.cryptoTest });
    by[300][p] = runCryptoWindowed(c, analyze, { window: config.windows.live });
    L.push(`• ${p}: صفقات مشتركة ${common(by[500][p], by[300][p])} من ${by[500][p].length}`);
    L.push(`   ${row('نافذة 500', metrics(by[500][p]))}`);
    L.push(`   ${row('نافذة 300', metrics(by[300][p]))}`);
  }
  let cryptoVerdict = null;
  if (Object.keys(by[300]).length) {
    const flat = (w) => Object.values(by[w]).flat().sort((a, b) => (a.closedAt < b.closedAt ? -1 : 1));
    L.push(`   ${row('المجموع نافذة 500', metrics(flat(500)))}`);
    L.push(`   ${row('المجموع نافذة 300', metrics(flat(300)))}`);
    const t300 = flat(300);
    L.push(`   ${row(`نافذة 300 قبل ${cryptoConfig.dev.from}`, metrics(t300.filter((t) => t.time < cryptoConfig.dev.from)))}`);
    L.push(`   ${row(`نافذة 300 من ${cryptoConfig.dev.from}`, metrics(t300.filter((t) => t.time >= cryptoConfig.dev.from)))}`);
    const C = config.crypto.criteria;
    const m300 = metrics(t300);
    const positive = Object.values(by[300]).filter((t) => metrics(t).net > 0).length;
    const reasons = [];
    if (positive < C.minPositivePairs) reasons.push(`رابحة على ${positive} عملات فقط (المطلوب ${C.minPositivePairs})`);
    if (!(m300.pf >= C.minProfitFactor)) reasons.push(`PF ${pf(m300)} أقل من ${C.minProfitFactor}`);
    if (m300.n < C.minTrades) reasons.push(`صفقات أقل من ${C.minTrades}`);
    cryptoVerdict = { reasons, positive };
  }
  L.push('');

  // الأحكام
  L.push('━━ الأحكام (حسب الشروط المسجلة مسبقاً)');
  for (const v of verdicts.filter(Boolean)) {
    const mark = v.unreliable ? '⚠️ لا حكم' : v.reasons.length ? '❌ لم ينجح' : '✅ نجح';
    L.push(`• ${v.name} 1985–2004: ${mark}`, ...v.reasons.map((r) => `   - ${r}`));
  }
  if (cryptoVerdict) L.push(`• الكريبتو بنافذة 300: ${cryptoVerdict.reasons.length ? '❌ لم ينجح' : '✅ نجح'} (عملات رابحة ${cryptoVerdict.positive} من 4)`, ...cryptoVerdict.reasons.map((r) => `   - ${r}`));
  L.push('', 'التكاليف: المؤشرات سبريد XM + Swap 0.02% لكل ليلة (تقديري). الكريبتو رسوم 0.1% + انزلاق 0.05% لكل جهة.');
  L.push('R = المبلغ الذي تخاطر به في الصفقة. لا تداول: اختبار تاريخي فقط.');
  const text = L.join('\n');
  console.log(text);
  fs.mkdirSync(config.paths.logs, { recursive: true });
  fs.writeFileSync(path.join(config.paths.logs, 'audit-report.txt'), text);
  console.log('\nالتقرير محفوظ في logs/audit-report.txt');
}

const cmd = process.argv[2];
Promise.resolve(cmd === 'fetch-data' ? fetchData() : cmd === 'audit' ? audit() : console.log('الأوامر: fetch-data | audit')).catch((e) => {
  console.error('فشل:', e.message);
  process.exit(1);
});
