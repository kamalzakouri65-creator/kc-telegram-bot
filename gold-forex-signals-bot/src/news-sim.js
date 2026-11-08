// هل تخسر إشاراتنا أكثر عندما تكون الصفقة مفتوحة وقت خبر كبير؟ npm run news-sim
// تحليل فقط، لا يغيّر شيئاً في البوت. نفس صفقات prop-sim (الإعدادات السبعة، سنتان، بعد السبريد، كل الإشارات).
//
// الأخبار المحسوبة (أوقات نيويورك):
//   NFP (الوظائف الأمريكية) 08:30: أول جمعة في الشهر، وفي يناير الجمعة الثانية.
//     نستثني أكتوبر–ديسمبر 2025 لأن الإغلاق الحكومي أخّر النشر ولا نعرف التواريخ بدقة.
//   قرار الفيدرالي (FOMC) 14:00: من الجدول الرسمي المنشور.
//   CPI غير محسوب: تواريخه تتغير كل شهر، ولا نملك جدولاً موثوقاً.
// قاعدة القرار (مسجلة قبل التشغيل، 2026-11-08): إذا كانت صفقات وقت الأخبار ≥ 30، ومتوسطها أقل من باقي الصفقات
// بـ 0.3R أو أكثر، نضيف تنبيهاً في رسائل الإشارات قبل الأخبار. غير ذلك لا نغيّر شيئاً.
const { buildTrades, maxPerSide } = require('./prop-sim');

const FOMC = [
  '2024-11-07', '2024-12-18',
  '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18', '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10',
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28',
];
const NFP_SKIP = ['2025-10', '2025-11', '2025-12'];

// التوقيت الصيفي الأمريكي: من الأحد الثاني في مارس إلى الأحد الأول في نوفمبر
function nthSunday(year, month, n) {
  const d = new Date(Date.UTC(year, month, 1));
  const first = (7 - d.getUTCDay()) % 7;
  return 1 + first + 7 * (n - 1);
}
function usDst(date) {
  const [y, m, d] = date.split('-').map(Number);
  if (m < 3 || m > 11) return false;
  if (m > 3 && m < 11) return true;
  return m === 3 ? d >= nthSunday(y, 2, 2) : d < nthSunday(y, 10, 1);
}
// وقت نيويورك → UTC بصيغة 'YYYY-MM-DD HH:MM:00'
function nyToUtc(date, hhmm) {
  const [h, mi] = hhmm.split(':').map(Number);
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCMinutes(h * 60 + mi + (usDst(date) ? 4 : 5) * 60);
  return t.toISOString().slice(0, 16).replace('T', ' ') + ':00';
}

function nfpDates(from = '2024-11', to = '2026-10') {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (!NFP_SKIP.includes(key)) {
      const firstDay = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
      const firstFriday = 1 + ((5 - firstDay + 7) % 7);
      const day = m === 1 ? firstFriday + 7 : firstFriday;
      out.push(`${key}-${String(day).padStart(2, '0')}`);
    }
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return out;
}

function events() {
  return [...nfpDates().map((d) => ({ type: 'NFP', at: nyToUtc(d, '08:30') })), ...FOMC.map((d) => ({ type: 'FOMC', at: nyToUtc(d, '14:00') }))];
}

const HOURS = { '1h': 1, '4h': 4 };
const addHours = (time, h) => {
  const t = new Date(time.replace(' ', 'T') + 'Z');
  t.setUTCHours(t.getUTCHours() + h);
  return t.toISOString().slice(0, 19).replace('T', ' ');
};
// تصنيف عادل لا يعتمد على نتيجة الصفقة: هل يقع خبر خلال الـ 24 ساعة بعد الدخول؟
// (التصنيف بـ "مفتوحة وقت الخبر" منحاز: الصفقات الرابحة تبقى مفتوحة أطول، فتلتقي بالأخبار أكثر)
function newsAhead(trade, evs, windowHours = 24) {
  const h = HOURS[trade.interval] ?? 1;
  const from = addHours(trade.time, h);
  const to = addHours(trade.time, h + windowHours);
  return evs.filter((e) => e.at >= from && e.at < to).map((e) => e.type);
}
// دخول خلال الـ 12 ساعة بعد الخبر (حركة ما بعد الخبر)
function newsBehind(trade, evs, windowHours = 12) {
  const h = HOURS[trade.interval] ?? 1;
  const entry = addHours(trade.time, h);
  const from = addHours(trade.time, h - windowHours);
  return evs.filter((e) => e.at >= from && e.at < entry).map((e) => e.type);
}

function stats(trades) {
  const n = trades.length;
  const total = trades.reduce((s, t) => s + t.r, 0);
  const wins = trades.filter((t) => t.r > 0).length;
  const losses = trades.filter((t) => t.r <= -0.99).length;
  return { n, total, avg: n ? total / n : 0, winRate: n ? (wins / n) * 100 : 0, fullLoss: n ? (losses / n) * 100 : 0 };
}

function decide(news, rest) {
  if (news.n < 30) return { warn: false, reason: `صفقات وقت الأخبار ${news.n} فقط (أقل من 30)، لا نستطيع الحكم` };
  const gap = rest.avg - news.avg;
  if (gap >= 0.3) return { warn: true, reason: `متوسط صفقات الأخبار أقل بـ ${gap.toFixed(2)}R: نضيف تنبيهاً قبل الأخبار` };
  return { warn: false, reason: `الفرق ${gap >= 0 ? '−' : '+'}${Math.abs(gap).toFixed(2)}R فقط: الأخبار لا تضر إشاراتنا بشكل واضح، لا نغيّر شيئاً` };
}

module.exports = { nfpDates, nyToUtc, usDst, events, newsAhead, newsBehind, stats, decide, FOMC };

if (require.main === module) {
  const line = (label, s) => `${label}: ${s.n} صفقة | ربح ${s.winRate.toFixed(0)}% | خسارة كاملة ${s.fullLoss.toFixed(0)}% | متوسط ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}R | المجموع ${s.total >= 0 ? '+' : ''}${s.total.toFixed(1)}R`;
  (async () => {
    const { all, span } = await buildTrades();
    const evs = events();
    console.log(`الأخبار وإشاراتنا — ${span}، الإعدادات السبعة، بعد السبريد`);
    console.log(`الأخبار: ${evs.filter((e) => e.type === 'NFP').length} NFP و ${evs.filter((e) => e.type === 'FOMC').length} قرار فيدرالي\n`);
    for (const [title, trades] of [['كل الإشارات', all], ['صفقة واحدة في كل اتجاه', maxPerSide(all, 1)]]) {
      const ahead = trades.filter((t) => newsAhead(t, evs).length);
      const behind = trades.filter((t) => newsBehind(t, evs).length);
      const rest = trades.filter((t) => !newsAhead(t, evs).length && !newsBehind(t, evs).length);
      console.log(`━━ ${title}`);
      console.log(line('  خبر خلال 24 ساعة بعد الدخول', stats(ahead)));
      console.log(line('    منها NFP', stats(ahead.filter((t) => newsAhead(t, evs).includes('NFP')))));
      console.log(line('    منها الفيدرالي', stats(ahead.filter((t) => newsAhead(t, evs).includes('FOMC')))));
      console.log(line('  دخول خلال 12 ساعة بعد خبر', stats(behind)));
      console.log(line('  بعيداً عن الأخبار', stats(rest)));
      const d = decide(stats(ahead), stats(rest));
      console.log(`  ${d.warn ? '⚠️' : '✅'} قبل الأخبار: ${d.reason}`);
      const d2 = decide(stats(behind), stats(rest));
      console.log(`  ${d2.warn ? '⚠️' : '✅'} بعد الأخبار: ${d2.reason}\n`);
    }
    console.log('R = المبلغ الذي تخاطر به في الصفقة. "خسارة كاملة" = الصفقة ضربت الوقف قبل الهدف الأول.');
  })().catch((err) => {
    console.error('فشل:', err.message);
    process.exit(1);
  });
}
