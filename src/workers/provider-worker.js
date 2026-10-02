function createProviderWorker({ pool, queueError, providerRetryable, fetchImpl = globalThis.fetch, providerBaseUrl, providerApiKey }) {
  async function call(vehicle) {
    if (!providerApiKey) throw queueError('PROVIDER_NOT_CONFIGURED', 'Way2API is not configured', 500);
    const response = await fetchImpl(`${providerBaseUrl}/rc/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${providerApiKey}` },
      body: JSON.stringify({ rc_number: vehicle })
    });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch {}
    return { status: response.status, text, payload, headers: response.headers };
  }

  async function persist(vehicle, result, jobId) {
    // Only provider-confirmed charged responses belong in the vehicle cache.
    // A non-charged error must remain retryable and must never poison the cache.
    if (result.payload?.charged === true) {
      const now = Date.now();
      await pool.query('INSERT INTO vehicle_cache(vehicle,provider,response_json,fetched_at,last_refresh_at) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE response_json=VALUES(response_json),fetched_at=VALUES(fetched_at),last_refresh_at=VALUES(last_refresh_at)', [vehicle, 'way2api', result.text, now, now]);
    }
    return { ...result, jobId };
  }

  async function run(job) {
    const result = await call(job.vehicle);
    if (providerRetryable(result.payload, result.status) && !result.payload?.charged) throw queueError('WAY2API_TRANSIENT', 'Way2API transient failure', 503);
    return persist(job.vehicle, result, job.jobId || null);
  }

  return { call, persist, run };
}

module.exports = { createProviderWorker };
