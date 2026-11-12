// npm run fetch-data | npm run backtest | npm run validate -- --final (مرة واحدة، فقط إذا نجح التطوير)
const fs = require('fs');
const path = require('path');
const { config, DECISIONS } = require('./config');
// نفس الكود الذي اختُبر على Nasdaq، بدون نسخ ولا تعديل
const { fetchDaily } = require('../../kc-nasdaq-daily/src/data');
const { runRsi2, metrics, judge } = require('../../kc-nasdaq-daily/src/engine');

const file = (name) => path.join(config.paths.data, `${name.replace(/\W/g, '')}.json`);
const save = (name, v) => {
  fs.mkdirSync(config.paths.data, { recursive: true });
  fs.writeFileSync(file(name), JSON.stringify(v));
};
const load = (name) => {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return null;
  }
};
const fmt = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
const pf = (m) => (m.count === 0 ? '—' : Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞');

async function fetchData() {
  for (const m of config.markets) {
    const cs = await fetchDaily(m.ticker, config.dataFrom);
    save(m.ticker, cs);
    console.log(`${m.name}: ${cs.length} يوماً من ${cs[0].time} إلى ${cs.at(-1).time}`);
  }
}

function run(title, range) {
  const res = {};
  const lines = [`KC Metals Daily V1 — RSI(2) — ${title}`, 'يومي، شراء فقط، بعد السبريد والـ Swap', ''];
  for (const m of config.markets) {
    const cs = load(m.ticker);
    if (!cs) throw new Error(`لا توجد بيانات ${m.name}. شغّل أولاً: npm run fetch-data`);
    const r = (res[m.name] = metrics(runRsi2(cs, { ...range, spreadPct: m.spreadPct })));
    lines.push(`  ${m.name}: ${r.count} صفقة | ربح ${r.winRate.toFixed(0)}% | PF ${pf(r)} | ${fmt(r.totalR)}R | تراجع ${r.maxDd.toFixed(1)}R`);
  }
  const j = judge(res.GOLD, res.SILVER, config.criteria);
  const reasons = j.reasons.map((x) => x.replace('Nasdaq', 'الذهب').replace('S&P 500', 'الفضة').replace('نتيجة الذهب', 'نتيجة الذهب'));
  lines.push(j.pass ? '  ✅ نجحت في الشروط' : `  ❌ فشلت — ${reasons.join('، ')}`, '');
  lines.push(`الشروط: الذهب ${config.criteria.minTrades} صفقة على الأقل و PF ≥ ${config.criteria.minProfitFactor} ورابح، والفضة رابحة.`, '', 'القواعد:', ...DECISIONS, '', 'R = المبلغ الذي تخاطر به في الصفقة.');
  return { report: lines.join('\n'), pass: j.pass };
}

function backtest() {
  const { report, pass } = run(`التطوير (من ${config.dev.from})`, { from: config.dev.from });
  console.log(report);
  fs.mkdirSync(config.paths.logs, { recursive: true });
  fs.writeFileSync(path.join(config.paths.logs, 'dev-report.txt'), report);
  save('dev-verdict', { pass });
}

function validate() {
  if (!process.argv.includes('--final')) return console.log('⚠️ التأكيد يُشغّل مرة واحدة فقط. للتشغيل: npm run validate -- --final');
  const dev = load('dev-verdict');
  if (!dev) return console.log('شغّل التطوير أولاً: npm run backtest');
  if (!dev.pass) return console.log('لم تنجح في التطوير، فلا نلمس بيانات 2005–2020.');
  if (load('final-done')) console.log('⚠️ التأكيد شُغّل من قبل. النتيجة الأولى هي المعتمدة.\n');
  const { report } = run(`التأكيد (${config.final.from} → ${config.final.to})`, { from: config.final.from, to: config.final.to });
  console.log(report);
  fs.mkdirSync(config.paths.logs, { recursive: true });
  fs.writeFileSync(path.join(config.paths.logs, 'final-report.txt'), report);
  save('final-done', { at: new Date().toISOString() });
}

const cmd = process.argv[2];
Promise.resolve(cmd === 'fetch-data' ? fetchData() : cmd === 'backtest' ? backtest() : cmd === 'validate' ? validate() : console.log('الأوامر: fetch-data | backtest | validate')).catch((e) => {
  console.error('فشل:', e.message);
  process.exit(1);
});
