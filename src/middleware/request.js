function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => { let body = ''; let bytes = 0; req.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) { reject(Object.assign(new Error('Request body too large'), { code: 'BODY_TOO_LARGE' })); req.destroy(); return; } body += chunk; }); req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (error) { reject(error); } }); req.on('error', reject); });
}
function applyRequestTimeout(req, res, timeoutMs, onTimeout) { req.setTimeout(timeoutMs, () => { if (!res.headersSent) onTimeout(); req.destroy(); }); }
module.exports = { readJson, applyRequestTimeout };
