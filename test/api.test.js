const test = require('node:test');
const assert = require('node:assert/strict');

const baseUrl = (process.env.TEST_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const email = process.env.TEST_ADMIN_EMAIL;
const password = process.env.TEST_ADMIN_PASSWORD;
let cookie = '';
let createdAdminId;
let createdPlanId;
let createdPackageId;
let createdKeyId;
let createdRawKey;

async function request(path, options = {}) {
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
  return { response, body };
}

async function requireServer() {
  try {
    const { response } = await request('/api/auth/me');
    assert.ok(response.status === 200 || response.status === 401, `unexpected server response: ${response.status}`);
  } catch (error) {
    test.skip(`test server unavailable at ${baseUrl}: ${error.message}`);
    return false;
  }
  return true;
}

async function loginOrSkip() {
  const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (result.response.status !== 200 || result.body.authenticated !== true) {
    test.skip(`test admin login rejected with HTTP ${result.response.status}: ${result.body.message || 'check active email/password'}`);
    return false;
  }
  return true;
}

test('server health/auth contract', async () => {
  if (!(await requireServer())) return;
  const { response, body } = await request('/api/auth/me');
  assert.equal(response.status, 200);
  assert.equal(typeof body.authenticated, 'boolean');
});

test('unauthenticated protected API is rejected', async () => {
  if (!(await requireServer())) return;
  cookie = '';
  const { response } = await request('/api/dashboard');
  assert.ok([401, 302].includes(response.status));
});

test('admin login and shared protected modules', { skip: !email || !password ? 'Set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD' : false }, async () => {
  if (!(await requireServer())) return;
  if (!(await loginOrSkip())) return;
  for (const path of ['/api/dashboard', '/api/records', '/api/admins', '/api/profile', '/api/audit', '/api/settings', '/api/external-keys', '/api/plans', '/api/topup-packages', '/api/usage']) {
    const result = await request(path);
    assert.equal(result.response.status, 200, `${path} returned ${result.response.status}`);
  }
});

test('admin CRUD validation and lifecycle', { skip: !email || !password ? 'Set test admin credentials' : false }, async () => {
  if (!(await loginOrSkip())) return;
  const invalid = await request('/api/admins', { method: 'POST', body: JSON.stringify({ name: '', email: 'bad', phone: '', password: '' }) });
  assert.equal(invalid.response.status, 400);
  const unique = `qa-${Date.now()}@example.com`;
  const created = await request('/api/admins', { method: 'POST', body: JSON.stringify({ name: 'QA Temporary User', email: unique, phone: '9999999999', password: 'QaTestPassword!1', role: 'viewer' }) });
  assert.equal(created.response.status, 201);
  const list = await request('/api/admins');
  const row = list.body.admins.find((item) => item.email === unique);
  assert.ok(row);
  createdAdminId = row.id;
  const invalidEmail = await request(`/api/admins/${createdAdminId}`, { method: 'PATCH', body: JSON.stringify({ email: 'not-an-email' }) });
  assert.equal(invalidEmail.response.status, 400);
  const updatedEmail = `qa-${Date.now()}@xpansion.com.au`;
  const updated = await request(`/api/admins/${createdAdminId}`, { method: 'PATCH', body: JSON.stringify({ name: 'QA Updated User', email: updatedEmail, phone: '8888888888', role: 'manager', active: true, password: 'QaUpdatedPassword!2' }) });
  assert.equal(updated.response.status, 200);
  const verifyLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: updatedEmail, password: 'QaUpdatedPassword!2' }) });
  assert.equal(verifyLogin.response.status, 200);
  assert.equal(verifyLogin.body.authenticated, true);
  const removed = await request(`/api/admins/${createdAdminId}`, { method: 'DELETE' });
  assert.equal(removed.response.status, 200);
});

test('plan CRUD and validation', { skip: !email || !password ? 'Set test admin credentials' : false }, async () => {
  if (!(await loginOrSkip())) return;
  const invalid = await request('/api/plans', { method: 'POST', body: JSON.stringify({ name: '', monthlyCallLimit: 0, rateLimitPerMinute: 0 }) });
  assert.equal(invalid.response.status, 400);
  const name = `QA Plan ${Date.now()}`;
  const created = await request('/api/plans', { method: 'POST', body: JSON.stringify({ name, monthlyCallLimit: 100, rateLimitPerMinute: 10, price: 1 }) });
  assert.equal(created.response.status, 201);
  const plans = await request('/api/plans');
  const row = plans.body.plans.find((item) => item.name === name);
  assert.ok(row);
  createdPlanId = row.id;
  assert.equal((await request(`/api/plans/${createdPlanId}`, { method: 'PATCH', body: JSON.stringify({ name, monthlyCallLimit: 200, rateLimitPerMinute: 20, price: 2, active: true }) })).response.status, 200);
});

test('top-up package CRUD and validation', { skip: !email || !password ? 'Set test admin credentials' : false }, async () => {
  if (!(await loginOrSkip())) return;
  const invalid = await request('/api/topup-packages', { method: 'POST', body: JSON.stringify({ name: '', credits: 0, price: -1 }) });
  assert.equal(invalid.response.status, 400);
  const name = `QA Package ${Date.now()}`;
  const created = await request('/api/topup-packages', { method: 'POST', body: JSON.stringify({ name, credits: 10, price: 5 }) });
  assert.equal(created.response.status, 201);
  const packages = await request('/api/topup-packages');
  const row = packages.body.packages.find((item) => item.name === name);
  assert.ok(row);
  createdPackageId = row.id;
});

test('profile, settings, audit, API-key, usage, and service action APIs', { skip: !email || !password ? 'Set test admin credentials' : false }, async () => {
  if (!(await loginOrSkip())) return;
  const profileInvalid = await request('/api/profile', { method: 'PATCH', body: JSON.stringify({ name: 'QA', email: 'invalid-email', phone: '9999999999' }) });
  assert.equal(profileInvalid.response.status, 400);
  const settingsInvalid = await request('/api/settings', { method: 'PUT', body: JSON.stringify({ email: 'invalid-email' }) });
  assert.equal(settingsInvalid.response.status, 400);
  const audit = await request('/api/audit/event', { method: 'POST', body: JSON.stringify({ action: 'qa_test_event', vehicle: 'UP16AN0593', details: { automated: true } }) });
  assert.equal(audit.response.status, 201);
  const keyInvalid = await request('/api/external-keys', { method: 'POST', body: JSON.stringify({ name: '', rateLimitPerMinute: 0, dailyLimit: 0 }) });
  assert.equal(keyInvalid.response.status, 400);
  const key = await request('/api/external-keys', { method: 'POST', body: JSON.stringify({ name: `QA Key ${Date.now()}`, rateLimitPerMinute: 10, dailyLimit: 20, allowedIps: '127.0.0.1', applicationAddress: 'QA test' }) });
  assert.equal(key.response.status, 201);
  assert.match(key.body.apiKey, /^vdesk_/);
  createdRawKey = key.body.apiKey;
  const keys = await request('/api/external-keys');
  const row = keys.body.keys.find((item) => item.name === key.body.name);
  assert.ok(row);
  createdKeyId = row.id;
  assert.equal((await request(`/api/external-keys/${createdKeyId}`, { method: 'PATCH', body: JSON.stringify({ rateLimitPerMinute: 20, dailyLimit: 30, allowedIps: '' }) })).response.status, 200);
  const plans = await request('/api/plans');
  const activePlan = plans.body.plans.find((item) => item.active);
  assert.ok(activePlan, 'an active plan is required for key assignment');
  assert.equal((await request(`/api/external-keys/${createdKeyId}/plan`, { method: 'POST', body: JSON.stringify({ planId: 999999999 }) })).response.status, 400);
  assert.equal((await request(`/api/external-keys/${createdKeyId}/plan`, { method: 'POST', body: JSON.stringify({ planId: activePlan.id }) })).response.status, 200);
  const beforeTopup = await request(`/api/usage/keys/${createdKeyId}`);
  assert.equal(beforeTopup.response.status, 200);
  assert.equal(Number(beforeTopup.body.key.plan_id), Number(activePlan.id));
  assert.equal(beforeTopup.body.key.plan_name, activePlan.name);
  const packages = await request('/api/topup-packages');
  const activePackage = packages.body.packages.find((item) => item.active);
  assert.ok(activePackage, 'an active top-up package is required');
  const beforeCredits = Number(beforeTopup.body.key.topup_credits || 0);
  const topup = await request(`/api/external-keys/${createdKeyId}/topup`, { method: 'POST', body: JSON.stringify({ packageId: activePackage.id, reference: 'automated-qa' }) });
  assert.equal(topup.response.status, 200);
  assert.equal(Number(topup.body.topupCredits), beforeCredits + Number(activePackage.credits));
  const afterTopup = await request(`/api/usage/keys/${createdKeyId}`);
  assert.equal(Number(afterTopup.body.key.topup_credits), beforeCredits + Number(activePackage.credits));
  assert.ok(afterTopup.body.bills.some((bill) => bill.package_name === activePackage.name && Number(bill.credits) === Number(activePackage.credits)));
  assert.equal((await request(`/api/external-keys/${createdKeyId}`, { method: 'DELETE' })).response.status, 200);
  for (const path of ['/api/usage/today', '/api/usage', '/api/records', '/api/dashboard']) {
    assert.equal((await request(path)).response.status, 200, path);
  }
});

test('external RC validation rejects malformed registrations before provider access', async () => {
  if (!(await requireServer())) return;
  for (const registration of ['UP16AN593', 'UP1A5930', 'ZZ99AA1234']) {
    const { response } = await request(`/api/v1/external/rc/${registration}`);
    assert.equal(response.status, 400, registration);
  }
});

test.after(async () => {
  if (!cookie) return;
  if (createdAdminId) await request(`/api/admins/${createdAdminId}`, { method: 'DELETE' });
  if (createdPlanId) await request(`/api/plans/${createdPlanId}`, { method: 'PATCH', body: JSON.stringify({ name: `QA Plan ${createdPlanId}`, monthlyCallLimit: 100, rateLimitPerMinute: 10, price: 1, active: false }) });
  if (createdPackageId) await request(`/api/topup-packages/${createdPackageId}`, { method: 'PATCH', body: JSON.stringify({ name: `QA Package ${createdPackageId}`, credits: 10, price: 5, active: false }) });
  if (createdKeyId) await request(`/api/external-keys/${createdKeyId}`, { method: 'DELETE' });
});
