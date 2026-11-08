require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { fetchCandles } = require('./market');
const { snapshot } = require('./strategy');
const { STRATEGIES } = require('./strategies');
const path = require('path');
const { formatSignal, formatSnapshot, formatTradeEvent, formatResults, formatOverlapNote } = require('./format');
const { createTracker } = require('./tracker');
const { createOutbox } = require('./outbox');
const { createTrader } = require('./trader');
const { parseSymbolMap } = require('./risk');
const { parseDisabled, isEnabled, describe, DEFAULT_DISABLED } = require('./setups');
const { cryptoMarkets, marketSignals, DEFAULT_CRYPTO } = require('./crypto');
const { isCrypto } = require('./binance');

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TWELVE_DATA_API_KEY,
  SYMBOLS = 'XAU/USD,EUR/USD,GBP/USD,USD/JPY',
  INTERVAL = '1h',
  CHECK_EVERY_MINUTES = '15',
  STRATEGY = 'ema-macd',
  METAAPI_TOKEN,
  METAAPI_ACCOUNT_ID,
  METAAPI_REGION = 'new-york',
  MT_SYMBOL_SUFFIX = '',
  MT_SYMBOL_MAP = '',
  AUTO_TRADE = 'false',
  RISK_PERCENT = '1',
  MAX_OPEN_POSITIONS = '3',
  ALLOW_REAL_TRADING = 'false',
  MAX_LOSS_USD = '3',
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !TWELVE_DATA_API_KEY) {
  console.error('خطأ: يجب تعريف TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID و TWELVE_DATA_API_KEY في ملف .env');
  process.exit(1);
}

const list = (text) => text.split(',').map((s) => s.trim()).filter(Boolean);

// يمكن تشغيل أكثر من استراتيجية معاً، مثل STRATEGY=ema-macd,pullback
const strategyKeys = list(STRATEGY);
const unknown = strategyKeys.filter((key) => !STRATEGIES[key]);
if (strategyKeys.length === 0 || unknown.length) {
  console.error(`خطأ: STRATEGY يجب أن تكون من: ${Object.keys(STRATEGIES).join(', ')}`);
  process.exit(1);
}
// إعدادات موقوفة (زوج + إطار + استراتيجية). الافتراضي: الفضة 1h Pullback
const { set: disabled, invalid: badSetups } = parseDisabled(process.env.DISABLED_SETUPS ?? DEFAULT_DISABLED);
if (badSetups.length) {
  console.error(`خطأ: DISABLED_SETUPS غير صحيح: ${badSetups.join(', ')} (الصيغة: XAG/USD:1h:pullback)`);
  process.exit(1);
}
const symbols = list(SYMBOLS);
// يمكن مراقبة أكثر من إطار، مثل INTERVAL=1h,4h
const intervals = list(INTERVAL);
const forexMarkets = symbols.flatMap((symbol) => intervals.map((interval) => ({ symbol, interval, strategies: strategyKeys, longOnly: false })));
// العملات الرقمية: EMA + MACD يومي، شراء فقط. لإيقافها: CRYPTO_SYMBOLS= في .env
const crypto = cryptoMarkets(process.env.CRYPTO_SYMBOLS ?? DEFAULT_CRYPTO);
const markets = [...forexMarkets, ...crypto];
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

// كل إشارة أُرسلت تُحفظ وتُتابع حتى تصل للهدف أو الوقف، ويمنع ذلك تكرار نفس الإشارة
const tracker = createTracker(path.join(__dirname, '..', 'data', 'trades.json'));

// الخطة المجانية تسمح بـ 8 طلبات في الدقيقة، فننتظر بين الرموز
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// يُرجع الإشارات الجديدة، ونتائج الإشارات السابقة (هدف أو وقف) من نفس الشموع
async function scan({ force = false } = {}) {
  const found = [];
  const results = [];
  for (const market of markets) {
    const { symbol, interval } = market;
    try {
      const candles = await fetchCandles(symbol, interval, TWELVE_DATA_API_KEY);
      results.push(...tracker.update(symbol, interval, candles));
      for (const { key, signal } of marketSignals(market, candles, (s, i, k) => isEnabled(disabled, s, i, k))) {
        const isNew = !tracker.has(symbol, interval, signal, key);
        // صفقة مفتوحة أخرى بنفس الاتجاه (من استراتيجية أو إطار آخر) تعني مضاعفة المخاطرة إن دخلت الاثنتين
        const same = isNew ? tracker.openSameSide(symbol, signal.side) : [];
        if (isNew) tracker.add(symbol, interval, signal, key);
        if (!force && !isNew) continue;
        let text = formatSignal(symbol, interval, signal, strategyKeys.length > 1 || market.longOnly ? key : undefined, { maxLossUsd: Number(MAX_LOSS_USD) });
        if (same.length) text += `\n\n${formatOverlapNote(same[0])}`;
        found.push({ symbol, signal, text });
      }
    } catch (err) {
      console.error(`فشل تحليل ${symbol} ${interval}:`, err.message);
    }
    // حد Twelve Data: 8 طلبات في الدقيقة. Binance لا يحتاج انتظاراً
    if (!isCrypto(symbol)) await sleep(8000);
  }
  return { found, results };
}

// الرسائل التي لا تصل بسبب انقطاع الاتصال تُحفظ وتُعاد كل دقيقة حتى تصل
const outbox = createOutbox(path.join(__dirname, '..', 'data', 'outbox.json'), (chatId, text) =>
  bot.sendMessage(chatId, text)
);
const send = (chatId, text) => outbox.send(chatId, text);
setInterval(() => outbox.flush(), 60 * 1000);

async function scheduledScan() {
  const { found, results } = await scan();
  for (const r of results) await send(TELEGRAM_CHAT_ID, formatTradeEvent(r));
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
      `أراقب: ${symbols.join(', ')} على إطار ${intervals.join(' و ')}، كل ${CHECK_EVERY_MINUTES} دقيقة.`,
      `الاستراتيجية: ${strategyKeys.map((key) => STRATEGIES[key].label).join(' و ')}`,
      ...(disabled.size ? [`⏸️ موقوف: ${describe(disabled).join('، ')}`] : []),
      ...(crypto.length ? [`🪙 عملات رقمية (يومي، EMA + MACD، شراء فقط، متابعة): ${crypto.map((m) => m.symbol).join(', ')}`] : []),
      '',
      'الأوامر:',
      '/status — حالة السوق الآن',
      '/signal — فحص فوري للإشارات',
      '/results — نتائج الإشارات السابقة (رابحة أو خاسرة)',
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
  for (const { symbol, interval } of markets) {
    const label = intervals.length > 1 || isCrypto(symbol) ? `${symbol} ${interval === '1day' ? 'يومي' : interval}` : symbol;
    try {
      const s = snapshot(await fetchCandles(symbol, interval, TWELVE_DATA_API_KEY));
      lines.push(s ? formatSnapshot(label, s) : `• ${label}: بيانات غير كافية`);
    } catch (err) {
      lines.push(`• ${label}: خطأ (${err.message})`);
    }
    if (!isCrypto(symbol)) await sleep(8000);
  }
  bot.sendMessage(msg.chat.id, `📈 حالة السوق\n\n${lines.join('\n')}`);
});

bot.onText(/^\/signal/, async (msg) => {
  await bot.sendMessage(msg.chat.id, '🔎 جاري الفحص...');
  const { found, results } = await scan({ force: true });
  for (const r of results) await send(msg.chat.id, formatTradeEvent(r));
  if (found.length === 0) {
    bot.sendMessage(msg.chat.id, 'لا توجد إشارة حالياً. الشروط غير مكتملة على أي زوج.');
    return;
  }
  // الفحص اليدوي يعرض الإشارات فقط ولا يفتح صفقات، حتى لا تتكرر الصفقة نفسها
  for (const { text } of found) await bot.sendMessage(msg.chat.id, text);
});

bot.onText(/^\/results/, (msg) => send(msg.chat.id, formatResults(tracker.summary())));

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
