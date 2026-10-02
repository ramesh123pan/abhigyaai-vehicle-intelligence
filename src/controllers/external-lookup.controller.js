function createExternalLookupController({
  externalKey,
  validRegistration,
  pool,
  cacheTtlMs,
  queueProviderLookup,
  queueWaitMs,
  queueError,
  finalizeUsage,
  auditExternal,
  addExternalUsage,
  getExpiryRefreshDays,
  getResponseMessageOverrides,
  applyMessageOverride,
  send
}) {
  function expiredDocuments(payload) {
    const result = payload?.data?.result || payload?.result || {};
    const expired = keys => keys.some(key => { const value = result[key]; const time = value ? Date.parse(String(value)) : NaN; return Number.isFinite(time) && time < Date.now(); });
    return { pucc: expired(['pucc_upto','rc_pucc_upto']), insurance: expired(['insurance_upto','rc_insurance_upto']), registration: expired(['fit_up_to','rc_fit_upto','registration_upto','registration_expiry']) };
  }
  function pathFor(url) {
    return url.startsWith('/api/v1/') ? '/api/v1/external/rc/' : '/api/external/rc/';
  }

  async function lookup(req, res) {
    try {
      const key = await externalKey(req);
      if (key.error) return send(res, key.status || 401, applyMessageOverride(JSON.stringify({ success: false, message: key.error, message_code: key.status === 429 ? 'RATE_LIMITED' : (key.status === 403 ? 'INVALID_API_KEY' : 'MISSING_API_KEY'), charged: false }), await getResponseMessageOverrides()));
      const prefix = pathFor(req.url);
      const vehicle = decodeURIComponent(req.url.slice(prefix.length)).toUpperCase().replace(/\s+/g, '');
      if (!validRegistration(vehicle)) {
        await finalizeUsage(key.usageId, { vehicle, statusCode: 400, source: 'gateway', cacheHit: 0 });
        return send(res, 400, applyMessageOverride(JSON.stringify({ success: false, message: 'Invalid registration number', message_code: 'INVALID_INPUT', charged: false }), await getResponseMessageOverrides()));
      }
      await finalizeUsage(key.usageId, { vehicle });
      const [cached] = await pool.query('SELECT * FROM vehicle_cache WHERE vehicle=? ORDER BY fetched_at DESC LIMIT 1', [vehicle]);
      const entry = cached[0];
      let cachedPayload = null;
      if (entry) {
        try { cachedPayload = JSON.parse(entry.response_json); } catch { cachedPayload = null; }
      }
      // Legacy deployments may contain cached non-charged errors. They must
      // not block a fresh provider attempt, especially REQUEST_FAILED/backend_down.
      const now = Date.now();
      const cacheable = Boolean(entry && cachedPayload?.charged === true);
      const refreshDays = await getExpiryRefreshDays();
      const expired = expiredDocuments(cachedPayload);
      const expiryRefreshDue = cacheable && Object.entries(expired).some(([type, isExpired]) => isExpired && now - Number(entry.fetched_at) >= Number(refreshDays[type] || 7) * 86400000);
      if (cacheable && !expiryRefreshDue && now - Number(entry.fetched_at) < cacheTtlMs) {
        await finalizeUsage(key.usageId, { vehicle, source: 'mysql', statusCode: Number(cachedPayload.status_code) || 200, cacheHit: 1 });
        const payload = applyMessageOverride(JSON.stringify(Object.assign(cachedPayload, { _cache: { source: 'mysql', provider: entry.provider } })), await getResponseMessageOverrides());
        return send(res, Number(cachedPayload.status_code) || 200, await addExternalUsage(payload, key));
      }
      const queued = await queueProviderLookup(vehicle);
      let result;
      try {
        result = await Promise.race([
          queued.promise,
          new Promise((_, reject) => setTimeout(() => reject(queueError('LOOKUP_QUEUED', 'Lookup is still processing', 202)), queueWaitMs))
        ]);
      } catch (error) {
        if (error.code === 'LOOKUP_QUEUED') {
          await finalizeUsage(key.usageId, { vehicle, source: 'queue', statusCode: 202, cacheHit: 0 });
          return send(res, 202, applyMessageOverride(JSON.stringify({ success: false, status: 'PENDING', message: 'Lookup queued. Poll the job status before retrying.', message_code: 'LOOKUP_QUEUED', vehicle, job_id: queued.jobId || null }), await getResponseMessageOverrides()));
        }
        await finalizeUsage(key.usageId, { vehicle, source: 'gateway', statusCode: error.status || 503, cacheHit: 0 });
        return send(res, error.status || 503, applyMessageOverride(JSON.stringify({ success: false, message: error.message, message_code: error.code || 'QUEUE_FAILED', charged: false }), await getResponseMessageOverrides()));
      }
      const resultSource = result.fromCache ? 'mysql' : 'way2api';
      await finalizeUsage(key.usageId, { vehicle, source: resultSource, statusCode: result.status, cacheHit: result.fromCache ? 1 : 0 });
      try { await auditExternal(req, key.row, 'external_vehicle_searched', vehicle, { source: resultSource, usageId: key.usageId, statusCode: result.status, queue_joined: queued.joined }); }
      catch (error) { console.error('External audit logging failed:', error.code || 'ERROR', error.message); }
      return send(res, result.status, await addExternalUsage(applyMessageOverride(result.text, await getResponseMessageOverrides()), key), 'application/json; charset=utf-8');
    } catch (error) {
      console.error('External lookup failed:', error.code || 'ERROR', error.message);
      return send(res, error.status || 500, applyMessageOverride(JSON.stringify({ success: false, message: error.message || 'External lookup failed', message_code: error.code || 'EXTERNAL_LOOKUP_FAILED' }), await getResponseMessageOverrides()));
    }
  }

  return { lookup };
}

module.exports = { createExternalLookupController };
