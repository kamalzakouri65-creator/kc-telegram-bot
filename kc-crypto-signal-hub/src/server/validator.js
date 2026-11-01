// التحقق من تنبيهات TradingView. TradingView لا يرسل رؤوساً مخصصة، فالسر المشترك يكون داخل نص الرسالة:
//   { "secret": "...", "pair": "BTCUSDT" }
// التنبيه يطلب فقط فحصاً فورياً للزوج. لا يمكنه إنشاء إشارة بنفسه ولا يحمل أي أمر تداول.
const crypto = require('crypto');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function validateAlert(body, { secret, allowedPairs }) {
  if (!secret || secret.length < 16) return { ok: false, status: 503, error: 'webhook غير مُعدّ (WEBHOOK_SECRET قصير أو فارغ)' };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: 400, error: 'صيغة غير صالحة' };
  if (!safeEqual(body.secret ?? '', secret)) return { ok: false, status: 401, error: 'سر غير صحيح' };
  const pair = String(body.pair ?? '').replace('/', '').toUpperCase();
  if (!allowedPairs.includes(pair)) return { ok: false, status: 400, error: `زوج غير مدعوم: ${body.pair}` };
  return { ok: true, status: 202, pair };
}

module.exports = { validateAlert, safeEqual };
