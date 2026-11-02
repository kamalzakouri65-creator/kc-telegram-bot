// مناطق المقاومة على H1 والاختراق. كل شيء يُحسب من الشموع المغلقة حتى الفهرس المعطى فقط.
const { config } = require('./config');

// مناطق المقاومة الصالحة كما تُرى عند إغلاق شمعة H1 رقم i
function findZones(h1, atrH1, swingHighs, i, rules = config.rules) {
  const a = atrH1[i];
  if (!a) return [];
  const highs = swingHighs.filter((s) => s.confirmedAt <= i && s.index >= i - rules.zoneLookback + 1);
  const zones = [];
  for (const s of highs) {
    const zone = zones.find((z) => Math.abs(s.price - z.level) <= rules.zoneWidthAtr * a);
    if (!zone) {
      zones.push({ touches: [s], level: s.price });
      continue;
    }
    // لمسة مستقلة فقط إذا نزل السعر بين اللمستين تحت الحد السفلي بـ 0.5 ATR
    const bottom = zone.level - (rules.zoneWidthAtr / 2) * a;
    let minLow = Infinity;
    for (let k = zone.touches.at(-1).index + 1; k < s.index; k++) minLow = Math.min(minLow, h1[k].low);
    if (minLow <= bottom - rules.touchSeparationAtr * a) {
      zone.touches.push(s);
      zone.level = zone.touches.reduce((sum, t) => sum + t.price, 0) / zone.touches.length;
    }
  }

  const valid = [];
  for (const z of zones) {
    if (z.touches.length < rules.minTouches) continue;
    const top = z.level + (rules.zoneWidthAtr / 2) * a;
    const bottom = z.level - (rules.zoneWidthAtr / 2) * a;
    // منطقة أغلقت فوقها شمعة بعد أول لمسة لم تعد مقاومة
    let broken = false;
    for (let k = z.touches[0].index + 1; k <= i; k++) if (h1[k].close > top) broken = true;
    if (!broken) valid.push({ level: z.level, top, bottom, mid: z.level, touches: z.touches.map((t) => t.index), atr: a });
  }
  return valid;
}

// اختراق عند إغلاق شمعة H1 رقم i لمنطقة تكوّنت حتى الشمعة السابقة. يُرجع null أو تفاصيل الاختراق.
function breakoutAt(h1, atrH1, swingHighs, i, rules = config.rules) {
  if (i < rules.volumePeriod + 1) return null;
  const c = h1[i];
  const range = c.high - c.low;
  const body = c.close - c.open;
  if (!(range > 0 && body > 0 && body >= (rules.breakoutBodyPct / 100) * range)) return null;

  let avgVol = 0;
  for (let k = i - rules.volumePeriod; k < i; k++) avgVol += h1[k].volume;
  avgVol /= rules.volumePeriod;
  const volumeRatio = avgVol > 0 ? c.volume / avgVol : 0;
  if (volumeRatio < rules.breakoutVolumeMult) return null;

  // المناطق كما كانت قبل شمعة الاختراق، والمسافة 0.1 ATR بنفس ATR المنطقة
  const broken = findZones(h1, atrH1, swingHighs, i - 1, rules).filter((z) => c.close > z.top + rules.breakoutCloseAtr * z.atr);
  if (broken.length === 0) return null;
  const zone = broken.reduce((a, b) => (b.top > a.top ? b : a));
  return { zone, index: i, time: c.openTime, closeTime: c.closeTime, bodyPct: (body / range) * 100, volumeRatio, closeAboveAtr: (c.close - zone.top) / zone.atr };
}

module.exports = { findZones, breakoutAt };
