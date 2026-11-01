// نقطة الدخول:
//   node src/main.js fetch-data [أيام]   تحميل البيانات التاريخية من Binance (بيانات عامة فقط)
//   node src/main.js backtest            الاختبار التاريخي على البيانات المحفوظة
//   node src/main.js monitor ...         المراقبة الحية — لا تعمل إلا بموافقتك الصريحة
const fs = require('fs');
const path = require('path');
const { config, loadEnv } = require('./config');

const DAY = 24 * 60 * 60 * 1000;
const TFS = ['1h', '15m', '5m'];

async function fetchData(days) {
  const { fetchHistory, saveCache } = require('./data/binance');
  const end = Date.now();
  // 20 يوماً إضافية حتى يكتمل حساب EMA200 على إطار الساعة قبل بداية الفترة
  const start = end - (days + 20) * DAY;
  for (const pair of Object.keys(config.pairs)) {
    for (const tf of TFS) {
      process.stdout.write(`${pair} ${tf}: `);
      const candles = await fetchHistory(pair, tf, start, end, { onProgress: (n) => process.stdout.write(`\r${pair} ${tf}: ${n} شمعة`) });
      saveCache(pair, tf, candles);
      console.log(`\r${pair} ${tf}: ${candles.length} شمعة ✓          `);
    }
  }
}

function backtest() {
  const { loadCache } = require('./data/binance');
  const { runBacktest } = require('./backtest/engine');
  const { buildReport } = require('./backtest/report');
  const data = {};
  for (const pair of Object.keys(config.pairs)) {
    const [h1, m15, m5] = TFS.map((tf) => loadCache(pair, tf));
    if (!h1 || !m15 || !m5) {
      console.error(`لا توجد بيانات محفوظة لـ ${pair}. شغّل أولاً: npm run fetch-data`);
      process.exit(1);
    }
    data[pair] = { h1, m15, m5 };
  }
  const report = buildReport(runBacktest(data, config), config);
  console.log(report);
  fs.mkdirSync(path.join(config.paths.root, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(config.paths.root, 'logs', 'backtest-report.txt'), report);
}

async function monitor(args) {
  const env = { ...loadEnv(), ...process.env };
  if (env.LIVE_MONITORING_APPROVED !== 'yes' || !args.includes('--i-approve-live-monitoring')) {
    console.error('⛔ المراقبة الحية متوقفة. لتشغيلها يجب أن تضع LIVE_MONITORING_APPROVED=yes في .env وأن تضيف --i-approve-live-monitoring');
    process.exit(1);
  }
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.error('خطأ: TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID مطلوبان في .env');
    process.exit(1);
  }
  const { createJournal } = require('./journal/tradeJournal');
  const { createTelegramSender, createNotifier } = require('./notifications/telegram');
  const { createMonitor } = require('./monitor');
  const journal = createJournal(config.paths.journal);
  const notify = createNotifier({ send: createTelegramSender({ token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID }), journal });
  const mon = createMonitor({ cfg: config, journal, notify });

  const portArg = args.find((a) => a.startsWith('--webhook-port='));
  if (portArg) {
    const { createWebhookServer } = require('./server/webhook');
    const port = Number(portArg.split('=')[1]);
    createWebhookServer({ secret: env.WEBHOOK_SECRET, allowedPairs: Object.keys(config.pairs), onAlert: () => mon.tick() }).listen(port, () =>
      console.log(`webhook على المنفذ ${port}`)
    );
  }
  console.log('المراقبة الحية تعمل (إشارات فقط، بدون أي تنفيذ).');
  await mon.tick();
  setInterval(() => mon.tick(), 60 * 1000);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'fetch-data') return fetchData(Number(args[0]) || config.backtest.defaultDays);
  if (cmd === 'backtest') return backtest();
  if (cmd === 'monitor') return monitor(args);
  console.log('الأوامر: fetch-data [أيام] | backtest | monitor');
}

main().catch((err) => {
  console.error('فشل:', err.message);
  process.exit(1);
});
