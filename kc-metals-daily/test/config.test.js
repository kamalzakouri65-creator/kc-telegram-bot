const test = require('node:test');
const assert = require('node:assert');
const { config } = require('../src/config');
const { runRsi2 } = require('../../kc-nasdaq-daily/src/engine');

test('الذهب والفضة بسبريد XM، وفترتان لا تتداخلان', () => {
  assert.deepStrictEqual(config.markets.map((m) => m.ticker), ['GC=F', 'SI=F']);
  assert.ok(config.markets.every((m) => m.spreadPct > 0));
  assert.ok(config.final.to < config.dev.from);
});

test('نفس محرك RSI(2) المختبر على Nasdaq متاح', () => {
  assert.strictEqual(typeof runRsi2, 'function');
});
