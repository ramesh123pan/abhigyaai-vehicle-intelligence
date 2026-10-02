function createUsageDetailController({ pool, repository, send, exportUsage }) {
  return {
    async get(req, res, id, format) {
      try {
        const [[key]] = await pool.query('SELECT k.id,k.name,k.active,k.expires_at,k.application_url,k.application_address,k.plan_id,k.topup_credits,p.name AS plan_name,p.monthly_call_limit,p.price FROM external_api_keys k LEFT JOIN api_plans p ON p.id=k.plan_id WHERE k.id=?', [id]);
        if (!key) return send(res, 404, JSON.stringify({ message: 'API key not found' }));
        const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
        const used = await repository.countMonthly(id, monthStart);
        const months = await repository.monthlyTotals(id);
        const recent = await repository.recentForKey(id);
        const bills = await repository.topupBills(id);
        if (format) return exportUsage(res, format, key, recent);
        return send(res, 200, JSON.stringify({ key: { ...key, used }, months, bills, recent }));
      } catch (error) {
        return send(res, 500, JSON.stringify({ message: 'Unable to load key details' }));
      }
    }
  };
}

module.exports = { createUsageDetailController };
