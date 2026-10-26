// تنفيذ الإشارات تلقائياً على حساب MT5 مع ضوابط المخاطرة
const { createClient, isTradeOk } = require('./metaapi');
const { toMtSymbol, quoteToAccountRate, lotSize, orderLevels, splitVolume } = require('./risk');

const COMMENT = 'kc-signals-bot';

function createTrader(config) {
  const {
    token,
    accountId,
    region,
    symbolSuffix = '',
    symbolMap = {},
    riskPercent = 1,
    maxOpenPositions = 3,
    allowReal = false,
  } = config;
  const api = createClient({ token, accountId, region });

  async function checkAccount() {
    const info = await api.accountInfo();
    if (info.type === 'ACCOUNT_TRADE_MODE_REAL' && !allowReal) {
      throw new Error('الحساب حقيقي، والتداول الآلي مسموح على الحساب التجريبي فقط (ALLOW_REAL_TRADING=false)');
    }
    return info;
  }

  // يُرجع نصاً يصف ما حدث، سواء نُفّذت الصفقة أو تم تجاوزها
  async function execute(symbol, signal) {
    const mtSymbol = toMtSymbol(symbol, symbolSuffix, symbolMap);
    const info = await checkAccount();

    const positions = await api.positions();
    if (positions.some((p) => p.symbol === mtSymbol)) {
      return `⏭️ ${mtSymbol}: توجد صفقة مفتوحة على هذا الرمز، لم تُفتح صفقة جديدة.`;
    }
    if (positions.length >= maxOpenPositions) {
      return `⏭️ ${mtSymbol}: وصلت للحد الأقصى من الصفقات المفتوحة (${maxOpenPositions}).`;
    }

    const [spec, quote] = await Promise.all([api.specification(mtSymbol), api.price(mtSymbol)]);
    const price = signal.side === 'BUY' ? quote.ask : quote.bid;
    const levels = orderLevels(signal, price, spec.digits);
    const volume = lotSize({
      balance: info.balance,
      riskPercent,
      slDistance: levels.slDistance,
      contractSize: spec.contractSize,
      rate: quoteToAccountRate(symbol, price, info.currency),
      minVolume: spec.minVolume,
      maxVolume: spec.maxVolume,
      volumeStep: spec.volumeStep,
    });
    if (volume === 0) {
      return `⏭️ ${mtSymbol}: الرصيد لا يكفي لأقل حجم (${spec.minVolume}) ضمن مخاطرة ${riskPercent}%.`;
    }

    const parts = splitVolume(volume, spec.minVolume, spec.volumeStep);
    const targets = [levels.takeProfit1, levels.takeProfit2];
    const lines = [];
    for (let k = 0; k < parts.length; k++) {
      const result = await api.trade({
        actionType: signal.side === 'BUY' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL',
        symbol: mtSymbol,
        volume: parts[k],
        stopLoss: levels.stopLoss,
        takeProfit: targets[k],
        comment: COMMENT,
      });
      lines.push(
        isTradeOk(result)
          ? `✅ ${parts[k]} لوت — الهدف ${targets[k]} (صفقة ${result.positionId ?? result.orderId})`
          : `❌ ${parts[k]} لوت — فشل: ${result.message ?? result.stringCode}`
      );
    }

    return [
      `🤖 تنفيذ آلي ${signal.side} ${mtSymbol} @ ${price}`,
      `🛑 وقف الخسارة: ${levels.stopLoss} | مخاطرة ${riskPercent}% من ${info.balance} ${info.currency}`,
      ...lines,
    ].join('\n');
  }

  async function summary() {
    const info = await checkAccount();
    const positions = await api.positions();
    const mode = info.type === 'ACCOUNT_TRADE_MODE_REAL' ? 'حقيقي' : 'تجريبي';
    const head = [
      `💼 الحساب (${mode}) — ${info.broker ?? ''}`,
      `الرصيد: ${info.balance} ${info.currency} | السيولة: ${info.equity}`,
      `الصفقات المفتوحة: ${positions.length}`,
    ];
    const rows = positions.map(
      (p) =>
        `• ${p.symbol} ${p.type === 'POSITION_TYPE_BUY' ? 'شراء' : 'بيع'} ${p.volume} @ ${p.openPrice} | الربح: ${p.profit}`
    );
    return [...head, ...rows].join('\n');
  }

  return { execute, summary };
}

module.exports = { createTrader };
