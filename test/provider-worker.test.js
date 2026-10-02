const test = require('node:test');
const assert = require('node:assert/strict');
const { createProviderWorker } = require('../src/workers/provider-worker');

function workerFor(payload, status = 200) {
  const writes = [];
  const pool = { query: async (...args) => { writes.push(args); return [[]]; } };
  const queueError = (code, message, httpStatus) => Object.assign(new Error(message), { code, status: httpStatus });
  const worker = createProviderWorker({
    pool,
    queueError,
    providerRetryable: (body, code) => body?.charged === false && (body.message_code === 'REQUEST_FAILED' || [500, 503].includes(code)),
    providerBaseUrl: 'https://example.test/api/v1',
    providerApiKey: 'test-key',
    fetchImpl: async () => ({ status, headers: new Headers(), text: async () => JSON.stringify(payload) })
  });
  return { worker, writes };
}

test('charged provider error is cached so repeated requests do not pay again', async () => {
  const { worker, writes } = workerFor({ success: false, charged: true, message_code: 'VERIFICATION_FAILED' }, 422);
  const result = await worker.run({ vehicle: 'UK07FL6670', jobId: 'charged-error' });
  assert.equal(result.status, 422);
  assert.equal(writes.length, 1);
});

test('non-charged provider error is not cached and remains retryable', async () => {
  const { worker, writes } = workerFor({ success: false, charged: false, message_code: 'REQUEST_FAILED' }, 400);
  await assert.rejects(() => worker.run({ vehicle: 'UK07FL6670', jobId: 'free-error' }), error => error.code === 'WAY2API_TRANSIENT');
  assert.equal(writes.length, 0);
});

test('charged HTTP 503 is not retried or cached as a free failure', async () => {
  const { worker, writes } = workerFor({ success: false, charged: true, message_code: 'PROVIDER_UNAVAILABLE' }, 503);
  const result = await worker.run({ vehicle: 'UK07FL6670', jobId: 'charged-503' });
  assert.equal(result.status, 503);
  assert.equal(writes.length, 1);
});
