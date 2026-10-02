function createVehicleRepository(pool) {
  return {
    async totals() {
      const [[row]] = await pool.query('SELECT COUNT(DISTINCT vehicle) AS vehicles, COUNT(*) AS records FROM vehicle_cache');
      return row;
    },
    async findAll() { const [rows] = await pool.query('SELECT vehicle, provider, response_json, fetched_at FROM vehicle_cache ORDER BY fetched_at DESC'); return rows; },
    async remove(vehicle) { const [result] = await pool.query('DELETE FROM vehicle_cache WHERE vehicle=?', [vehicle]); return result; },
    async findLatest(vehicle) { const [rows] = await pool.query('SELECT * FROM vehicle_cache WHERE vehicle=? ORDER BY fetched_at DESC LIMIT 1', [vehicle]); return rows[0] || null; },
    async save(vehicle, provider, responseJson, fetchedAt, lastRefreshAt = fetchedAt) { await pool.query('INSERT INTO vehicle_cache(vehicle,provider,response_json,fetched_at,last_refresh_at) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE response_json=VALUES(response_json),fetched_at=VALUES(fetched_at),last_refresh_at=VALUES(last_refresh_at)', [vehicle, provider, responseJson, fetchedAt, lastRefreshAt]); }
  };
}
module.exports = { createVehicleRepository };
