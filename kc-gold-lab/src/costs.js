const { config } = require('./config');
// التكلفة لكل صفقة بالدولار للأونصة (سبريد + انزلاق). صفقات اليوم الواحد بلا Swap.
const tradeCost = (spreadMult = 1) => config.costs.spread * spreadMult + config.costs.slippage;
module.exports = { tradeCost };
