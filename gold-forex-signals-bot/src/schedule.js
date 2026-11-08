// رسائل مجدولة: "البوت يعمل" كل صباح، وملخص الأسبوع بعد إغلاق السوق يوم الجمعة.
// الأوقات بتوقيت UTC (المغرب = UTC+1). ما أُرسل يُحفظ في ملف حتى لا يتكرر بعد إعادة التشغيل.
const fs = require('fs');
const path = require('path');

const HEARTBEAT_HOUR = 7; // 08:00 بتوقيت المغرب
const WEEKLY = { weekday: 5, hour: 22 }; // الجمعة 22:00 UTC، بعد إغلاق الذهب
const WEEKLY_GRACE_HOURS = 48; // إن كان البوت متوقفاً وقتها، يُرسل الملخص عند التشغيل خلال يومين

const ymd = (d) => d.toISOString().slice(0, 10);

// مفتاح رسالة الصباح لهذا اليوم، أو null قبل الموعد
function heartbeatKey(now) {
  return now.getUTCHours() >= HEARTBEAT_HOUR ? ymd(now) : null;
}

// آخر جمعة 22:00 قبل الآن، إذا لم يمر عليها أكثر من 48 ساعة
function weeklyKey(now) {
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), WEEKLY.hour));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() - WEEKLY.weekday + 7) % 7));
  if (t > now) t.setUTCDate(t.getUTCDate() - 7);
  return now - t <= WEEKLY_GRACE_HOURS * 3600 * 1000 ? ymd(t) : null;
}

function createSchedule(file) {
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // لا يوجد ملف بعد
  }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
  };
  // يُرجع المهام المستحقة الآن ويسجلها حتى لا تتكرر
  return {
    due(now = new Date()) {
      const out = [];
      for (const [name, key] of [['heartbeat', heartbeatKey(now)], ['weekly', weeklyKey(now)]]) {
        if (key && state[name] !== key) {
          state[name] = key;
          out.push({ name, key });
        }
      }
      if (out.length) save();
      return out;
    },
  };
}

module.exports = { createSchedule, heartbeatKey, weeklyKey };
