const fs = require('node:fs');
const path = require('node:path');
const baseUrl = (process.env.LOAD_TEST_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const vehicle = String(process.env.LOAD_TEST_VEHICLE || '').toUpperCase().replace(/\s+/g, '');
const email = process.env.TEST_ADMIN_EMAIL;
const password = process.env.TEST_ADMIN_PASSWORD;
const sizes = [1000, 3000, 5000];
let cookie = '';
const reports = [];
async function call(path, options = {}) {
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const started = performance.now(); const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text(); let body; try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
  return { status: response.status, body, ms: performance.now() - started };
}
function requireConfig() { if (!vehicle) throw new Error('Set LOAD_TEST_VEHICLE to a saved registration'); if (!email || !password) throw new Error('Set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD'); }
async function login() { const r = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); if (r.status !== 200 || r.body.authenticated !== true) throw new Error(`Admin login failed with HTTP ${r.status}`); }
async function assertCached() { const r = await call('/api/rc-lookup', { method: 'POST', body: JSON.stringify({ vehiclenumber: vehicle, provider: 'way2api' }) }); if (r.status !== 200) throw new Error(`Warm-up failed with HTTP ${r.status}`); if (r.body?._cache?.source !== 'mysql') throw new Error('Aborted: vehicle is not MySQL-cached; no load requests were sent.'); }
async function run(size) {
  const started = performance.now();
  const results = await Promise.all(Array.from({ length: size }, () => call('/api/rc-lookup', { method: 'POST', body: JSON.stringify({ vehiclenumber: vehicle, provider: 'way2api' }) }).catch(error => ({ error, ms: 0 }))));
  const elapsed = performance.now() - started, statuses = {}, errorTypes = {}; let cacheHits = 0, providerResponses = 0, errors = 0; const latencies = [];
  for (const r of results) { if (r.error) { errors++; const type = r.error.cause?.code || r.error.code || r.error.name || 'unknown'; errorTypes[type] = (errorTypes[type] || 0) + 1; continue; } statuses[r.status] = (statuses[r.status] || 0) + 1; latencies.push(r.ms); if (r.body?._cache?.source === 'mysql') cacheHits++; if (r.body?._cache?.source && r.body._cache.source !== 'mysql') providerResponses++; }
  latencies.sort((a, b) => a - b); const pct = p => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] || 0;
  const report = { requests: size, elapsedMs: Math.round(elapsed), requestsPerSecond: Number((size / (elapsed / 1000)).toFixed(2)), statuses, cacheHits, providerResponses, errors, errorTypes, p50Ms: Math.round(pct(.5)), p95Ms: Math.round(pct(.95)), p99Ms: Math.round(pct(.99)) }; reports.push(report); console.log(JSON.stringify(report));
}
(async () => { try { requireConfig(); console.log(`Local load test only: ${baseUrl} · vehicle ${vehicle}`); await login(); await assertCached(); for (const size of sizes) await run(size); const passed = reports.every(r => !r.errors && !r.providerResponses && r.cacheHits === r.requests && r.statuses[200] === r.requests); const result = { generatedAt: new Date().toISOString(), target: baseUrl, vehicle, providerCallsAllowed: false, result: passed ? 'PASS' : 'FAIL', runs: reports }; fs.writeFileSync(path.resolve(process.env.LOAD_TEST_RESULT_FILE || 'test/load-results.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8'); console.log('Saved test/load-results.json'); if (!passed) throw new Error('One or more concurrency levels had errors or non-cache responses.'); console.log('PASS: all 1,000/3,000/5,000 requests were MySQL-cache responses; no provider response observed.'); } catch (error) { const result = { generatedAt: new Date().toISOString(), target: baseUrl, vehicle, providerCallsAllowed: false, result: 'FAIL', runs: reports, error: error.message }; fs.writeFileSync(path.resolve(process.env.LOAD_TEST_RESULT_FILE || 'test/load-results.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8'); console.error(`FAIL: ${error.message}`); process.exitCode = 1; } })();
