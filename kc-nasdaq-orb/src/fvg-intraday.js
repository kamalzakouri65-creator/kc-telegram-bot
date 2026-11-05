// FVG على إطاري 5 و 15 دقيقة: npm run fvg-intraday
// نفس استراتيجية FVG بالضبط (من بوت الذهب، بدون أي تعديل) على QQQ (Nasdaq 100)، مع SPY (S&P 500) للتأكيد.
// البيانات: سنتان من Twelve Data، ساعات السوق فقط، وتُحفظ حتى لا تُجلب مرة ثانية.
//
// القاعدة مسجلة قبل التشغيل (2026-11-05): يُعتمد إطار فقط إذا اجتاز QQQ الشروط (30 صفقة، PF ≥ 1.2، الفترة الأخيرة رابحة)
// وكانت نتيجة SPY على نفس الإطار موجبة. غير ذلك = صدفة على الأرجح.
const { analyzeFvg } = require('../../gold-forex-signals-bot/src/fvg');
const { evaluate, formatRow } = require('../../gold-forex-signals-bot/src/scan-pairs');
const data = require('./data');

// السبريد كنسبة من السعر: US100 ~1.5 نقطة على ~21000، و US500 ~0.6 نقطة على ~6000
const MARKETS = [
  { symbol: 'QQQ', label: 'Nasdaq 100 (QQQ)', spreadPct: 0.007 },
  { symbol: 'SPY', label: 'S&P 500 (SPY)', spreadPct: 0.01 },
];
const INTERVALS = ['15min', '5min'];

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// الحكم على إطار: QQQ يجتاز الشروط و SPY موجب
function verdict(qqq, spy) {
  if (!qqq.pass) return { ok: false, reason: `QQQ لم يجتز الشروط (${qqq.reasons.join('، ')})` };
  if (!(spy.totalR > 0)) return { ok: false, reason: 'SPY غير موجب، فنتيجة QQQ صدفة على الأرجح' };
  return { ok: true, reason: 'QQQ اجتاز الشروط و SPY موجب' };
}

async function loadOrFetch(symbol, interval) {
  const name = `${symbol}-${interval}`;
  const cached = data.load(name);
  if (cached) return cached;
  console.log(`جلب ${symbol} ${interval}...`);
  const candles = await data.fetchHistory({ symbol, interval, onProgress: (n, oldest) => console.log(`  ${n} شمعة، الأقدم: ${oldest}`) });
  if (candles.length < 1000) throw new Error(`${name}: بيانات قليلة (${candles.length})`);
  data.save(name, candles);
  return candles;
}

module.exports = { verdict, MARKETS };

if (require.main === module) {
  (async () => {
    const results = {};
    for (const interval of INTERVALS) {
      for (const m of MARKETS) {
        const candles = await loadOrFetch(m.symbol, interval);
        const spread = (median(candles.map((c) => c.close)) * m.spreadPct) / 100;
        const r = evaluate(candles, analyzeFvg, spread);
        results[`${m.symbol}-${interval}`] = r;
        console.log(`━━ ${m.label} ${interval} — ${candles[0].time.slice(0, 10)} → ${candles.at(-1).time.slice(0, 10)}`);
        console.log(formatRow(m.symbol, interval, 'FVG', r));
      }
      const v = verdict(results[`QQQ-${interval}`], results[`SPY-${interval}`]);
      console.log(`${v.ok ? '✅' : '❌'} ${interval}: ${v.reason}\n`);
    }
    console.log('R = المبلغ الذي تخاطر به في الصفقة. النتائج بعد خصم السبريد التقديري.');
  })().catch((err) => {
    console.error('فشل:', err.message);
    process.exit(1);
  });
}
