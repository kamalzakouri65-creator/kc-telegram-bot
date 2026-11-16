const test = require('node:test');
const assert = require('node:assert');
const { forwardTrades, status, compareSignals } = require('../src/forward');
const { runRsi2Windowed } = require('../src/engine');

const tr = (o) => ({ symbol: 'S&P 500', interval: '1day', strategy: 'rsi2', side: 'BUY', time: '2026-11-18 14:30:00', closedAt: '2026-11-20 14:30:00', entry: 6000, stopLoss: 5880, closed: true, r: 0.5, ...o });

test('تُحسب فقط صفقات RSI(2) على المؤشرين بعد البداية، مع خصم السبريد و Swap', () => {
  const f = forwardTrades([tr({}), tr({ time: '2026-11-16 14:30:00' }), tr({ symbol: 'BTC/USDT' }), tr({ strategy: 'ema-macd' }), tr({ closed: false })]);
  assert.strictEqual(f.length, 1);
  // ليلتان: 6000 × (0.01 + 2 × 0.02)% = 3 ÷ 120
  assert.ok(Math.abs(f[0].r - (0.5 - 3 / 120)) < 1e-9);
});

test('لا حكم قبل 30 صفقة، والنجاح والإيقاف المبكر عند 8R', () => {
  const d = (k) => `2027-0${1 + Math.floor(k / 28)}-${String(1 + (k % 28)).padStart(2, '0')} 14:30:00`;
  const mk = (k, r) => tr({ time: d(k), closedAt: d(k), r });
  assert.strictEqual(status([mk(0, 0.5)]).verdict, 'جارٍ');
  const ok = Array.from({ length: 30 }, (_, k) => mk(k, k % 3 === 0 ? -1 : 0.6));
  assert.strictEqual(status(ok).verdict, 'نجح', status(ok).reasons.join(' | '));
  const bad = Array.from({ length: 12 }, (_, k) => mk(k, -1));
  assert.match(status(bad).reasons[0], /إيقاف مبكر/);
});

test('المطابقة تكشف الإشارات الناقصة والزائدة عند البوت', () => {
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const candles = [];
  let p = 5000;
  for (let k = 0; k < 1150; k++) {
    const next = p * (1 + rnd() * 0.025 + 0.0008);
    candles.push({ time: new Date(Date.parse('2024-06-03T00:00:00Z') + k * 86400000).toISOString().slice(0, 10), open: p, high: Math.max(p, next) * 1.004, low: Math.min(p, next) * 0.996, close: next });
    p = next;
  }
  const exp = runRsi2Windowed(candles, { from: '2026-11-17', spreadPct: 0.01, window: 300 });
  assert.ok(exp.length >= 2, 'يجب أن تظهر إشارات متوقعة');
  const bot = exp.slice(1).map((t) => tr({ time: `${t.time} 14:30:00` }));
  bot.push(tr({ time: '2026-12-25 14:30:00' }));
  const c = compareSignals(bot, { 'S&P 500': candles })['S&P 500'];
  assert.ok(c.missing.includes(exp[0].time));
  assert.deepStrictEqual(c.extra, exp.some((t) => t.time === '2026-12-25') ? [] : ['2026-12-25']);
});
