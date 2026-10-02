function createSystemRoutes({ send, jsonError, healthCheck }) {
  return (req, res) => {
    const pathOnly = req.url.split('?')[0];
    if (req.method === 'GET' && pathOnly === '/health/live') {
      send(res, 200, JSON.stringify({ status: 'ok', service: 'vehicle-desk' }));
      return true;
    }
    if (req.method === 'GET' && pathOnly === '/health/ready') {
      healthCheck().then(() => send(res, 200, JSON.stringify({ status: 'ready' }))).catch(() => jsonError(res, 503, 'Database is unavailable', 'DATABASE_UNAVAILABLE'));
      return true;
    }
    return false;
  };
}
module.exports = { createSystemRoutes };
