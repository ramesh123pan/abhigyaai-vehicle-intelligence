function createLookupController({ pool, readJson, validRegistration, cacheTtlMs, refreshCooldownMs, getExpiryRefreshDays, getResponseMessageOverrides, applyMessageOverride, audit, send, fetchImpl = globalThis.fetch }) {
  function expiredDocuments(payload) { const result = payload?.data?.result || payload?.result || {}; const expired = keys => keys.some(key => { const value = result[key]; const time = value ? Date.parse(String(value)) : NaN; return Number.isFinite(time) && time < Date.now(); }); return { pucc: expired(['pucc_upto','rc_pucc_upto']), insurance: expired(['insurance_upto','rc_insurance_upto']), registration: expired(['fit_up_to','rc_fit_upto','registration_upto','registration_expiry']) }; }
  return { async lookup(req, res) { try {
    const payload = await readJson(req), vehicle = String(payload.vehiclenumber || '').toUpperCase().replace(/\s+/g, '');
    if (!validRegistration(vehicle)) return send(res, 400, applyMessageOverride(JSON.stringify({ success: false, message: 'Invalid registration number. Use the four-digit final series, for example UP16AN0593.', message_code: 'INVALID_INPUT', charged: false }), await getResponseMessageOverrides()));
    const provider = payload.provider === 'lorryinfo' ? 'lorryinfo' : 'way2api', [rows] = await pool.query('SELECT * FROM vehicle_cache WHERE vehicle = ? ORDER BY fetched_at DESC LIMIT 1', [vehicle]), entry = rows[0], now = Date.now();
    let cachedPayload = null; try { if (entry) cachedPayload = JSON.parse(entry.response_json); } catch {}
    const refreshDays = await getExpiryRefreshDays();
    const cacheable = entry && (entry.provider !== 'way2api' || cachedPayload?.charged === true);
    const expired = expiredDocuments(cachedPayload), expiryRefreshDue = cacheable && Object.entries(expired).some(([type, isExpired]) => isExpired && now - Number(entry.fetched_at) >= Number(refreshDays[type] || 7) * 86400000);
    if (!payload.forceRefresh && cacheable && !expiryRefreshDue && now - Number(entry.fetched_at) < cacheTtlMs) { await audit(req, 'vehicle_searched', vehicle, { source: 'mysql', provider: entry.provider }); return send(res, Number(cachedPayload.status_code) || 200, JSON.stringify({ ...cachedPayload, _cache: { source: 'mysql', provider: entry.provider, fetchedAt: new Date(Number(entry.fetched_at)).toISOString() } })); }
    if (payload.forceRefresh && entry && now - Number(entry.last_refresh_at) < refreshCooldownMs) return send(res, 429, JSON.stringify({ message: 'Refresh is limited to once every 7 days for this vehicle.' }));
    const isWay2Api = provider === 'way2api', apiKey = isWay2Api ? process.env.WAY2API_API_KEY : process.env.LORRYINFO_API_KEY;
    if (!apiKey) return send(res, 500, JSON.stringify({ message: `Missing ${isWay2Api ? 'WAY2API_API_KEY' : 'LORRYINFO_API_KEY'} in .env` }));
    const url = isWay2Api ? `${process.env.WAY2API_BASE_URL || 'https://app.way2api.com/api/v1'}/rc/verify` : 'https://api.lorryinfo.com/api/v1/RCbyNumber_1';
    const headers = isWay2Api ? { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` } : { 'Content-Type': 'application/json', 'x-api-key': apiKey };
    const upstream = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(isWay2Api ? { rc_number: vehicle } : { vehiclenumber: vehicle }) }), responseText = await upstream.text();
    const responseBody = applyMessageOverride(responseText, await getResponseMessageOverrides());
    if (upstream.ok) { await pool.query('INSERT INTO vehicle_cache (vehicle, provider, response_json, fetched_at, last_refresh_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE response_json=VALUES(response_json), fetched_at=VALUES(fetched_at), last_refresh_at=VALUES(last_refresh_at)', [vehicle, provider, responseBody, now, now]); await audit(req, payload.forceRefresh ? 'vehicle_refreshed' : 'vehicle_saved', vehicle, { provider, source: 'api' }); }
    return send(res, upstream.status, responseBody, upstream.headers.get('content-type') || 'application/json; charset=utf-8');
  } catch (error) { return send(res, 502, JSON.stringify({ message: error.message })); } } };
}
module.exports = { createLookupController };
