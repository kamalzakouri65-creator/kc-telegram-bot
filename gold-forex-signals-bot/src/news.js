// تقويم الأخبار الاقتصادية القوية للدولار (للمعلومة فقط): لا يمنع ولا يغيّر أي إشارة.
// المصدر: تقويم ForexFactory الأسبوعي (ملف JSON عام ومجاني، غير رسمي وقد يتغير). نطلبه مرة كل 6 ساعات فقط.
const fs = require('fs');
const path = require('path');

const URL_THIS_WEEK = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const REFRESH_MS = 6 * 3600 * 1000;
const RETRY_MS = 3600 * 1000; // بعد فشل: محاولة جديدة بعد ساعة
const REMIND_BEFORE_MS = 30 * 60 * 1000;
const SIGNAL_WINDOW_MS = 24 * 3600 * 1000;

// أخبار الدولار القوية فقط، مرتبة بالوقت
function parseCalendar(rows) {
  if (!Array.isArray(rows)) throw new Error('رد غير متوقع من تقويم الأخبار');
  return rows
    .filter((r) => r && r.country === 'USD' && r.impact === 'High')
    .map((r) => ({ title: String(r.title), ms: Date.parse(r.date), forecast: r.forecast || '', previous: r.previous || '' }))
    .filter((e) => Number.isFinite(e.ms))
    .sort((a, b) => a.ms - b.ms);
}

// الوقت بتوقيت المغرب (Africa/Casablanca)، وإن لم يدعمه الجهاز: UTC+1
function moroccoParts(ms) {
  try {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
    const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, weekday: p.weekday };
  } catch {
    const d = new Date(ms + 3600 * 1000);
    return { day: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] };
  }
}
const DAYS_AR = { Sun: 'الأحد', Mon: 'الإثنين', Tue: 'الثلاثاء', Wed: 'الأربعاء', Thu: 'الخميس', Fri: 'الجمعة', Sat: 'السبت' };
const extra = (e) => [e.forecast && `المتوقع ${e.forecast}`, e.previous && `السابق ${e.previous}`].filter(Boolean).join('، ');
const line = (e, withDay = false) => {
  const t = moroccoParts(e.ms);
  return `• ${withDay ? `${DAYS_AR[t.weekday] ?? t.weekday} ` : ''}${t.hm} — ${e.title}${extra(e) ? ` (${extra(e)})` : ''}`;
};
const NOTE = 'الأوقات بتوقيت المغرب. للمعلومة فقط: لا يغيّر أي إشارة.';

function formatToday(events, now = Date.now()) {
  const today = moroccoParts(now).day;
  const list = events.filter((e) => moroccoParts(e.ms).day === today);
  if (!list.length) return '📰 لا توجد أخبار قوية للدولار اليوم.';
  return ['📰 أخبار الدولار القوية اليوم:', ...list.map((e) => line(e)), NOTE].join('\n');
}

function formatWeek(events, now = Date.now()) {
  const list = events.filter((e) => e.ms >= now - 3600 * 1000);
  if (!list.length) return '📰 لا توجد أخبار قوية للدولار متبقية هذا الأسبوع.';
  return ['📰 أخبار الدولار القوية المتبقية هذا الأسبوع:', ...list.map((e) => line(e, true)), NOTE].join('\n');
}

function formatReminder(e) {
  return `⏰ بعد 30 دقيقة تقريباً: ${e.title} (${moroccoParts(e.ms).hm} بتوقيت المغرب)${extra(e) ? `\n${extra(e)}` : ''}\nالسعر قد يتحرك بقوة. ${NOTE.split('. ')[1]}`;
}

// سطر يُضاف للإشارة إذا كان هناك خبر قوي خلال 24 ساعة
function signalNote(events, now = Date.now()) {
  const soon = events.filter((e) => e.ms > now && e.ms - now <= SIGNAL_WINDOW_MS);
  if (!soon.length) return '';
  return `⚠️ خبر قوي خلال 24 ساعة: ${soon.slice(0, 3).map((e) => `${e.title} ${moroccoParts(e.ms).hm}`).join('، ')} (بتوقيت المغرب)`;
}

function createNews(file, { fetchFn = defaultFetch } = {}) {
  let state = { events: [], fetchedAt: 0, failedAt: 0, reminded: [], warnedDay: null };
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // لا يوجد ملف بعد
  }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
  };
  return {
    events: () => state.events,
    // يجلب التقويم عند الحاجة فقط. يُرجع رسالة تحذير مرة واحدة في اليوم إذا تعطل المصدر
    async refresh(now = Date.now()) {
      const due = now - state.fetchedAt >= REFRESH_MS && now - state.failedAt >= RETRY_MS;
      if (!due) return null;
      try {
        state.events = parseCalendar(await fetchFn(URL_THIS_WEEK));
        state.fetchedAt = now;
        state.failedAt = 0;
        save();
        return null;
      } catch (err) {
        state.failedAt = now;
        const day = moroccoParts(now).day;
        const warn = state.warnedDay !== day;
        state.warnedDay = day;
        save();
        console.error('تقويم الأخبار:', err.message);
        return warn ? `⚠️ تعذّر جلب تقويم الأخبار (${err.message}). البوت والإشارات تعمل عادياً.` : null;
      }
    },
    // الأخبار التي حان تذكيرها (قبل 30 دقيقة)، كل خبر مرة واحدة فقط
    dueReminders(now = Date.now()) {
      const out = state.events.filter((e) => {
        const key = `${e.ms}|${e.title}`;
        // قبل الخبر بـ 30 دقيقة أو أقل، ولم يحن وقته بعد (خبر فات لا نذكّر به)
        return e.ms > now && e.ms - now <= REMIND_BEFORE_MS && !state.reminded.includes(key);
      });
      if (out.length) {
        state.reminded = [...state.reminded, ...out.map((e) => `${e.ms}|${e.title}`)].slice(-200);
        save();
      }
      return out;
    },
  };
}

async function defaultFetch(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('المصدر لم يُرجع بيانات صالحة');
  }
}

module.exports = { createNews, parseCalendar, formatToday, formatWeek, formatReminder, signalNote, moroccoParts };
