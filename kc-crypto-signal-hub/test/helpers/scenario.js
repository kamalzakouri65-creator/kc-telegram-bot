// سيناريو اصطناعي يحتوي إعداد شراء كاملاً واحداً، تُبنى شموعه على M5 ثم تُجمّع إلى M15 و H1
// (فتكون الإطارات الثلاثة متسقة تماماً كما في البيانات الحقيقية).
const { aggregate } = require('../../src/data/candles');

const M5 = 5 * 60 * 1000;
const START = Date.UTC(2026, 0, 5); // الاثنين

// كل شمعة M15 تُقسم إلى 3 شموع M5 بنفس القمة والقاع
function splitM15([o, h, l, c]) {
  const path = c >= o ? [o, l, h, c] : [o, h, l, c];
  return [0, 1, 2].map((k) => {
    const a = path[k];
    const b = path[k + 1];
    return { open: a, close: b, high: Math.max(a, b), low: Math.min(a, b) };
  });
}

function buildScenario({ volumeSpike = 500, afterBars } = {}) {
  // خلفية: اتجاه صاعد متموج لـ 1200 شمعة M15 (300 شمعة H1، تكفي EMA200 وقمم وقيعان H1 متصاعدة)
  const bars = [];
  let prev = 100;
  for (let k = 1; k <= 1200; k++) {
    const p = 100 + 0.05 * k + 3 * Math.sin((2 * Math.PI * k) / 32);
    bars.push([prev, Math.max(prev, p) + 0.1, Math.min(prev, p) - 0.1, p]);
    prev = p;
  }
  const B = prev;
  const rel = (o, h, l, c) => [B + o, B + h, B + l, B + c];
  const setupBars = [
    rel(0, 0.5, -0.3, 0.3),
    rel(0.3, 1.2, 0.2, 1.0),
    rel(1.0, 2.0, 0.8, 1.6), // قمة
    rel(1.6, 1.7, 0.5, 0.6),
    rel(0.6, 0.8, -0.4, -0.2),
    rel(-0.2, 0.1, -1.0, -0.8), // قاع -1.0
    rel(-0.8, 0.0, -0.7, -0.1),
    rel(-0.1, 0.3, -0.5, 0.1),
    rel(0.1, 0.2, -0.6, -0.5),
    rel(-0.5, -0.3, -1.4, -0.7), // سحب السيولة تحت -1.0 والإغلاق فوقه (وهي البلوك)
    rel(-0.7, 2.3, -0.75, 2.2), // اندفاع وكسر هيكل
    rel(2.2, 2.6, 1.8, 2.4),
    rel(2.4, 2.5, 1.0, 1.1),
    rel(1.1, 1.2, -0.4, 0.3), // أول عودة إلى البلوك
    rel(0.3, 1.0, 0.1, 0.9), // شمعة M5 الثانية فيها = ابتلاع صاعد
  ];
  const after = afterBars ?? [rel(0.9, 3, 0.8, 2.9), rel(2.9, 6, 2.8, 5.9), rel(5.9, 9, 5.8, 8.9), rel(8.9, 9.5, 8.5, 9)];
  const all = [...bars, ...setupBars, ...after];

  const m5 = all.flatMap(splitM15).map((c, n) => ({
    ...c,
    openTime: START + n * M5,
    closeTime: START + (n + 1) * M5 - 1,
    volume: 100,
  }));
  // حجم كبير على شمعة الابتلاع (الثانية من آخر شمعة في الإعداد)
  const engulfIndex = (bars.length + setupBars.length - 1) * 3 + 1;
  m5[engulfIndex].volume = volumeSpike;

  return {
    data: { m5, m15: aggregate(m5, 3 * M5), h1: aggregate(m5, 12 * M5) },
    B,
    engulfIndex,
    returnM15CloseTime: m5[(bars.length + 13) * 3 + 2].closeTime,
  };
}

module.exports = { buildScenario, START, M5 };
