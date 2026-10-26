require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { fetchCandles } = require('./market');
const { analyze, snapshot } = require('./strategy');
const { formatSignal, formatSnapshot } = require('./format');
const { createTrader } = require('./trader');
const { parseSymbolMap } = require('./risk');

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TWELVE_DATA_API_KEY,
  SYMBOLS = 'XAU/USD,EUR/USD,GBP/USD,USD/JPY',
  INTERVAL = '1h',
  CHECK_EVERY_MINUTES = '15',
  METAAPI_TOKEN,
  METAAPI_ACCOUNT_ID,
  METAAPI_REGION = 'new-york',
  MT_SYMBOL_SUFFIX = '',
  MT_SYMBOL_MAP = '',
  AUTO_TRADE = 'false',
  RISK_PERCENT = '1',
  MAX_OPEN_POSITIONS = '3',
  ALLOW_REAL_TRADING = 'false',
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !TWELVE_DATA_API_KEY) {
  console.error('خطأ: يجب تعريف TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID و TWELVE_DATA_API_KEY في ملف .env');
  process.exit(1);
}

const symbols = SYMBOLS.split(',').map((s) => s.trim()).filter(Boolean);
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// التداول الآلي اختياري: يعمل فقط إذا عُرّفت بيانات MetaApi
const trader =
  METAAPI_TOKEN && METAAPI_ACCOUNT_ID
    ? createTrader({
        token: METAAPI_TOKEN,
        accountId: METAAPI_ACCOUNT_ID,
        region: METAAPI_REGION,
        symbolSuffix: MT_SYMBOL_SUFFIX,
        symbolMap: parseSymbolMap(MT_SYMBOL_MAP),
        riskPercent: Number(RISK_PERCENT),
        maxOpenPositions: Number(MAX_OPEN_POSITIONS),
        allowReal: ALLOW_REAL_TRADING === 'true',
      })
    : null;
let autoTrade = Boolean(trader) && AUTO_TRADE === 'true';

// أوامر التداول مسموحة لصاحب البوت فقط
const isOwner = (msg) => String(msg.chat.id) === String(TELEGRAM_CHAT_ID);

// آخر إشارة أُرسلت لكل رمز، حتى لا تتكرر نفس الإشارة على نفس الشمعة
const lastSent = new Map();

// الخطة المجانية تسمح بـ 8 طلبات في الدقيقة، فننتظر بين الرموز
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scan({ force = false } = {}) {
  const found = [];
  for (const symbol of symbols) {
    try {
      const candles = await fetchCandles(symbol, INTERVAL, TWELVE_DATA_API_KEY);
      const signal = analyze(candles);
      if (signal) {
        const key = `${signal.side}@${signal.time}`;
        if (force || lastSent.get(symbol) !== key) {
          lastSent.set(symbol, key);
          found.push({ symbol, signal, text: formatSignal(symbol, INTERVAL, signal) });
        }
      }
    } catch (err) {
      console.error(`فشل تحليل ${symbol}:`, err.message);
    }
    await sleep(8000);
  }
  return found;
}

const send = (chatId, text) =>
  bot.sendMessage(chatId, text).catch((e) => console.error('فشل الإرسال:', e.message));

async function scheduledScan() {
  const found = await scan();
  for (const { symbol, signal, text } of found) {
    await send(TELEGRAM_CHAT_ID, text);
    if (autoTrade) {
      const report = await trader.execute(symbol, signal).catch((e) => `❌ فشل التنفيذ الآلي لـ ${symbol}: ${e.message}`);
      await send(TELEGRAM_CHAT_ID, report);
    }
  }
  console.log(`[${new Date().toISOString()}] فحص مكتمل، إشارات جديدة: ${found.length}`);
}

bot.onText(/^\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    [
      '👋 أهلاً! أنا بوت إشارات الذهب والفوركس.',
      `أراقب: ${symbols.join(', ')} على إطار ${INTERVAL}، كل ${CHECK_EVERY_MINUTES} دقيقة.`,
      '',
      'الأوامر:',
      '/status — حالة السوق الآن',
      '/signal — فحص فوري للإشارات',
      '/account — الرصيد والصفقات المفتوحة في MT5',
      '/autotrade on|off — تشغيل أو إيقاف التداول الآلي',
      '',
      trader ? `🤖 التداول الآلي: ${autoTrade ? 'يعمل' : 'متوقف'}` : '🤖 التداول الآلي غير مُعدّ (أضف بيانات MetaApi في .env)',
    ].join('\n')
  );
});

bot.onText(/^\/status/, async (msg) => {
  await bot.sendMessage(msg.chat.id, '⏳ جاري جلب البيانات...');
  const lines = [];
  for (const symbol of symbols) {
    try {
      const s = snapshot(await fetchCandles(symbol, INTERVAL, TWELVE_DATA_API_KEY));
      lines.push(s ? formatSnapshot(symbol, s) : `• ${symbol}: بيانات غير كافية`);
    } catch (err) {
      lines.push(`• ${symbol}: خطأ (${err.message})`);
    }
    await sleep(8000);
  }
  bot.sendMessage(msg.chat.id, `📈 حالة السوق (${INTERVAL})\n\n${lines.join('\n')}`);
});

bot.onText(/^\/signal/, async (msg) => {
  await bot.sendMessage(msg.chat.id, '🔎 جاري الفحص...');
  const found = await scan({ force: true });
  if (found.length === 0) {
    bot.sendMessage(msg.chat.id, 'لا توجد إشارة حالياً. الشروط غير مكتملة على أي زوج.');
    return;
  }
  // الفحص اليدوي يعرض الإشارات فقط ولا يفتح صفقات، حتى لا تتكرر الصفقة نفسها
  for (const { text } of found) await bot.sendMessage(msg.chat.id, text);
});

bot.onText(/^\/account/, async (msg) => {
  if (!isOwner(msg)) return;
  if (!trader) return send(msg.chat.id, 'التداول الآلي غير مُعدّ. أضف METAAPI_TOKEN و METAAPI_ACCOUNT_ID في .env');
  const text = await trader.summary().catch((e) => `❌ ${e.message}`);
  send(msg.chat.id, text);
});

bot.onText(/^\/autotrade(?:\s+(on|off))?/, (msg, match) => {
  if (!isOwner(msg)) return;
  if (!trader) return send(msg.chat.id, 'التداول الآلي غير مُعدّ. أضف METAAPI_TOKEN و METAAPI_ACCOUNT_ID في .env');
  if (match[1]) autoTrade = match[1] === 'on';
  send(
    msg.chat.id,
    `🤖 التداول الآلي: ${autoTrade ? 'يعمل ✅' : 'متوقف ⏸️'}\nالمخاطرة لكل صفقة: ${RISK_PERCENT}% | أقصى صفقات مفتوحة: ${MAX_OPEN_POSITIONS}`
  );
});

bot.on('polling_error', (err) => console.error('خطأ في الاتصال بتيليغرام:', err.message));

console.log('البوت يعمل...');
scheduledScan();
setInterval(scheduledScan, Number(CHECK_EVERY_MINUTES) * 60 * 1000);
