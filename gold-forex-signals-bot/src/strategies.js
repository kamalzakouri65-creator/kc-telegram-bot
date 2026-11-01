// الاستراتيجيات التي يمكن للبوت تشغيلها، ويُختار منها بـ STRATEGY في .env (مثل ema-macd,pullback)
const { analyze } = require('./strategy');
const { analyzeOrderBlock } = require('./orderblock');
const { analyzePullback } = require('./pullback');
const { analyzeSmc } = require('./smc');

const STRATEGIES = {
  'ema-macd': { analyze, label: 'EMA + MACD' },
  pullback: { analyze: analyzePullback, label: 'Pullback' },
  'order-block': { analyze: analyzeOrderBlock, label: 'Order Block' },
  smc: { analyze: analyzeSmc, label: 'Smart Money' },
};

// الإشارات المحفوظة قبل دعم أكثر من استراتيجية كانت كلها من ema-macd
const DEFAULT_STRATEGY = 'ema-macd';

const labelOf = (key) => STRATEGIES[key ?? DEFAULT_STRATEGY]?.label ?? key;

module.exports = { STRATEGIES, DEFAULT_STRATEGY, labelOf };
