// KC Forex BOS — الشروط مسجلة قبل أي نتيجة (2026-11-18) ووافق عليها صاحب المشروع. لا تُعدَّل بعد رؤية النتائج.
const path = require('path');
const ROOT = path.join(__dirname, '..');

const PIP = 0.0001;
const config = {
  symbol: 'EUR/USD',
  rule: { pivot: 3, rr: 2.5, stopBufferAtr: 0.1, minStopPips: 10 },
  // التكاليف بالنقاط: سبريد XM Micro الحقيقي 1.6 + انزلاق 0.2، و Swap تقديري 0.5 نقطة لكل ليلة (21:00 UTC)
  costs: { spreadPips: 1.6, slippagePips: 0.2, swapPipsPerNight: 0.5 },
  // الفترات المسجلة. إذا بدأت البيانات بعد 2010-03-01 (حد المصدر المجاني)، تُقسم البيانات المتاحة إلى 3 فترات متساوية زمنياً
  periods: [['الفترة 1', '2010-01-01', '2015-12-31'], ['الفترة 2', '2016-01-01', '2020-12-31'], ['الفترة 3', '2021-01-01', '9999']],
  fallbackIfStartAfter: '2010-03-01',
  criteria: { minTradesPerPeriod: 50, minProfitFactor: 1.2 },
  grid: { pivot: [2, 3, 5], rr: [2, 2.5, 3], minPositive: 7 },
  twelveData: { baseUrl: 'https://api.twelvedata.com/time_series', outputsize: 5000, pauseMs: 15000, from: '2009-11-01', maxPages: 60 },
  paths: { root: ROOT, data: path.join(ROOT, 'data'), logs: path.join(ROOT, 'logs') },
};

module.exports = { config, PIP };
