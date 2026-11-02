// node src/main.js fetch-data   تحميل آخر سنتين من Binance (بيانات عامة فقط) مع فحص الجودة
// node src/main.js backtest     الاختبار التاريخي وكتابة التقارير في logs/
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const data = require('./data');

const DAY = 24 * 60 * 60 * 1000;
const TFS = ['1h', '15m'];

async function fetchData() {
  const end = Date.now();
  // 15 يوماً إضافية حتى تكتمل ATR وآخر 200 شمعة H1 قبل بداية الفترة
  const start = end - (config.backtest.days + 15) * DAY;
  for (const pair of Object.keys(config.pairs)) {
    for (const tf of TFS) {
      const candles = await data.fetchHistory(pair, tf, start, end, { onProgress: (n) => process.stdout.write(`\r${pair} ${tf}: ${n} شمعة`) });
      data.save(`${pair}-${tf}`, candles);
      console.log(`\r${pair} ${tf}: ${candles.length} شمعة ✓     `);
    }
  }
  data.save('meta', { fetchedAt: new Date().toISOString(), source: config.binance.baseUrl + '/api/v3/klines', from: start, to: end });
}

function backtest() {
  const { runBacktest } = require('./engine');
  const { buildReport, tradesCsv, equityCsv } = require('./report');
  const all = {};
  const quality = {};
  for (const pair of Object.keys(config.pairs)) {
    const [h1, m15] = TFS.map((tf) => data.load(`${pair}-${tf}`));
    if (!h1 || !m15) {
      console.error(`لا توجد بيانات لـ ${pair}. شغّل أولاً: npm run fetch-data`);
      process.exit(1);
    }
    all[pair] = { h1, m15 };
    quality[`${pair} 1h`] = data.checkQuality(h1, config.intervalMs['1h']);
    quality[`${pair} 15m`] = data.checkQuality(m15, config.intervalMs['15m']);
  }
  const result = runBacktest(all, config);
  const altResult = runBacktest(all, config, { feeRate: config.risk.altFeeRate });
  const report = buildReport({ result, altResult, quality, meta: data.load('meta') });
  console.log(report);
  fs.mkdirSync(config.paths.logs, { recursive: true });
  fs.writeFileSync(path.join(config.paths.logs, 'report.txt'), report);
  fs.writeFileSync(path.join(config.paths.logs, 'trades.csv'), tradesCsv(result.trades));
  fs.writeFileSync(path.join(config.paths.logs, 'equity.csv'), equityCsv(result));
  fs.writeFileSync(
    path.join(config.paths.logs, 'skipped.csv'),
    ['pair,breakout_time,skip_time,reason', ...result.skipped.map((s) => `${s.pair},${new Date(s.breakoutTime).toISOString()},${new Date(s.time).toISOString()},${s.reason}`)].join('\n')
  );
  console.log('\nالسجلات: logs/report.txt و logs/trades.csv و logs/equity.csv و logs/skipped.csv');
}

const cmd = process.argv[2];
Promise.resolve(cmd === 'fetch-data' ? fetchData() : cmd === 'backtest' ? backtest() : console.log('الأوامر: fetch-data | backtest')).catch((err) => {
  console.error('فشل:', err.message);
  process.exit(1);
});
