// حدود الدخول: صفقة واحدة مفتوحة، و 3 خسائر متتالية (خروج على الوقف الأصلي) توقف الدخول بقية يوم لندن.
// الخروج على التعادل أو الهدف يُصفّر السلسلة. يوم جديد في لندن يبدأ سلسلة جديدة.
const { londonDay } = require('./time');

function createGate(rules) {
  let busyUntil = -Infinity;
  let streak = 0;
  let streakDay = null;
  return {
    // T = وقت الدخول المقترح (ms). يعيد سبب الرفض أو null
    check(T) {
      if (busyUntil > T) return 'position';
      if (londonDay(T) === streakDay && streak >= rules.maxConsecLossesPerDay) return 'dailyLimit';
      return null;
    },
    onEntry(exitTime) {
      busyUntil = exitTime + 60000; // الصفقة مفتوحة حتى نهاية دقيقة الخروج
    },
    onExit(exitTime, outcome) {
      const day = londonDay(exitTime);
      if (day !== streakDay) {
        streakDay = day;
        streak = 0;
      }
      streak = outcome === 'SL' ? streak + 1 : 0;
    },
    state: () => ({ busyUntil, streak, streakDay }),
  };
}
module.exports = { createGate };
