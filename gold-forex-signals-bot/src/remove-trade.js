// حذف إشارة من النتائج (مثل إشارة خرجت من بيانات خاطئة): npm run remove-trade -- "XAU/USD|1h|BUY@2026-11-09 09:00:00|pullback"
// بدون معرّف: يعرض كل الإشارات بمعرّفاتها. يحفظ نسخة احتياطية قبل الحذف.
// ⚠️ أوقف البوت أولاً (CTRL + c)، وإلا قد يكتب فوق الملف بالنسخة القديمة.
const fs = require('fs');
const path = require('path');

function removeTrade(file, id) {
  const trades = JSON.parse(fs.readFileSync(file, 'utf8'));
  const kept = trades.filter((t) => t.id !== id);
  if (kept.length === trades.length) return { removed: 0, total: trades.length };
  fs.copyFileSync(file, `${file}.bak`);
  fs.writeFileSync(file, JSON.stringify(kept, null, 2));
  return { removed: trades.length - kept.length, total: kept.length };
}

module.exports = { removeTrade };

if (require.main === module) {
  const file = path.join(__dirname, '..', 'data', 'trades.json');
  const lockFile = path.join(__dirname, '..', 'data', 'bot.pid');
  const { isBotRunning } = require('./lock');
  let pid = null;
  try {
    pid = Number(fs.readFileSync(lockFile, 'utf8'));
  } catch {
    // لا يوجد قفل
  }
  if (pid && isBotRunning(pid)) {
    console.error('⛔ البوت يعمل الآن. أوقفه أولاً بـ CTRL + c في نافذته، ثم أعد هذا الأمر.');
    process.exit(1);
  }
  const id = process.argv[2];
  if (!id) {
    for (const t of JSON.parse(fs.readFileSync(file, 'utf8'))) console.log(`${t.closed ? (t.r > 0 ? '✅' : '❌') : '⏳'} ${t.id}`);
    process.exit(0);
  }
  const r = removeTrade(file, id);
  console.log(r.removed ? `✅ حُذفت الإشارة. الباقي: ${r.total}. نسخة احتياطية: data/trades.json.bak` : `لم أجد إشارة بهذا المعرّف: ${id}`);
}
