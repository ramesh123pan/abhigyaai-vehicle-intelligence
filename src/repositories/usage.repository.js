function createUsageRepository(pool) {
  return {
    async countMonthly(apiKeyId, monthStart) {
      const [[row]] = await pool.query('SELECT COUNT(*) AS used FROM api_usage_logs WHERE api_key_id=? AND created_at>=?', [apiKeyId, monthStart]);
      return Number(row?.used || 0);
    },
    async recentForKey(apiKeyId, limit = 100) {
      const [rows] = await pool.query('SELECT vehicle,endpoint,status_code,cache_hit,client_ip,forwarded_for,user_agent,device_type,accept_language,referer,request_host,location_status,created_at FROM api_usage_logs WHERE api_key_id=? ORDER BY id DESC LIMIT ?', [apiKeyId, Number(limit)]);
      return rows;
    },
    async monthlyTotals(apiKeyId) {
      const [rows] = await pool.query("SELECT DATE_FORMAT(created_at,'%Y-%m') AS month,COUNT(*) AS calls,SUM(cache_hit) AS cache_hits FROM api_usage_logs WHERE api_key_id=? GROUP BY month ORDER BY month DESC", [apiKeyId]);
      return rows;
    },
    async topupBills(apiKeyId, limit = 100) {
      const [rows] = await pool.query('SELECT id,package_name,credits,amount,reference,created_at FROM api_topup_ledger WHERE api_key_id=? ORDER BY id DESC LIMIT ?', [apiKeyId, Number(limit)]);
      return rows;
    }
  };
}

module.exports = { createUsageRepository };
