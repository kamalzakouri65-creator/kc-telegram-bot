// node src/main.js fetch-data   تحميل سنتين من شموع QQQ 15 دقيقة (حوالي 3 طلبات)
// node src/main.js backtest     الاختبار التاريخي وكتابة التقرير في logs/
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const data = require('./data');

async function fetchData() {
  const candles = await data.fetchHistory({ onProgress: (n, oldest) => console.log(`${n} شمعة، الأقدم: ${oldest}`) });
  if (!candles.length) throw new Error('لم تصل أي بيانات');
  data.save('qqq-15min', candles);
  data.save('meta', { fetchedAt: new Date().toISOString(), from: candles[0].time, to: candles.at(-1).time, count: candles.length });
  console.log(`تم: ${candles.length} شمعة من ${candles[0].time} إلى ${candles.at(-1).time}`);
}

function backtest() {
  const { runBacktest } = require('./orb');
  const { buildReport, tradesCsv } = require('./report');
  const candles = data.load('qqq-15min');
  if (!candles) {
    console.error('لا توجد بيانات. شغّل أولاً: npm run fetch-data');
    process.exit(1);
  }
  const result = runBacktest(candles);
  const report = buildReport(result, data.load('meta') ?? {});
  console.log(report);
  fs.mkdirSync(config.paths.logs, { recursive: true });
  fs.writeFileSync(path.join(config.paths.logs, 'report.txt'), report);
  fs.writeFileSync(path.join(config.paths.logs, 'trades.csv'), tradesCsv(result.trades));
  console.log('\nالسجلات: logs/report.txt و logs/trades.csv');
}

const cmd = process.argv[2];
Promise.resolve(cmd === 'fetch-data' ? fetchData() : cmd === 'backtest' ? backtest() : console.log('الأوامر: fetch-data | backtest')).catch((err) => {
  console.error('فشل:', err.message);
  process.exit(1);
});
