// تشخيص أسباب الفشل: يحلل كل صفقة من الاختبار التاريخي على نفس الشموع، دون أي تغيير في الاستراتيجية.
// كل المقاييس تُحسب بعد انتهاء الصفقة لفهم ما حدث، ولا يستعملها المحرك أبداً.
const { config: defaults } = require('../config');
const { buildContext } = require('../strategy/signalEngine');
const { lastClosedIndex } = require('../data/candles');

const HOUR = 60 * 60 * 1000;
const RANGE_ER = 0.25; // كفاءة الحركة أقل من هذا = سوق عرضي
const AFTER_STOP_BARS = 48; // 4 ساعات من شموع M5 بعد الوقف

function session(hour) {
  if (hour < 7) return 'آسيا (00-07)';
  if (hour < 13) return 'لندن (07-13)';
  if (hour < 21) return 'نيويورك (13-21)';
  return 'المساء (21-24)';
}

// كفاءة الحركة على آخر n شموع: صافي الحركة ÷ مجموع الحركات. قريب من 1 = اتجاه نظيف، قريب من 0 = تذبذب
function efficiency(candles, i, n) {
  if (i < n) return null;
  let path = 0;
  for (let k = i - n + 1; k <= i; k++) path += Math.abs(candles[k].close - candles[k - 1].close);
  return path ? Math.abs(candles[i].close - candles[i - n].close) / path : 0;
}

function analyzeTrade(trade, setup, ctx) {
  const m5 = ctx.m5.c;
  const riskUnit = trade.entry - trade.stopLoss;
  const fillIdx = m5.findIndex((c) => c.openTime === trade.filledAt);
  const exitIdx = lastClosedIndex(m5, trade.closedAt);

  // أقصى تقدم للسعر لصالح الصفقة قبل الخروج (بوحدة R). شمعة الخروج محسوبة، فالرقم قد يكون أعلى قليلاً من الحقيقة
  let mfe = 0;
  for (let k = fillIdx; k <= exitIdx; k++) mfe = Math.max(mfe, (m5[k].high - trade.entry) / riskUnit);

  // بعد الوقف: هل وصل السعر إلى الهدف خلال 4 ساعات؟ (الوقف ضُرب ثم كمل السعر في اتجاه الصفقة)
  let targetAfterStop = false;
  if (trade.outcome === 'stop') {
    for (let k = exitIdx + 1; k <= Math.min(m5.length - 1, exitIdx + AFTER_STOP_BARS); k++) {
      if (m5[k].high >= trade.takeProfit) {
        targetAfterStop = true;
        break;
      }
    }
  }

  // موقع الدخول داخل الحركة: من قاع سحب السيولة إلى أعلى قمة قبل الدخول
  const m15 = ctx.m15.c;
  const armIdx = lastClosedIndex(m15, setup.armedAt);
  const atr15 = ctx.m15.atr[armIdx];
  let legHigh = -Infinity;
  for (let k = m15.findIndex((c) => c.openTime === setup.sweep.time); k <= armIdx; k++) legHigh = Math.max(legHigh, m15[k].high);
  for (let k = lastClosedIndex(m5, setup.armedAt) + 1; k < fillIdx; k++) legHigh = Math.max(legHigh, m5[k].high);
  const legPct = legHigh > setup.sweep.low ? ((trade.entry - setup.sweep.low) / (legHigh - setup.sweep.low)) * 100 : null;

  // هل أغلقت شمعة M15 تحت البلوك قبل الوقف؟ (البلوك لم يصمد)
  let obBroken = false;
  for (let k = lastClosedIndex(m15, trade.filledAt) + 1; k <= lastClosedIndex(m15, trade.closedAt); k++) {
    if (m15[k].close < setup.ob.bottom) obBroken = true;
  }

  // حالة السوق على H1 عند الدخول
  const h1 = ctx.h1.c;
  const h = lastClosedIndex(h1, trade.filledAt);
  const er = efficiency(h1, h, 24);
  const emaSlope = h >= 24 && ctx.h1.ema[h - 24] ? ((ctx.h1.ema[h] - ctx.h1.ema[h - 24]) / ctx.h1.ema[h - 24]) * 100 : null;

  const hour = new Date(trade.filledAt).getUTCHours();
  return {
    pair: trade.pair,
    entryTime: new Date(trade.filledAt).toISOString().slice(0, 16).replace('T', ' '),
    outcome: trade.outcome,
    r: trade.r,
    barsHeld: exitIdx - fillIdx + 1,
    mfe,
    directStop: trade.outcome === 'stop' && mfe < 0.5,
    targetAfterStop,
    legPct,
    chaseAtr: atr15 ? (trade.entry - setup.ob.top) / atr15 : null,
    stopAtr: atr15 ? riskUnit / atr15 : null,
    obSizeAtr: atr15 ? (setup.ob.top - setup.ob.bottom) / atr15 : null,
    obBroken,
    fvg: Boolean(setup.ob.fvg),
    displacementAtr: setup.ob.displacementAtr,
    structure: setup.bos.kind,
    hour,
    session: session(hour),
    er,
    regime: er == null ? 'غير معروف' : er < RANGE_ER ? 'عرضي' : 'اتجاه',
    emaSlope,
  };
}

function diagnose(data, result, cfg = defaults) {
  const ctx = Object.fromEntries(Object.keys(data).map((p) => [p, buildContext(data[p], cfg)]));
  const setups = new Map(result.events.filter((e) => e.type === 'setup').map((e) => [e.setup.id, e.setup]));
  return result.trades.map((t) => analyzeTrade(t, setups.get(t.id), ctx[t.pair]));
}

// جدول: لكل مجموعة عدد الصفقات والرابحة والخاسرة ومجموع R
function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null) continue;
    const g = groups.get(k) ?? { n: 0, wins: 0, losses: 0, sumR: 0 };
    g.n += 1;
    if (r.r > 0) g.wins += 1;
    if (r.r < 0) g.losses += 1;
    g.sumR += r.r;
    groups.set(k, g);
  }
  return groups;
}

const bucket = (v, edges, labels) => {
  if (v == null) return null;
  const i = edges.findIndex((e) => v < e);
  return labels[i < 0 ? labels.length - 1 : i];
};

function table(title, groups) {
  const lines = [`-- ${title} --`];
  for (const [k, g] of groups) lines.push(`${k}: ${g.n} صفقة | رابحة ${g.wins} | خاسرة ${g.losses} | المجموع ${g.sumR >= 0 ? '+' : ''}${g.sumR.toFixed(1)}R`);
  return [...lines, ''];
}

function formatDiagnosis(rows) {
  const losses = rows.filter((r) => r.r < 0);
  const stops = rows.filter((r) => r.outcome === 'stop');
  const count = (f) => rows.filter(f).length;
  const lines = [
    `التشخيص: ${rows.length} صفقة (رابحة ${count((r) => r.r > 0)}، خاسرة ${losses.length}). العينة صغيرة: كل نسبة هنا مؤشر وليست دليلاً.`,
    '',
    '== 1. كيف خسرت الصفقات؟ ==',
    `وقف مباشر (لم يتقدم السعر حتى 0.5R): ${count((r) => r.directStop)} من ${stops.length}`,
    `تقدم 0.5R إلى 1R ثم عاد للوقف: ${count((r) => r.outcome === 'stop' && r.mfe >= 0.5 && r.mfe < 1)}`,
    `تقدم 1R أو أكثر ثم عاد للوقف: ${count((r) => r.outcome === 'stop' && r.mfe >= 1)}`,
    `ضُرب الوقف ثم وصل السعر للهدف خلال 4 ساعات: ${count((r) => r.targetAfterStop)}`,
    `متوسط مدة الصفقة الخاسرة: ${losses.length ? (losses.reduce((s, r) => s + r.barsHeld, 0) / losses.length * 5).toFixed(0) : 0} دقيقة`,
    `بُعد الوقف: متوسط ${(stops.reduce((s, r) => s + (r.stopAtr ?? 0), 0) / (stops.length || 1)).toFixed(2)} × ATR(M15)`,
    '',
    '== 2. هل الدخول متأخر؟ (موقع الدخول من قاع السحب إلى قمة الحركة) ==',
    ...table('موقع الدخول في الحركة', groupBy(rows, (r) => bucket(r.legPct, [50, 80], ['أقل من 50% (مبكر)', '50-80%', 'أكثر من 80% (متأخر)']))),
    ...table('بُعد الدخول فوق البلوك', groupBy(rows, (r) => bucket(r.chaseAtr, [0.5, 1.5], ['أقل من 0.5 ATR', '0.5-1.5 ATR', 'أكثر من 1.5 ATR']))),
    '== 3. هل البلوك صالح؟ ==',
    `أغلقت شمعة M15 تحت البلوك قبل الوقف: ${count((r) => r.obBroken)} من ${losses.length} خاسرة`,
    ...table('حجم البلوك', groupBy(rows, (r) => bucket(r.obSizeAtr, [0.75, 1.5], ['صغير (< 0.75 ATR)', 'متوسط', 'كبير (> 1.5 ATR)']))),
    ...table('وجود FVG', groupBy(rows, (r) => (r.fvg ? 'مع FVG' : 'بدون FVG'))),
    ...table('قوة الاندفاع', groupBy(rows, (r) => bucket(r.displacementAtr, [1.5, 2.5], ['1-1.5 ATR', '1.5-2.5 ATR', 'أكثر من 2.5 ATR']))),
    ...table('نوع كسر الهيكل', groupBy(rows, (r) => r.structure)),
    '== 4. الساعات (UTC) ==',
    ...table('الجلسة', groupBy(rows, (r) => r.session)),
    ...table('ساعة الدخول', new Map([...groupBy(rows, (r) => `${String(r.hour).padStart(2, '0')}:00`)].sort())),
    '== 5 و 6. حالة السوق (كفاءة الحركة على آخر 24 ساعة) ==',
    ...table('عرضي أم اتجاه', groupBy(rows, (r) => r.regime)),
    ...table('الزوج × حالة السوق', new Map([...groupBy(rows, (r) => `${r.pair} ${r.regime}`)].sort())),
    ...table('ميل EMA200 خلال 24 ساعة', groupBy(rows, (r) => bucket(r.emaSlope, [0.2, 0.6], ['ضعيف (< 0.2%)', 'متوسط', 'قوي (> 0.6%)']))),
    '== كل الصفقات ==',
    'الزوج | الدخول UTC | النتيجة | R | أقصى تقدم | موقع الدخول | البلوك انكسر | السوق',
    ...rows.map(
      (r) =>
        `${r.pair} | ${r.entryTime} | ${r.outcome} | ${r.r.toFixed(2)} | ${r.mfe.toFixed(2)}R | ${r.legPct?.toFixed(0)}% | ${r.obBroken ? 'نعم' : 'لا'} | ${r.regime} (${r.er?.toFixed(2)})`
    ),
  ];
  return lines.join('\n');
}

module.exports = { diagnose, formatDiagnosis, efficiency, groupBy };
