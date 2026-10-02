const mysql = require('mysql2/promise');

function createDatabasePool(config) {
  return mysql.createPool({
    ...config,
    waitForConnections: true
  });
}

async function healthCheck(pool) {
  await pool.query('SELECT 1');
  return true;
}

module.exports = { createDatabasePool, healthCheck };
