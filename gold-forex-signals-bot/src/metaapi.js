// عميل بسيط لواجهة MetaApi السحابية (https://metaapi.cloud) للتداول على حساب MetaTrader 5
// دون الحاجة لتشغيل MT5 على حاسوب.

function createClient({ token, accountId, region = 'new-york' }) {
  const base = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}`;

  async function request(path, options = {}) {
    const res = await fetch(base + path, {
      ...options,
      headers: { 'auth-token': token, 'Content-Type': 'application/json', ...options.headers },
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`MetaApi HTTP ${res.status}: ${data?.message ?? text}`);
    return data;
  }

  return {
    accountInfo: () => request('/account-information'),
    positions: () => request('/positions'),
    specification: (symbol) => request(`/symbols/${encodeURIComponent(symbol)}/specification`),
    price: (symbol) => request(`/symbols/${encodeURIComponent(symbol)}/current-price`),
    trade: (body) => request('/trade', { method: 'POST', body: JSON.stringify(body) }),
  };
}

// 10008 = تم وضع الأمر، 10009 = تم التنفيذ
const isTradeOk = (result) => [10008, 10009].includes(result?.numericCode);

module.exports = { createClient, isTradeOk };
