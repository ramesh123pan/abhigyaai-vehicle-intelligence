const crypto = require('crypto');

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '')
    .split(';')
    .map(value => value.trim().split('=').map(decodeURIComponent))
    .filter(value => value.length === 2));
}

function createSessionCookie(session, secret, ttlMs) {
  const payload = Buffer.from(JSON.stringify({ ...session, expires: Date.now() + ttlMs }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readSession(req, secret) {
  const token = parseCookies(req).rc_session || '';
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(session.expires) >= Date.now() ? session : null;
  } catch {
    return null;
  }
}

module.exports = { parseCookies, createSessionCookie, readSession };
