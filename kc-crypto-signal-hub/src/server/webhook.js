// خادم استقبال تنبيهات TradingView. هذا الملف يُنشئ الخادم فقط ولا يشغّله:
// التشغيل يحدث فقط من أمر المراقبة الحية بعد موافقتك الصريحة.
const http = require('http');
const { validateAlert } = require('./validator');

const MAX_BYTES = 10 * 1024;

function createWebhookHandler({ secret, allowedPairs, onAlert }) {
  return (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || req.url !== '/webhook') return reply(404, { error: 'not found' });

    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        aborted = true;
        reply(413, { error: 'too large' });
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return reply(400, { error: 'invalid json' });
      }
      const v = validateAlert(body, { secret, allowedPairs });
      if (!v.ok) return reply(v.status, { error: v.error });
      reply(202, { accepted: v.pair });
      onAlert(v.pair);
    });
  };
}

const createWebhookServer = (options) => http.createServer(createWebhookHandler(options));

module.exports = { createWebhookHandler, createWebhookServer, MAX_BYTES };
