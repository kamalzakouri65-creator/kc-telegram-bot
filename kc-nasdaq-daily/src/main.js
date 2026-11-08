// npm run fetch-data              بيانات يومية لـ Nasdaq 100 و S&P 500 منذ 2004
// npm run backtest                مرحلة التطوير: من 2021-01-01
// npm run validate -- --final     مرحلة التأكيد 2005–2020: مرة واحدة، وفقط إذا نجحت استراتيجية في التطوير
const fs = require('fs');
const path = require('path');
const { config, DECISIONS } = require('./config');
const data = require('./data');
const { metrics, judge, STRATEGIES } = require('./engine');

const fmt = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
const pf = (m) => (m.count === 0 ? '—' : Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞');

async function fetchData() {
  for (const m of config.markets) {
    const candles = await data.fetchDaily(m.ticker);
    data.save(m.ticker, candles);
    console.log(`${m.name}: ${candles.length} يوماً من ${candles[0].time} إلى ${candles.at(-1).time}`);
  }
}

function run(title, range, only = null) {
  const lines = [`KC Nasdaq Daily V1 — ${title}`, 'يومي، شراء فقط، بعد السبريد والـ Swap', ''];
  const verdicts = {};
  for (const [name, fn] of Object.entries(STRATEGIES)) {
    if (only && !only.includes(name)) continue;
    lines.push(`━━ ${name}`);
    const res = {};
    for (const m of config.markets) {
      const candles = data.load(m.ticker);
      if (!candles) throw new Error(`لا توجد بيانات ${m.name}. شغّل أولاً: npm run fetch-data`);
      res[m.ticker] = metrics(fn(candles, { ...range, spreadPct: m.spreadPct }));
      const r = res[m.ticker];
      lines.push(`  ${m.name}: ${r.count} صفقة | ربح ${r.winRate.toFixed(0)}% | PF ${pf(r)} | ${fmt(r.totalR)}R | تراجع ${r.maxDd.toFixed(1)}R`);
    }
    const j = judge(res['^NDX'], res['^GSPC']);
    verdicts[name] = j.pass;
    lines.push(j.pass ? '  ✅ نجحت في الشروط' : `  ❌ فشلت — ${j.reasons.join('، ')}`, '');
  }
  lines.push(`الشروط: Nasdaq ${config.criteria.minTrades} صفقة على الأقل و PF ≥ ${config.criteria.minProfitFactor} ورابح، و S&P 500 رابح.`, '', 'القواعد:', ...DECISIONS, '', 'R = المبلغ الذي تخاطر به في الصفقة.');
  return { report: lines.join('\n'), verdicts };
}

function backtest() {
  const { report, verdicts } = run(`التطوير (من ${config.dev.from})`, { from: config.dev.from });
  console.log(report);
  fs.mkdirSync(config.paths.logs, { recursive: true });
  fs.writeFileSync(path.join(config.paths.logs, 'dev-report.txt'), report);
  data.save('dev-verdicts', verdicts);
}

function validate() {
  if (!process.argv.includes('--final')) return console.log('⚠️ مرحلة التأكيد تُشغّل مرة واحدة فقط. للتشغيل: npm run validate -- --final');
  const dev = data.load('dev-verdicts');
  if (!dev) return console.log('شغّل مرحلة التطوير أولاً: npm run backtest');
  const passed = Object.keys(dev).filter((k) => dev[k]);
  if (!passed.length) return console.log('لا توجد استراتيجية نجحت في التطوير، فلا نلمس بيانات 2005–2020.');
  if (data.load('final-done')) console.log('⚠️ التأكيد شُغّل من قبل. النتيجة الأولى هي المعتمدة.\n');
  const { report } = run(`التأكيد (${config.final.from} → ${config.final.to})`, { from: config.final.from, to: config.final.to }, passed);
  console.log(report);
  fs.mkdirSync(config.paths.logs, { recursive: true });
  fs.writeFileSync(path.join(config.paths.logs, 'final-report.txt'), report);
  data.save('final-done', { at: new Date().toISOString() });
}

const cmd = process.argv[2];
Promise.resolve(cmd === 'fetch-data' ? fetchData() : cmd === 'backtest' ? backtest() : cmd === 'validate' ? validate() : console.log('الأوامر: fetch-data | backtest | validate')).catch((err) => {
  console.error('فشل:', err.message);
  process.exit(1);
});
