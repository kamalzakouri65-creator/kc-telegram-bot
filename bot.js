require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('خطأ: يجب تعريف TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID في ملف .env');
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

const testMessage = '📊 GOLD Signal Test\n✅ الاتصال يعمل بنجاح';

bot.sendMessage(TELEGRAM_CHAT_ID, testMessage)
  .then(() => {
    console.log('تم إرسال رسالة الاختبار بنجاح.');
  })
  .catch((error) => {
    console.error('فشل إرسال رسالة الاختبار:', error.message);
    process.exit(1);
  });
