// حدود المخاطرة اليومية (بتوقيت UTC):
//   - حد الخسارة اليومي (1% من رصيد بداية اليوم)
//   - صفقتان كحد أقصى في اليوم
//   - التوقف بقية اليوم بعد خسارتين متتاليتين
//   - إشارة نشطة واحدة فقط في نفس الوقت
// نسبة المخاطرة ثابتة ولا ترتفع أبداً بعد الخسائر. الحالة كائن JSON عادي حتى تُحفظ بين التشغيلات.

const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

function createRiskState(balance) {
  return { balance, day: null, dayStartBalance: balance, tradesToday: 0, lossToday: 0, consecutiveLosses: 0, activeId: null };
}

// يبدأ يوماً جديداً إذا تغير التاريخ، ويُرجع اليوم السابق إن انتهى (للملخص اليومي)
function rollDay(state, t) {
  const day = dayOf(t);
  if (state.day === day) return null;
  const finished = state.day;
  Object.assign(state, { day, dayStartBalance: state.balance, tradesToday: 0, lossToday: 0, consecutiveLosses: 0 });
  return finished;
}

function canOpen(state, risk) {
  const reasons = [];
  if (state.activeId) reasons.push('توجد إشارة نشطة بالفعل (إشارة واحدة فقط في نفس الوقت)');
  if (state.tradesToday >= risk.maxTradesPerDay) reasons.push(`تم الوصول للحد اليومي (${risk.maxTradesPerDay} صفقات)`);
  if (state.lossToday >= state.dayStartBalance * (risk.dailyLossPct / 100) - 1e-9) {
    reasons.push(`تم الوصول لحد الخسارة اليومي (${risk.dailyLossPct}%)`);
  }
  if (state.consecutiveLosses >= risk.maxConsecutiveLosses) reasons.push(`${risk.maxConsecutiveLosses} خسائر متتالية: توقف حتى الغد`);
  return { ok: reasons.length === 0, reasons };
}

function onOpened(state, id) {
  state.activeId = id;
  state.tradesToday += 1;
}

// إشارة لم تُنفّذ (السعر ابتعد عن منطقة الدخول): تُحرر دون أن تُحسب صفقة
function onCancelled(state) {
  state.activeId = null;
  state.tradesToday = Math.max(0, state.tradesToday - 1);
}

function onClosed(state, pnl) {
  state.activeId = null;
  state.balance += pnl;
  if (pnl < 0) {
    state.lossToday += -pnl;
    state.consecutiveLosses += 1;
  } else {
    state.consecutiveLosses = 0;
  }
}

module.exports = { createRiskState, rollDay, canOpen, onOpened, onCancelled, onClosed, dayOf };
