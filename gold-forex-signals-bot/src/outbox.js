// صندوق صادر: الرسائل التي فشل إرسالها (انقطاع الإنترنت أو تعطل خوادم تيليغرام) تُحفظ في ملف
// وتُعاد محاولتها حتى تصل، بنفس الترتيب. الرسالة التي تصل متأخرة تحمل تنبيهاً بمدة التأخير.
const fs = require('fs');
const path = require('path');

const LATE_AFTER_MS = 5 * 60 * 1000;

// أخطاء تيليغرام الدائمة (مثل محادثة غير موجودة) لا فائدة من إعادتها، أما الشبكة و 5xx و 429 فتُعاد
function isRetryable(err) {
  const status = err?.response?.statusCode;
  if (status) return status >= 500 || status === 429;
  return true;
}

function lateNote(createdAt, now) {
  const minutes = Math.round((now - createdAt) / 60000);
  const span = minutes < 60 ? `${minutes} دقيقة` : `${Math.floor(minutes / 60)} ساعة و ${minutes % 60} دقيقة`;
  return `⏰ رسالة متأخرة ${span} بسبب انقطاع الاتصال، تحقق من السعر الحالي قبل أي دخول.\n\n`;
}

function createOutbox(file, sendFn, { now = Date.now } = {}) {
  let queue = [];
  try {
    queue = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // لا يوجد ملف بعد
  }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(queue, null, 2));
  };

  let flushing = null;
  async function drain() {
    while (queue.length) {
      const m = queue[0];
      const late = now() - m.createdAt > LATE_AFTER_MS;
      try {
        await sendFn(m.chatId, late ? lateNote(m.createdAt, now()) + m.text : m.text);
      } catch (err) {
        if (isRetryable(err)) {
          console.error(`فشل الإرسال، سيُعاد لاحقاً (${queue.length} في الانتظار):`, err.message);
          return;
        }
        console.error('فشل الإرسال نهائياً، حُذفت الرسالة:', err.message);
      }
      queue.shift();
      save();
    }
  }
  // محاولة واحدة في كل مرة، حتى لا تُرسل نفس الرسالة مرتين
  const flush = () => (flushing ??= drain().finally(() => (flushing = null)));

  return {
    async send(chatId, text) {
      queue.push({ chatId, text, createdAt: now() });
      save();
      await flush();
      // إذا كانت محاولة سابقة على وشك الانتهاء عند إضافة الرسالة، نحاول مرة أخرى لها
      if (queue.length && !flushing) await flush();
    },
    flush,
    pending: () => queue.length,
  };
}

module.exports = { createOutbox };
