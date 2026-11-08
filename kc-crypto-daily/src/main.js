// npm run fetch-data   تحميل الشموع اليومية من Binance (بيانات عامة فقط)
// npm run backtest     مرحلة التطوير: من 2023-11-01 حتى الآن
// npm run validate -- --final   مرحلة التأكيد على 2017–2023: مرة واحدة فقط، وفقط إذا نجحت استراتيجية في التطوير
const fs = require('fs');
const path = require('path');
const { config, DECISIONS } = require('./config');
const data = require('./data');
const { runLongOnly, metrics, judge, STRATEGIES } = require('./engine');

const fmt = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
const pf = (m) => (m.count === 0 ? '—' : Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞');

async function fetchData() {
  for (const pair of config.pairs) {
    const candles = await data.fetchDaily(pair, Date.parse(`${config.final.from}T00:00:00Z`));
    data.save(pair, candles);
    console.log(`${pair}: ${candles.length} شمعة يومية من ${candles[0].time.slice(0, 10)} إلى ${candles.at(-1).time.slice(0, 10)}`);
  }
}

function run(title, range) {
  const lines = [`KC Crypto Daily V1 — ${title}`, `شراء فقط، الإطار اليومي، بعد الرسوم والانزلاق (${(2 * (config.costs.feePct + config.costs.slippagePct)).toFixed(2)}% لكل صفقة)`, ''];
  const verdicts = {};
  for (const [name, fn] of Object.entries(STRATEGIES)) {
    const byPair = {};
    lines.push(`━━ ${name}`);
    for (const pair of config.pairs) {
      const candles = data.load(pair);
      if (!candles) throw new Error(`لا توجد بيانات ${pair}. شغّل أولاً: npm run fetch-data`);
      byPair[pair] = runLongOnly(candles, fn, range);
      const m = metrics(byPair[pair]);
      lines.push(`  ${pair}: ${m.count} صفقة | ربح ${m.winRate.toFixed(0)}% | PF ${pf(m)} | ${fmt(m.totalR)}R | تراجع ${m.maxDd.toFixed(1)}R`);
    }
    const j = judge(byPair);
    verdicts[name] = j;
    lines.push(`  المجموع: ${j.count} صفقة | PF ${pf(j)} | ${fmt(j.totalR)}R | رابحة على ${j.positive}/4`);
    lines.push(j.pass ? '  ✅ نجحت في الشروط' : `  ❌ فشلت — ${j.reasons.join('، ')}`);
    lines.push('');
  }
  lines.push(`الشروط: رابحة على ${config.criteria.minPositivePairs} عملات من 4 على الأقل، PF ≥ ${config.criteria.minProfitFactor}، و ${config.criteria.minTrades} صفقة على الأقل.`, '', 'قرارات التفسير:', ...DECISIONS, '', 'R = المبلغ الذي تخاطر به في الصفقة.');
  return { report: lines.join('\n'), verdicts };
}

function backtest() {
  const { report, verdicts } = run(`مرحلة التطوير (من ${config.dev.from})`, { from: config.dev.from });
  console.log(report);
  fs.mkdirSync(config.paths.logs, { recursive: true });
  fs.writeFileSync(path.join(config.paths.logs, 'dev-report.txt'), report);
  data.save('dev-verdicts', Object.fromEntries(Object.entries(verdicts).map(([k, v]) => [k, v.pass])));
}

function validate() {
  if (!process.argv.includes('--final')) {
    console.log('⚠️ مرحلة التأكيد تُشغّل مرة واحدة فقط. للتشغيل: npm run validate -- --final');
    return;
  }
  const dev = data.load('dev-verdicts');
  if (!dev) return console.log('شغّل مرحلة التطوير أولاً: npm run backtest');
  const passed = Object.keys(dev).filter((k) => dev[k]);
  if (!passed.length) return console.log('لا توجد استراتيجية نجحت في مرحلة التطوير، فلا نلمس بيانات 2017–2023.');
  if (data.load('final-done')) console.log('⚠️ تنبيه: مرحلة التأكيد شُغّلت من قبل. النتيجة الأولى هي المعتمدة.\n');
  const { report } = run(`مرحلة التأكيد (${config.final.from} → ${config.final.to})`, { from: config.final.from, to: config.final.to });
  console.log(report);
  console.log(`\nالمعتمد للتأكيد فقط: ${passed.join(' و ')}`);
  fs.mkdirSync(config.paths.logs, { recursive: true });
  fs.writeFileSync(path.join(config.paths.logs, 'final-report.txt'), report);
  data.save('final-done', { at: new Date().toISOString() });
}

const cmd = process.argv[2];
Promise.resolve(cmd === 'fetch-data' ? fetchData() : cmd === 'backtest' ? backtest() : cmd === 'validate' ? validate() : console.log('الأوامر: fetch-data | backtest | validate')).catch((err) => {
  console.error('فشل:', err.message);
  process.exit(1);
});
