const crypto = require('crypto');

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

module.exports = {
  port: numberEnv('PORT', 4173),
  cacheTtlMs: 30 * 24 * 60 * 60 * 1000,
  refreshCooldownMs: 7 * 24 * 60 * 60 * 1000,
  sessionTtlMs: 8 * 60 * 60 * 1000,
  requestTimeoutMs: numberEnv('REQUEST_TIMEOUT_MS', 30000),
  bodyLimitBytes: numberEnv('REQUEST_BODY_LIMIT_BYTES', 2 * 1024 * 1024),
  keepAliveTimeoutMs: numberEnv('KEEP_ALIVE_TIMEOUT_MS', 5000),
  headersTimeoutMs: numberEnv('HEADERS_TIMEOUT_MS', 10000),
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  queueEnabled: String(process.env.EXTERNAL_QUEUE_ENABLED || 'true').toLowerCase() !== 'false',
  redisUrl: process.env.REDIS_URL || '',
  queueWaitMs: numberEnv('EXTERNAL_QUEUE_WAIT_MS', 8000),
  queueDeadlineMs: numberEnv('EXTERNAL_QUEUE_DEADLINE_MS', 30000),
  queueMaxWaiting: numberEnv('EXTERNAL_QUEUE_MAX_WAITING', 500),
  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: numberEnv('MYSQL_PORT', 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'lorryinfo',
    connectionLimit: numberEnv('MYSQL_CONNECTION_LIMIT', 10)
  }
};
