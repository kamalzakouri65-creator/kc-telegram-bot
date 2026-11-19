// التقارير: نص للهاتف، و CSV للتركيبات التسع ولكل سنة، و HTML بسيط
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

const sgn = (x, d = 1) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
const pf = (m) => (m.n === 0 ? '—' : Number.isFinite(m.pf) ? m.pf.toFixed(2) : '∞');
const row = (label, m) => `${label}: ${m.n} صفقة | ربح ${m.winRate.toFixed(0)}% | PF ${pf(m)} | ${sgn(m.net)}R | تراجع ${m.maxDd.toFixed(1)}R | Exp ${sgn(m.exp, 3)}R`;

function write(section, j, info, tagOverride) {
  const title = tagOverride === 'idea2' ? 'الفكرة 2: فخ الكسر الكاذب لنطاق آسيا (عكس الفكرة 1)' : tagOverride?.startsWith('idea3') ? 'الفكرة 3: الارتداد خلال اليوم، RSI(2) على 15 دقيقة مع الترند اليومي' : tagOverride?.startsWith('idea4') ? 'الفكرة 4: الارتداد إلى فيبوناتشي 61.8% مع شمعة تأكيد (ساعة)' : 'الفكرة 1: اختراق نطاق آسيا عند افتتاح لندن';
  const gridLabel = tagOverride?.startsWith('idea3') ? ['RSI أقل من', 'متوسط الخروج'] : tagOverride?.startsWith('idea4') ? ['مستوى', 'القمم بشموع'] : ['هدف', 'وقف'];
  const L = [`KC GOLD LAB — ${title} — ${section}`, info, `التكاليف: سبريد ${config.costs.spread}$ + انزلاق ${config.costs.slippage}$ لكل صفقة.`, ''];
  L.push(row('الكل', j.m), row('بضعف السبريد', j.md), row('شراء', j.buy), row('بيع', j.sell), '', 'كل سنة:');
  for (const y of j.years) L.push(`   ${row(y.year, y.m)}`);
  L.push('', `طريقة الخروج: ${Object.entries(j.how).map(([k, n]) => `${k} ${n}`).join(' | ')}`, '', `المتانة: ${j.positive} من 9`);
  for (const rr of [...new Set(j.grid.map((g) => g.rr))]) L.push(`   ${gridLabel[0]} ${rr}: ${j.grid.filter((g) => g.rr === rr).map((g) => `${gridLabel[1]} ${g.stopFrac} PF ${pf(g.m)} ${sgn(g.m.net)}R (${g.m.n})`).join(' | ')}`);
  L.push('', `━━ الحكم: ${j.pass ? '✅ نجح' : '❌ لم ينجح'}`, ...j.reasons.map((r) => `   - ${r}`), '', 'R = المبلغ الذي تخاطر به في الصفقة. اختبار تاريخي فقط، لا تداول.');
  const text = L.join('\n');
  fs.mkdirSync(config.paths.reports, { recursive: true });
  const tag = tagOverride ?? (section === 'التطوير' ? 'dev' : 'confirm');
  fs.writeFileSync(path.join(config.paths.reports, `${tag}-report.txt`), text);
  fs.writeFileSync(path.join(config.paths.reports, `${tag}-results_9_combinations.csv`), ['rr,stop_frac,trades,win_rate,pf,net_r,max_dd_r', ...j.grid.map((g) => [g.rr, g.stopFrac, g.m.n, g.m.winRate.toFixed(1), pf(g.m), g.m.net.toFixed(2), g.m.maxDd.toFixed(2)].join(','))].join('\n'));
  fs.writeFileSync(path.join(config.paths.reports, `${tag}-yearly_results.csv`), ['year,trades,win_rate,pf,net_r,max_dd_r', ...j.years.map((y) => [y.year, y.m.n, y.m.winRate.toFixed(1), pf(y.m), y.m.net.toFixed(2), y.m.maxDd.toFixed(2)].join(','))].join('\n'));
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  fs.writeFileSync(path.join(config.paths.reports, `${tag}-final_report.html`), `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KC Gold Lab</title><style>body{font-family:system-ui;background:#111;color:#eee;padding:16px}pre{white-space:pre-wrap;line-height:1.6}</style></head><body><pre>${esc(text)}</pre></body></html>`);
  return text;
}

module.exports = { write };
