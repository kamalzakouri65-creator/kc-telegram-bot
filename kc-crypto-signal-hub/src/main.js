// نقطة الدخول:
//   node src/main.js fetch-data [أيام]   تحميل البيانات التاريخية من Binance (بيانات عامة فقط)
//   node src/main.js backtest            الاختبار التاريخي على البيانات المحفوظة
//   node src/main.js diagnose            تحليل أسباب الفشل لكل صفقة
//   node src/main.js monitor ...         المراقبة الحية — لا تعمل إلا بموافقتك الصريحة
const fs = require('fs');
const path = require('path');
const { config, loadEnv } = require('./config');

const DAY = 24 * 60 * 60 * 1000;
const TFS = ['1h', '15m', '5m'];

async function fetchData(days) {
  const end = Date.now();
  // 20 يوماً إضافية حتى يكتمل حساب EMA200 على إطار الساعة قبل بداية الفترة
  return fetchRange(end - (days + 20) * DAY, end, config.paths.cache);
}

async function fetchRange(start, end, dir) {
  const { fetchHistory, saveCache } = require('./data/binance');
  for (const pair of Object.keys(config.pairs)) {
    for (const tf of TFS) {
      process.stdout.write(`${pair} ${tf}: `);
      const candles = await fetchHistory(pair, tf, start, end, { onProgress: (n) => process.stdout.write(`\r${pair} ${tf}: ${n} شمعة`) });
      saveCache(pair, tf, candles, dir);
      console.log(`\r${pair} ${tf}: ${candles.length} شمعة ✓          `);
    }
  }
}

function backtest() {
  const { runBacktest } = require('./backtest/engine');
  const { buildReport } = require('./backtest/report');
  const data = loadAllCache();
  const report = buildReport(runBacktest(data, config), config);
  console.log(report);
  fs.mkdirSync(path.join(config.paths.root, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(config.paths.root, 'logs', 'backtest-report.txt'), report);
}

function loadAllCache(dir = config.paths.cache, fetchCmd = 'npm run fetch-data') {
  const { loadCache } = require('./data/binance');
  const data = {};
  for (const pair of Object.keys(config.pairs)) {
    const [h1, m15, m5] = TFS.map((tf) => loadCache(pair, tf, dir));
    if (!h1 || !m15 || !m5) {
      console.error(`لا توجد بيانات محفوظة لـ ${pair}. شغّل أولاً: ${fetchCmd}`);
      process.exit(1);
    }
    data[pair] = { h1, m15, m5 };
  }
  return data;
}

// تشخيص أسباب الفشل: نفس الاختبار التاريخي ثم تحليل كل صفقة، بدون أي تغيير في الاستراتيجية
function diagnoseCmd() {
  const { runBacktest } = require('./backtest/engine');
  const { diagnose, formatDiagnosis } = require('./backtest/diagnose');
  const data = loadAllCache();
  const rows = diagnose(data, runBacktest(data, config), config);
  const text = formatDiagnosis(rows);
  console.log(text);
  fs.mkdirSync(path.join(config.paths.root, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(config.paths.root, 'logs', 'diagnosis.txt'), text);
}

// اختبار الفرضية المسجلة مسبقاً في backtest/oos.js على بيانات لم تُستعمل أبداً
function oosTest() {
  const { runBacktest } = require('./backtest/engine');
  const { computeMetrics } = require('./backtest/metrics');
  const { PREREGISTERED, evaluate } = require('./backtest/oos');
  const data = loadAllCache(config.paths.cacheOos, 'npm run fetch-oos');
  const withFilter = { ...config, strategy: { ...config.strategy, maxRally24hPct: PREREGISTERED.maxRally24hPct } };
  const base = runBacktest(data, config);
  const filtered = runBacktest(data, withFilter);
  const start = config.risk.initialBalance;
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const line = (m) =>
    `الصفقات ${m.totalTrades} | نسبة الربح ${m.winRate.toFixed(1)}% | معامل الربح ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞'} | الصافي ${m.netProfit.toFixed(2)}$ | أطول سلسلة خسائر ${m.longestLosingStreak}`;
  const result = evaluate(base.trades, filtered.trades, start, Object.keys(config.pairs));
  const text = [
    `الفرضية المسجلة في ${PREREGISTERED.registeredOn}: ${PREREGISTERED.hypothesis}`,
    `البيانات: ${day(base.start)} إلى ${day(base.end)} (لم تُستعمل في أي اختبار سابق)`,
    '',
    `بدون الفلتر: ${line(computeMetrics(base.trades, start))}`,
    `مع الفلتر:   ${line(result.filtered)}`,
    '',
    ...result.perPair.flatMap((p) => [`${p.pair} بدون: ${line(p.before)}`, `${p.pair} مع:   ${line(p.after)}`]),
    '',
    'شروط النجاح (مسجلة مسبقاً):',
    ...result.checks.map((c) => `${c.ok ? '✅' : '❌'} ${c.name} ← ${typeof c.value === 'number' ? (Number.isFinite(c.value) ? +c.value.toFixed(2) : '∞') : c.value}`),
    '',
    result.passed ? 'النتيجة: ✅ الفرضية صمدت على البيانات الجديدة' : 'النتيجة: ❌ الفرضية لم تصمد. لا نجرّب رقماً آخر على نفس البيانات.',
  ].join('\n');
  console.log(text);
  fs.mkdirSync(path.join(config.paths.root, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(config.paths.root, 'logs', 'oos-report.txt'), text);
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
  if (cmd === 'diagnose') return diagnoseCmd();
  if (cmd === 'fetch-oos') {
    const { PREREGISTERED } = require('./backtest/oos');
    return fetchRange(PREREGISTERED.from - 20 * DAY, PREREGISTERED.to, config.paths.cacheOos);
  }
  if (cmd === 'oos-test') return oosTest();
  if (cmd === 'monitor') return monitor(args);
  console.log('الأوامر: fetch-data [أيام] | backtest | diagnose | fetch-oos | oos-test | monitor');
}

main().catch((err) => {
  console.error('فشل:', err.message);
  process.exit(1);
});
