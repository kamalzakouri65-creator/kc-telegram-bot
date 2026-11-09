const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { removeTrade } = require('../src/remove-trade');
const { createTracker } = require('../src/tracker');

test('حذف إشارة واحدة بمعرّفها مع نسخة احتياطية', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rm-')), 'trades.json');
  const t = createTracker(file);
  const sig = (time, side) => ({ side, time, entry: 4066.85, stopLoss: 4065.09, takeProfit1: 4069.51, takeProfit2: 4072.16 });
  t.add('XAU/USD', '1h', sig('2026-11-09 09:00:00', 'BUY'), 'pullback');
  t.add('XAG/USD', '1h', sig('2026-11-09 00:00:00', 'SELL'), 'ema-macd');
  assert.deepStrictEqual(removeTrade(file, 'XAU/USD|1h|BUY@2026-11-09 09:00:00|pullback'), { removed: 1, total: 1 });
  assert.ok(fs.existsSync(`${file}.bak`));
  assert.strictEqual(createTracker(file).summary().open[0].symbol, 'XAG/USD');
  assert.deepStrictEqual(removeTrade(file, 'غير موجود'), { removed: 0, total: 1 });
});
