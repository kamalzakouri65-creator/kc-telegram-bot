// سيناريو اصطناعي: مقاومة بلمستين على H1 ثم اختراق بحجم كبير ثم إعادة اختبار على M15 وتأكيد ودخول وهدف.
// الشموع تُبنى على M15 وتُجمّع إلى H1 حتى يكون الإطاران متسقين كالبيانات الحقيقية.
const M15 = 15 * 60 * 1000;
const H1 = 60 * 60 * 1000;
const START = Date.UTC(2026, 0, 5);
const B = 20;

// شمعة H1 = 4 شموع M15 بنفس القمة والقاع والحجم الكلي
function splitH1([o, h, l, c, v]) {
  const path = c >= o ? [o, l, (l + h) / 2, h, c] : [o, h, (h + l) / 2, l, c];
  return [0, 1, 2, 3].map((k) => {
    const a = path[k];
    const b = path[k + 1];
    return [a, Math.max(a, b), Math.min(a, b), b, v / 4];
  });
}

function aggregate(m15) {
  const out = [];
  for (const c of m15) {
    const openTime = Math.floor(c.openTime / H1) * H1;
    const last = out.at(-1);
    if (last && last.openTime === openTime) {
      Object.assign(last, { high: Math.max(last.high, c.high), low: Math.min(last.low, c.low), close: c.close, volume: last.volume + c.volume });
    } else out.push({ ...c, openTime, closeTime: openTime + H1 - 1 });
  }
  return out;
}

const r = (o, h, l, c, v = 100) => [B + o, B + h, B + l, B + c, v];

function buildScenario({ breakoutVolume = 300, secondTouch = true, retest, after } = {}) {
  const h1Bars = [];
  // خلفية هادئة لحساب ATR ومتوسط الحجم
  for (let i = 0; i < 30; i++) h1Bars.push(i % 2 ? r(0, 0.6, -0.4, 0.2) : r(0.2, 0.5, -0.5, 0));
  // صعود إلى اللمسة الأولى (قمة 5.0)
  h1Bars.push(r(0, 1.2, -0.1, 1), r(1, 2.3, 0.9, 2.2), r(2.2, 3.6, 2.1, 3.5), r(3.5, 5.0, 3.4, 4.5), r(4.5, 4.7, 3.6, 3.8), r(3.8, 4.0, 2.9, 3.0));
  // ابتعاد إلى 3.0 ثم اللمسة الثانية (قمة 5.1، أو 4.3 بدون لمسة ثانية)
  const t2 = secondTouch ? 5.1 : 4.3;
  h1Bars.push(r(3.0, 3.6, 2.8, 3.5), r(3.5, 4.4, 3.4, 4.3), r(4.3, t2, 4.2, 4.6), r(4.6, 4.8, 3.9, 4.0), r(4.0, 4.2, 3.4, 3.6), r(3.6, 4.0, 3.5, 3.9));
  // شمعة الاختراق: جسم كبير وحجم كبير
  h1Bars.push(r(4.4, 6.1, 4.35, 6.0, breakoutVolume));

  const rows = h1Bars.flatMap(splitH1);
  const breakoutIndex = rows.length - 1;
  // إعادة الاختبار على M15: لمس المنطقة (الحد العلوي ~5.17) ثم قاع مؤكد ثم شمعة تأكيد ثم اختراق قمتها
  rows.push(
    ...(retest ?? [
      r(6.0, 6.2, 5.6, 5.7),
      r(5.7, 5.8, 5.1, 5.3), // لمس المنطقة: هذا هو القاع
      r(5.3, 5.45, 5.2, 5.25),
      r(5.25, 5.4, 5.22, 5.3), // القاع أصبح مؤكداً
      r(5.3, 5.8, 5.28, 5.75), // شمعة التأكيد
      r(5.75, 6.0, 5.7, 5.95), // اختراق قمة التأكيد = الدخول
    ]),
    ...(after ?? [r(5.95, 6.6, 5.9, 6.5), r(6.5, 7.2, 6.4, 7.1), r(7.1, 7.9, 7.0, 7.8), r(7.8, 8.0, 7.6, 7.9)])
  );
  // إكمال آخر ساعة حتى تكون شموع H1 كاملة
  while (rows.length % 4) rows.push(r(7.9, 8.0, 7.8, 7.9));

  const m15 = rows.map(([open, high, low, close, volume], n) => ({ openTime: START + n * M15, closeTime: START + (n + 1) * M15 - 1, open, high, low, close, volume }));
  return { data: { h1: aggregate(m15), m15 }, breakoutIndex, B };
}

module.exports = { buildScenario, r, B, M15, H1 };
