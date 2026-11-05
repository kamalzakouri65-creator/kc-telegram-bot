// node src/main.js fetch-data   تحميل سنتين من شموع الذهب 5 و 15 دقيقة (ببطء، حتى لا يتأثر البوت)
// node src/main.js backtest     الاختبار وكتابة التقرير في logs/
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const data = require('./data');

async function fetchData() {
  for (const interval of [config.pdhl.interval, config.silverBullet.interval]) {
    const name = `XAU-${interval}`;
    if (data.load(name)) {
      console.log(`${name}: موجود من قبل ✓`);
      continue;
    }
    console.log(`جلب الذهب ${interval} (طلب كل 15 ثانية)...`);
    const candles = await data.fetchHistory(interval, { onProgress: (n, oldest) => console.log(`  ${n} شمعة، الأقدم: ${oldest}`) });
    if (candles.length < 1000) throw new Error(`${name}: بيانات قليلة (${candles.length})`);
    data.save(name, candles);
    console.log(`  تم: ${candles.length} شمعة من ${candles[0].time} إلى ${candles.at(-1).time}`);
  }
}

function backtest() {
  const { silverBullet, previousDayLevels } = require('./strategies');
  const { buildReport, tradesCsv } = require('./report');
  const c5 = data.load(`XAU-${config.silverBullet.interval}`);
  const c15 = data.load(`XAU-${config.pdhl.interval}`);
  if (!c5 || !c15) {
    console.error('لا توجد بيانات. شغّل أولاً: npm run fetch-data');
    process.exit(1);
  }
  const days5 = [...new Set(c5.map((c) => c.time.slice(0, 10)))];
  const sb = { trades: silverBullet(c5), days: days5 };
  const pd = previousDayLevels(c15);
  const report = buildReport({ sb, pd });
  console.log(report);
  fs.mkdirSync(config.paths.logs, { recursive: true });
  fs.writeFileSync(path.join(config.paths.logs, 'report.txt'), report);
  fs.writeFileSync(path.join(config.paths.logs, 'silver-bullet.csv'), tradesCsv(sb.trades));
  fs.writeFileSync(path.join(config.paths.logs, 'pdhl.csv'), tradesCsv(pd.trades));
  console.log('\nالسجلات: logs/report.txt و logs/silver-bullet.csv و logs/pdhl.csv');
}

const cmd = process.argv[2];
Promise.resolve(cmd === 'fetch-data' ? fetchData() : cmd === 'backtest' ? backtest() : console.log('الأوامر: fetch-data | backtest')).catch((err) => {
  console.error('فشل:', err.message);
  process.exit(1);
});
