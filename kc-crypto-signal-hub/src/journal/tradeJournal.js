// سجل دائم في ملف JSON: حالة المحرك، والأحداث (إشارات، رفض، صفقات مغلقة)، ومفاتيح الرسائل المرسلة
// (حتى لا تُرسل نفس الرسالة مرتين حتى بعد إعادة التشغيل).
const fs = require('fs');
const path = require('path');

const MAX_EVENTS = 5000;
const MAX_SENT = 2000;

function createJournal(file) {
  let data = { state: null, events: [], sent: [] };
  try {
    data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // لا يوجد سجل بعد
  }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  };

  return {
    getState: () => data.state,
    setState(state) {
      data.state = state;
      save();
    },
    record(event) {
      data.events.push(event);
      if (data.events.length > MAX_EVENTS) data.events.splice(0, data.events.length - MAX_EVENTS);
      save();
    },
    eventsBetween: (from, to) => data.events.filter((e) => e.time >= from && e.time < to),
    wasSent: (key) => data.sent.includes(key),
    markSent(key) {
      data.sent.push(key);
      if (data.sent.length > MAX_SENT) data.sent.splice(0, data.sent.length - MAX_SENT);
      save();
    },
  };
}

module.exports = { createJournal };
