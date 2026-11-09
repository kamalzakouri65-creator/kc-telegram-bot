// عرض آخر الشموع كما يراها البوت (للتشخيص): npm run candles -- XAU/USD 1h 15
require('dotenv').config();
const { fetchCandles } = require('./market');

const [symbol = 'XAU/USD', interval = '1h', n = '15'] = process.argv.slice(2);
fetchCandles(symbol, interval, process.env.TWELVE_DATA_API_KEY, 300)
  .then((cs) => {
    console.log(`${symbol} ${interval}: آخر ${n} شمعة (الوقت كما يصل من المصدر)، الآن ${new Date().toISOString().slice(0, 16)} UTC`);
    for (const c of cs.slice(-Number(n))) console.log(`${c.time} | O ${c.open} H ${c.high} L ${c.low} C ${c.close} | المدى ${(c.high - c.low).toFixed(2)}`);
  })
  .catch((e) => console.error('فشل:', e.message));
