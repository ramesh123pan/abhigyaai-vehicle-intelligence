function createAuthMiddleware({ readSession, unauthorized }) {
  const isAuthenticated = req => Boolean(readSession(req));
  const requireAuthentication = (req, res) => { if (isAuthenticated(req)) return true; unauthorized(res); return false; };
  return { isAuthenticated, requireAuthentication };
}
module.exports = { createAuthMiddleware };
