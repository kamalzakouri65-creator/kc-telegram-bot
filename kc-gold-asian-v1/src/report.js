// التقرير النهائي بصيغة Markdown، بالترتيب المطلوب في SPEC (البند 11).
const { metrics, fmtPf } = require('./stats');
const { fmt } = require('./time');

const sg = (x, d = 1) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
const day = (ms) => fmt(ms).slice(0, 10);
const HEAD = '| | صفقات | ربح | PF | صافي R | Exp R | تراجع R | متوسط ربح | متوسط خسارة | أطول خسائر | صافي $ |\n|---|---|---|---|---|---|---|---|---|---|---|';
const line = (label, m) => `| ${label} | ${m.n} | ${m.winRate.toFixed(0)}% | ${fmtPf(m.pf)} | ${sg(m.net)} | ${sg(m.exp, 3)} | ${m.maxDd.toFixed(1)} | ${sg(m.avgWin, 2)} | ${sg(m.avgLoss, 2)} | ${m.worst} | ${sg(m.usd, 2)} |`;
const comboName = (c) => `${c.rr}R / وقف ${c.stopFrac}${c.base ? ' ⭐ الأساسية' : ''}`;

function groupTable(title, trades, keyFn) {
  const keys = [...new Set(trades.map(keyFn))].sort();
  const rows = keys.map((k) => line(k, metrics(trades.filter((t) => keyFn(t) === k))));
  return [`**${title}**`, '', HEAD, ...rows, ''];
}

function buildReport({ R, cfg, q, hash, removed, bars }) {
  const { bounds, combos, base, dm, v } = R;
  const T = base.res.trades;
  const L = [];
  L.push('# GOLD ASIAN RANGE BREAKOUT V1 — التقرير النهائي (اختبار تاريخي، تشغيل وحيد)', '');
  L.push('> ⚠️ Historical Holdout **ليس Out-of-Sample مستقلاً**: كل بيانات 2020–2026 استُعملت سابقاً في اختبارات أخرى. **ولا هو دليل نهائي على الربحية.** الاختبار المستقل الحقيقي الوحيد هو اختبار مستقبلي (Paper Trading).', '');
  L.push('> لا اتصال بأي وسيط، ولا تداول، ولا إشارات Telegram. القواعد مسجلة مسبقاً في docs/SPEC.md ولم تتغير.', '');

  // 1) الملخص
  L.push('## 1. ملخص النتائج', '');
  L.push(`- **الحكم: ${v.verdict}**`);
  for (const r of v.reasons) L.push(`  - ${r}`);
  const b = base.m;
  L.push(`- التركيبة الأساسية (1.5R، منتصف النطاق): ${b.total.n} صفقة، ربح ${b.total.winRate.toFixed(0)}%، **PF ${fmtPf(b.total.pf)}**، صافي **${sg(b.total.net)}R**، Exp ${sg(b.total.exp, 3)}R.`);
  L.push(`- Historical Holdout: ${b.holdout.n} صفقة، صافي ${sg(b.holdout.net)}R، PF ${fmtPf(b.holdout.pf)}.`);
  L.push(`- ضعف السبريد: صافي ${sg(dm.total.net)}R، PF ${fmtPf(dm.total.pf)}. آخر 6 أشهر: ${R.last6.n} صفقة، ${sg(R.last6.net)}R. التركيبات الرابحة: ${R.positiveCombos} من 9.`);
  L.push('');
  L.push('| الشرط | القيمة | النتيجة |', '|---|---|---|');
  const C = cfg.criteria;
  L.push(`| PF الإجمالي ≥ ${C.minPf} | ${fmtPf(b.total.pf)} | ${b.total.pf >= C.minPf ? '✅' : '❌'} |`);
  L.push(`| Expectancy > 0 | ${sg(b.total.exp, 3)}R | ${b.total.exp > 0 ? '✅' : '❌'} |`);
  L.push(`| صافي Holdout > 0 | ${sg(b.holdout.net)}R | ${b.holdout.net > 0 ? '✅' : '❌'} |`);
  L.push(`| Holdout ≥ ${C.minHoldoutTrades} صفقة | ${b.holdout.n} | ${b.holdout.n >= C.minHoldoutTrades ? '✅' : '❌'} |`);
  L.push(`| آخر 6 أشهر ≥ ${C.last6mMinR}R | ${sg(R.last6.net)}R | ${R.last6.net >= C.last6mMinR ? '✅' : '❌'} |`);
  L.push(`| ضعف السبريد > 0 | ${sg(dm.total.net)}R | ${dm.total.net > 0 ? '✅' : '❌'} |`);
  L.push(`| ${C.minPositiveCombos} من 9 تركيبات رابحة | ${R.positiveCombos} | ${R.positiveCombos >= C.minPositiveCombos ? '✅' : '❌'} |`);
  L.push('');

  // 2) التركيبات التسع
  L.push('## 2. نتائج التركيبات التسع (التكاليف الأساسية، كامل الفترة)', '', HEAD);
  for (const c of combos) L.push(line(comboName(c), c.m.total));
  L.push('', '| التركيبة | Development | Validation | Historical Holdout |', '|---|---|---|---|');
  for (const c of combos) L.push(`| ${comboName(c)} | ${c.m.dev.n} ص، PF ${fmtPf(c.m.dev.pf)}، ${sg(c.m.dev.net)}R | ${c.m.val.n} ص، PF ${fmtPf(c.m.val.pf)}، ${sg(c.m.val.net)}R | ${c.m.holdout.n} ص، PF ${fmtPf(c.m.holdout.pf)}، ${sg(c.m.holdout.net)}R |`);
  L.push('');

  // 3) الأقسام
  L.push('## 3. Development و Validation و Historical Holdout (التركيبة الأساسية)', '');
  L.push(`- Development: ${day(bounds.start)} → ${day(bounds.devEnd)}`);
  L.push(`- Validation: ${day(bounds.devEnd)} → ${day(bounds.valEnd)}`);
  L.push(`- Historical Holdout: ${day(bounds.valEnd)} → ${day(bounds.end)}`, '');
  L.push(HEAD, line('المجموع', b.total), line('Development', b.dev), line('Validation', b.val), line('Historical Holdout', b.holdout), '');

  // 4) التكاليف والفرضيات
  L.push('## 4. التكاليف والفرضيات', '');
  L.push(`- البيانات: ذهب M15 من Twelve Data (UTC)، ${day(bars.t[0])} → ${day(bars.t.at(-1))}، ${bars.t.length} شمعة بعد التنظيف (حُذف ${removed.closed} في أوقات الإغلاق و ${removed.invalid} غير صالحة). البصمة ${hash.slice(0, 16)}…`);
  L.push('- الأسعار تُعامل كـ Mid. Ask = Mid + السبريد ÷ 2، و Bid = Mid − السبريد ÷ 2. الشراء يدخل على Ask ويخرج على Bid، والبيع عكسه.');
  L.push('- السبريد 0.52$ والانزلاق 0.10$ للأونصة: **فرضية محاكاة مكتوبة، وليست تأكيداً لسبريد XM.** السبريد داخل الأسعار، والانزلاق يُخصم مرة واحدة. لا عمولة، ولا Swap (الخروج قبل 16:00).');
  L.push('- الدخول بافتتاح شمعة M15 التالية للاختراق. الوقف أولاً عند لمس الوقف والهدف في نفس الشمعة، والفجوة خلف الوقف تُغلق بسعر الافتتاح.');
  L.push('- الدولار للمعلومة: 0.5% من الرصيد الحالي، البداية 1,000$.');
  const cp = T.map((t) => t.costPct).sort((x, y) => x - y);
  if (cp.length) L.push(`- نسبة التكلفة إلى المخاطرة (0.62$ ÷ مسافة الوقف): الوسيط ${cp[Math.floor(cp.length / 2)].toFixed(1)}%، أدنى ${cp[0].toFixed(1)}%، أعلى ${cp.at(-1).toFixed(1)}%.`);
  L.push('');

  // 5) التراجع والمخاطر
  L.push('## 5. التراجع والمخاطر (التركيبة الأساسية)', '');
  L.push(`- أكبر تراجع: ${b.total.maxDd.toFixed(1)}R (${b.total.ddPct.toFixed(1)}% من الرصيد). أطول سلسلة خسائر: ${b.total.worst}.`);
  L.push(`- الرصيد: 1,000$ → ${base.res.equity.toFixed(2)}$.`);
  const how = (h) => T.filter((t) => t.how === h).length;
  L.push(`- الخروج: الهدف ${how('target')} | الوقف ${how('stop')} | الوقت (16:00) ${how('time')} | نهاية البيانات ${how('end')}.`);
  L.push(`- إشارات مُتخطاة: فجوة ${base.res.skipped.gap}، الافتتاح خلف الوقف ${base.res.skipped.beyondStop}.`, '');

  // 6) المتانة
  L.push('## 6. اختبارات المتانة', '');
  L.push(`**التكاليف:** الأساسية ${sg(b.total.net)}R (PF ${fmtPf(b.total.pf)}) | ضعف السبريد ${sg(dm.total.net)}R (PF ${fmtPf(dm.total.pf)}، ${dm.total.n} صفقة)`, '');
  L.push(HEAD, line('ضعف السبريد: المجموع', dm.total), line('ضعف السبريد: Development', dm.dev), line('ضعف السبريد: Validation', dm.val), line('ضعف السبريد: Holdout', dm.holdout), '');
  L.push(...groupTable('كل سنة', T, (t) => t.day.slice(0, 4)));
  L.push(...groupTable('كل شهر', T, (t) => t.day.slice(0, 7)));
  const months = [...new Set(T.map((t) => t.day.slice(0, 7)))];
  const monthNet = months.map((m) => [m, metrics(T.filter((t) => t.day.startsWith(m))).net]).sort((x, y) => y[1] - x[1]);
  L.push(`- أشهر رابحة: ${monthNet.filter((x) => x[1] > 0).length} من ${months.length}.`);
  L.push(`- آخر 6 أشهر (من ${day(R.last6From)}): ${R.last6.n} صفقة، ${sg(R.last6.net)}R.`);
  const sorted = [...T].sort((x, y) => y.r - x.r);
  if (T.length) {
    L.push(`- الاعتماد على صفقة واحدة: الصافي بدون أفضل صفقة (${sg(sorted[0].r, 2)}R) = ${sg(b.total.net - sorted[0].r)}R.`);
    L.push(`- الاعتماد على شهر واحد: الصافي بدون أفضل شهر (${monthNet[0][0]}، ${sg(monthNet[0][1])}R) = ${sg(b.total.net - monthNet[0][1])}R.`);
  }
  L.push('');
  L.push(...groupTable('الاتجاه (الشراء = يوم فوق SMA20، البيع = تحته)', T, (t) => (t.side > 0 ? 'شراء' : 'بيع')));
  const sizes = T.map((t) => t.range).sort((x, y) => x - y);
  if (sizes.length >= 3) {
    const a = sizes[Math.floor(sizes.length / 3)];
    const c = sizes[Math.floor((2 * sizes.length) / 3)];
    L.push(...groupTable(`ظروف السوق: حجم نطاق آسيا (حدود الأثلاث ${a.toFixed(1)}$ و ${c.toFixed(1)}$)`, T, (t) => (t.range < a ? '1 صغير' : t.range < c ? '2 متوسط' : '3 كبير')));
  }
  L.push(...groupTable('نوع الخروج', T, (t) => t.how));
  const lg = base.res.log;
  L.push('**أيام بدون صفقة**', '', '| السنة | أيام | نطاق > 25$ | نطاق < 3$ | بدون نطاق | إشارات |', '|---|---|---|---|---|---|');
  for (const [y, s] of Object.entries(lg.byYear).sort()) L.push(`| ${y} | ${s.days} | ${s.tooBig} | ${s.tooSmall} | ${s.noRange} | ${s.signals} |`);
  L.push('', `- المجموع: ${lg.days} يوم لندن | بدون اتجاه ${lg.noTrend} | بدون نطاق ${lg.noRange} | نطاق < 3$: ${lg.tooSmall} | نطاق > 25$: ${lg.tooBig} | بدون اختراق متوافق ${lg.noBreak} | أيام فيها اختراق مخالف تم تجاهله ${lg.counterIgnored} | إشارات ${lg.signals}`, '');
  L.push('**مؤشرات Overfitting**', '');
  L.push(`- Exp في Development ${sg(b.dev.exp, 3)}R مقابل Historical Holdout ${sg(b.holdout.exp, 3)}R.`);
  L.push(`- التركيبات الرابحة: ${R.positiveCombos} من 9.`);
  const ys = [...new Set(T.map((t) => t.day.slice(0, 4)))].map((y) => metrics(T.filter((t) => t.day.startsWith(y))).net);
  L.push(`- السنوات الرابحة: ${ys.filter((x) => x > 0).length} من ${ys.length}.`, '');

  // 7) أفضل وأسوأ تركيبة
  const ranked = [...combos].sort((x, y) => y.m.total.net - x.m.total.net);
  L.push('## 7. أفضل وأسوأ تركيبة (للمعلومة فقط، ولا تُعتمد)', '');
  L.push(`- الأفضل: ${comboName(ranked[0])}: ${sg(ranked[0].m.total.net)}R، PF ${fmtPf(ranked[0].m.total.pf)}، Holdout ${sg(ranked[0].m.holdout.net)}R.`);
  L.push(`- الأسوأ: ${comboName(ranked.at(-1))}: ${sg(ranked.at(-1).m.total.net)}R، PF ${fmtPf(ranked.at(-1).m.total.pf)}.`);
  L.push('- اختيار الأفضل بعد رؤية النتائج يكون Optimization على كل البيانات، فالحكم على التركيبة الأساسية المسجلة فقط.', '');

  // 8) الحكم
  L.push('## 8. الحكم النهائي', '', `**${v.verdict}**`, '');
  if (v.reasons.length) for (const r of v.reasons) L.push(`- ${r}`);
  else L.push('- كل الشروط السبعة تحققت. **هذا لا يعني تداولاً:** الخطوة التالية الوحيدة الممكنة هي اختبار مستقبلي (Paper Trading).');
  L.push('', '> Historical Holdout ليس Out-of-Sample مستقلاً ولا دليلاً نهائياً على الربحية.', '');
  L.push(`_جودة البيانات: ${q.count} شمعة خام، مفقود في ساعات السوق ${((q.missingOpen / Math.max(1, q.expectedOpen)) * 100).toFixed(2)}%. R = المبلغ المخاطر به. Exp = متوسط النتيجة لكل صفقة. PF = مجموع الأرباح ÷ مجموع الخسائر._`);
  return L.join('\n');
}

module.exports = { buildReport };
