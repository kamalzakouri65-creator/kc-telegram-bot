// KC Metals Daily — الفكرة 2: استراتيجيتا البوت (EMA + MACD و Pullback) كما هما، على الإطار اليومي للذهب والفضة.
// شراء وبيع (XM يسمح بالاثنين). القواعد والشروط ثابتة قبل التشغيل (2026-11-12).
// npm run trend   التطوير (2021 →)
// npm run trend-validate -- --final   التأكيد 2005–2020: مرة واحدة، وفقط لاستراتيجية نجحت في التطوير
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { analyze } = require('../../gold-forex-signals-bot/src/strategy');
const { analyzePullback } = require('../../gold-forex-signals-bot/src/pullback');
const { metrics } = require('../../kc-nasdaq-daily/src/engine');

const STRATEGIES = { 'EMA + MACD': analyze, Pullback: analyzePullback };
const SWAP_PCT_PER_NIGHT = 0.02; // تقدير لتكلفة الليلة في XM للشراء والبيع
// النجاح لكل استراتيجية: الذهب 15 صفقة على الأقل و PF ≥ 1.2 ورابح، والفضة رابحة
const CRITERIA = { minTrades: 15, minProfitFactor: 1.2 };
const WINDOW = 500;
const nights = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// نفس إدارة البوت: نصف عند الهدف 1 ونصف عند الهدف 2، الوقف ثابت، والوقف والهدف في نفس الشمعة = وقف
function runTrend(candles, fn, { from, to = '9999', spreadPct, swapPct = SWAP_PCT_PER_NIGHT }) {
  const trades = [];
  let open = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (open) {
      const d = open.dir;
      const stopHit = d === 1 ? c.low <= open.stop : c.high >= open.stop;
      for (const h of open.halves) {
        if (h.r !== null) continue;
        if (stopHit) h.r = -1;
        else if (d === 1 ? c.high >= h.target : c.low <= h.target) h.r = (d * (h.target - open.entry)) / open.risk;
      }
      if (open.halves.every((h) => h.r !== null)) {
        const cost = (open.entry * (spreadPct + nights(open.time, c.time) * swapPct)) / 100 / open.risk;
        trades.push({ time: open.time, closedAt: c.time, side: d === 1 ? 'BUY' : 'SELL', r: (open.halves[0].r + open.halves[1].r) / 2 - cost });
        open = null;
      }
      continue;
    }
    if (c.time < from || c.time > to) continue;
    const s = fn(candles.slice(Math.max(0, i + 1 - WINDOW), i + 1));
    if (!s) continue;
    const dir = s.side === 'BUY' ? 1 : -1;
    const risk = dir * (s.entry - s.stopLoss);
    if (!(risk > 0)) continue;
    open = { time: c.time, dir, entry: s.entry, stop: s.stopLoss, risk, halves: [{ target: s.takeProfit1, r: null }, { target: s.takeProfit2, r: null }] };
  }
  return trades;
}

function judge(gold, silver, c = CRITERIA) {
  const reasons = [];
  if (gold.count < c.minTrades) reasons.push(`صفقات الذهب أقل من ${c.minTrades}`);
  if (!(gold.profitFactor >= c.minProfitFactor)) reasons.push(`معامل ربح الذهب أقل من ${c.minProfitFactor}`);
  if (!(gold.totalR > 0)) reasons.push('الذهب غير رابح');
  if (!(silver.totalR > 0)) reasons.push('الفضة غير رابحة (فنتيجة الذهب صدفة على الأرجح)');
  return { pass: reasons.length === 0, reasons };
}

module.exports = { runTrend, judge, STRATEGIES, CRITERIA };

if (require.main === module) {
  const file = (n) => path.join(config.paths.data, `${n.replace(/\W/g, '')}.json`);
  const load = (n) => {
    try {
      return JSON.parse(fs.readFileSync(file(n), 'utf8'));
    } catch {
      return null;
    }
  };
  const save = (n, v) => {
    fs.mkdirSync(config.paths.data, { recursive: true });
    fs.writeFileSync(file(n), JSON.stringify(v));
  };
  const fmt = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
  const pf = (m) => (m.count === 0 ? '—' : Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞');

  function run(title, range, only) {
    const lines = [`KC Metals Daily — الترند اليومي — ${title}`, 'استراتيجيتا البوت كما هما، شراء وبيع، بعد سبريد XM و Swap 0.02% لكل ليلة', ''];
    const verdicts = {};
    for (const [name, fn] of Object.entries(STRATEGIES)) {
      if (only && !only.includes(name)) continue;
      lines.push(`━━ ${name}`);
      const res = {};
      for (const m of config.markets) {
        const cs = load(m.ticker);
        if (!cs) throw new Error(`لا توجد بيانات ${m.name}. شغّل أولاً: npm run fetch-data`);
        const trades = runTrend(cs, fn, { ...range, spreadPct: m.spreadPct });
        const r = (res[m.name] = metrics(trades));
        const buy = metrics(trades.filter((t) => t.side === 'BUY'));
        const sell = metrics(trades.filter((t) => t.side === 'SELL'));
        lines.push(`  ${m.name}: ${r.count} صفقة | ربح ${r.winRate.toFixed(0)}% | PF ${pf(r)} | ${fmt(r.totalR)}R | تراجع ${r.maxDd.toFixed(1)}R`);
        lines.push(`     شراء ${buy.count} (${fmt(buy.totalR)}R) | بيع ${sell.count} (${fmt(sell.totalR)}R)`);
      }
      const j = judge(res.GOLD, res.SILVER);
      verdicts[name] = j.pass;
      lines.push(j.pass ? '  ✅ نجحت في الشروط' : `  ❌ فشلت — ${j.reasons.join('، ')}`, '');
    }
    lines.push(`الشروط: الذهب ${CRITERIA.minTrades} صفقة على الأقل و PF ≥ ${CRITERIA.minProfitFactor} ورابح، والفضة رابحة.`, 'R = المبلغ الذي تخاطر به في الصفقة.');
    return { report: lines.join('\n'), verdicts };
  }

  const cmd = process.argv[2];
  if (cmd === 'validate') {
    const dev = load('trend-dev-verdicts');
    if (!process.argv.includes('--final')) console.log('⚠️ التأكيد يُشغّل مرة واحدة فقط. للتشغيل: npm run trend-validate -- --final');
    else if (!dev) console.log('شغّل التطوير أولاً: npm run trend');
    else {
      const passed = Object.keys(dev).filter((k) => dev[k]);
      if (!passed.length) console.log('لا توجد استراتيجية نجحت في التطوير، فلا نلمس بيانات 2005–2020.');
      else {
        if (load('trend-final-done')) console.log('⚠️ التأكيد شُغّل من قبل. النتيجة الأولى هي المعتمدة.\n');
        console.log(run(`التأكيد (${config.final.from} → ${config.final.to})`, { from: config.final.from, to: config.final.to }, passed).report);
        save('trend-final-done', { at: new Date().toISOString() });
      }
    }
  } else {
    const { report, verdicts } = run(`التطوير (من ${config.dev.from})`, { from: config.dev.from });
    console.log(report);
    save('trend-dev-verdicts', verdicts);
  }
}
