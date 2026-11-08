// منع تشغيل البوت مرتين (سبب أخطاء 409 في تيليغرام): ملف فيه رقم العملية التي تعمل.
const fs = require('fs');
const path = require('path');

// هل العملية pid ما زالت تعمل وهي البوت نفسه؟
function isBotRunning(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('bot.js');
  } catch {
    return true; // لا نستطيع التأكد، فنعتبرها تعمل احتياطاً
  }
}

function acquireLock(file, pid = process.pid, alive = isBotRunning) {
  let other = null;
  try {
    other = Number(fs.readFileSync(file, 'utf8').trim());
  } catch {
    // لا يوجد ملف
  }
  if (other && other !== pid && alive(other)) return { ok: false, pid: other };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(pid));
  return { ok: true };
}

function releaseLock(file, pid = process.pid) {
  try {
    if (Number(fs.readFileSync(file, 'utf8').trim()) === pid) fs.unlinkSync(file);
  } catch {
    // لا شيء
  }
}

module.exports = { acquireLock, releaseLock, isBotRunning };
