require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { fetchCandles } = require('./market');
const { analyze, snapshot } = require('./strategy');
const { formatSignal, formatSnapshot } = require('./format');

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TWELVE_DATA_API_KEY,
  SYMBOLS = 'XAU/USD,EUR/USD,GBP/USD,USD/JPY',
  INTERVAL = '1h',
  CHECK_EVERY_MINUTES = '15',
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !TWELVE_DATA_API_KEY) {
  console.error('خطأ: يجب تعريف TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID و TWELVE_DATA_API_KEY في ملف .env');
  process.exit(1);
}

const symbols = SYMBOLS.split(',').map((s) => s.trim()).filter(Boolean);
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

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
          found.push(formatSignal(symbol, INTERVAL, signal));
        }
      }
    } catch (err) {
      console.error(`فشل تحليل ${symbol}:`, err.message);
    }
    await sleep(8000);
  }
  return found;
}

async function scheduledScan() {
  const messages = await scan();
  for (const msg of messages) {
    await bot.sendMessage(TELEGRAM_CHAT_ID, msg).catch((e) => console.error('فشل الإرسال:', e.message));
  }
  console.log(`[${new Date().toISOString()}] فحص مكتمل، إشارات جديدة: ${messages.length}`);
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
  const messages = await scan({ force: true });
  if (messages.length === 0) {
    bot.sendMessage(msg.chat.id, 'لا توجد إشارة حالياً. الشروط غير مكتملة على أي زوج.');
    return;
  }
  for (const m of messages) await bot.sendMessage(msg.chat.id, m);
});

bot.on('polling_error', (err) => console.error('خطأ في الاتصال بتيليغرام:', err.message));

console.log('البوت يعمل...');
scheduledScan();
setInterval(scheduledScan, Number(CHECK_EVERY_MINUTES) * 60 * 1000);
