// npm run fetch-data   تحميل 12 شهراً من شموع M1 للذهب (حوالي 75 طلباً، طلب كل 15 ثانية، ويمكن إعادة تشغيله ليكمل من حيث توقف)
// npm run check-data   فحص الجودة: المدة، والفجوات، والتكرار، وشموع الإغلاق، والقفزات
// npm run backtest     الاختبار التاريخي الكامل حسب rules.js، والتقرير في logs/report.txt و logs/trades.csv
const { config } = require('./config');
const data = require('./data');

async function fetchData() {
  console.log(`تحميل ${config.dataSymbol} M1 لآخر ${config.months} شهراً (طلب كل ${config.twelveData.pauseMs / 1000} ثانية حتى لا يتأثر البوت)...`);
  const { candles, reason } = await data.fetchHistory({ onPage: (n, oldest) => console.log(`  ${n} شمعة، الأقدم: ${oldest}`) });
  console.log(`\nانتهى (${reason}): ${candles.length} شمعة من ${candles[0]?.time} إلى ${candles.at(-1)?.time}`);
  console.log('الخطوة التالية: npm run check-data');
}

function checkData() {
  const cs = data.loadCandles();
  if (!cs.length) return console.log('لا توجد بيانات. شغّل أولاً: npm run fetch-data');
  const q = data.checkQuality(cs);
  const first = cs[0].time;
  const last = cs.at(-1).time;
  const days = (Date.parse(last.replace(' ', 'T') + 'Z') - Date.parse(first.replace(' ', 'T') + 'Z')) / 86400000;
  console.log(`فحص بيانات ${config.dataSymbol} M1 (التوقيت UTC)`);
  console.log(`المدة: ${first} → ${last} (حوالي ${(days / 30.4).toFixed(1)} شهراً) | الشموع: ${q.count}`);
  console.log(`المطلوب: ${config.months} شهراً ${days / 30.4 >= config.months - 0.5 ? '✅' : '❌ أقل من المطلوب'}`);
  console.log(`\nمكررة: ${q.duplicates} | داخل أوقات الإغلاق (العطلة والاستراحة اليومية): ${q.inClosedHours} | شموع بلا حركة: ${q.flat} (${((q.flat / q.count) * 100).toFixed(1)}%)`);
  console.log(`دقائق مفقودة في أوقات التداول: ${q.missingInOpenHours} (${((q.missingInOpenHours / (q.count + q.missingInOpenHours)) * 100).toFixed(2)}%) في ${q.gaps.length} فجوة`);
  if (q.gaps.length) console.log('أكبر الفجوات:\n' + q.gaps.slice(0, 5).map((g) => `  بعد ${g.after}: ${g.missing} دقيقة`).join('\n'));
  console.log(`قفزات أكثر من 0.5% بين شمعتين متتاليتين: ${q.jumps.length}`);
  if (q.jumps.length) console.log(q.jumps.slice(0, 5).map((j) => `  ${j.time}: ${j.pct}%`).join('\n'));
  console.log('\nالشموع في كل شهر:');
  console.log(Object.entries(q.months).map(([m, n]) => `  ${m}: ${n}`).join('\n'));
  console.log('\nأرسل هذه النتيجة كاملة. لا تُكتب الاستراتيجية قبل مراجعة الجودة.');
}

function backtest() {
  const fs = require('fs');
  const path = require('path');
  const { findSetups } = require('./strategy');
  const { simulate, nyInfo } = require('./engine');
  const { buildReport, tradesCsv } = require('./report');
  const { COSTS } = require('./rules');
  const raw = data.loadCandles();
  if (!raw.length) return console.log('لا توجد بيانات. شغّل أولاً: npm run fetch-data');
  console.log('جاري الاختبار (قد يأخذ دقيقة أو اثنتين)...');
  const { m1, setups } = findSetups(raw);
  const base = simulate(m1, setups, { mode: 'R' });
  const double = simulate(m1, setups, { mode: 'R', spread: COSTS.spread * 2 });
  const usd = simulate(m1, setups, { mode: 'usd' });
  const days = [...new Set(m1.map((c) => nyInfo(c.ms).date))];
  const { text } = buildReport({ base, double, usd, days, setupsCount: setups.length, dataInfo: `${m1[0].time} → ${m1.at(-1).time} (${m1.length} شمعة في أوقات التداول)` });
  console.log(text);
  fs.mkdirSync(config.paths.logs, { recursive: true });
  fs.writeFileSync(path.join(config.paths.logs, 'report.txt'), text);
  fs.writeFileSync(path.join(config.paths.logs, 'trades.csv'), tradesCsv(base.trades));
  console.log('\nالسجلات: logs/report.txt و logs/trades.csv');
}

const cmd = process.argv[2];
Promise.resolve(cmd === 'fetch-data' ? fetchData() : cmd === 'check-data' ? checkData() : cmd === 'backtest' ? backtest() : console.log('الأوامر: fetch-data | check-data | backtest')).catch((e) => {
  console.error('فشل:', e.message);
  console.error('إذا انقطع التحميل، أعد نفس الأمر وسيكمل من حيث توقف.');
  process.exit(1);
});
