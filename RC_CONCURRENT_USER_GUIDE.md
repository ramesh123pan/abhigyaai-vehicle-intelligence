# Concurrent RC lookup user guide

This guide shows how five different users can request the same registration at the same time and how to inspect the JSON responses.

## Prerequisites

1. Start Docker Desktop.
2. Start Redis:

```powershell
docker start rc-lorryinfo-redis
```

3. Confirm Redis:

```powershell
Test-NetConnection 127.0.0.1 -Port 6379
docker exec rc-lorryinfo-redis redis-cli ping
```

4. Ensure `.env.test` contains a generated application/site key:

```dotenv
TEST_EXTERNAL_API_KEY=your-generated-site-key
```

Do not use `WAY2API_API_KEY` as the site key.

## Start a Redis-enabled test server

Use a free port when port 4173 is already occupied:

```powershell
$env:PORT='4174'
$env:REDIS_URL='redis://127.0.0.1:6379'
$env:EXTERNAL_QUEUE_ENABLED='true'
node server.js
```

Confirm startup contains:

```text
External queue: Redis/BullMQ worker enabled
```

## Send five simultaneous requests

Open another PowerShell window in the project directory:

```powershell
$line=Get-Content .env.test | Where-Object {$_ -match '^TEST_EXTERNAL_API_KEY='}
$env:TEST_EXTERNAL_API_KEY=$line.Substring('TEST_EXTERNAL_API_KEY='.Length)
@'
const registration = 'HR02AH0041';
const endpoint = `http://127.0.0.1:4174/api/v1/external/rc/${registration}`;
const started = Date.now();
const results = await Promise.all([1,2,3,4,5].map(async requestNumber => {
  const response = await fetch(endpoint, {
    headers: { 'X-API-Key': process.env.TEST_EXTERNAL_API_KEY, accept: 'application/json' }
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { parseError: true }; }
  return {
    requestNumber,
    httpStatus: response.status,
    jsonValid: !body.parseError,
    success: body.success ?? null,
    messageCode: body.message_code ?? null,
    cacheSource: body._cache?.source ?? null,
    orderId: body.order_id ?? body.data?.order_id ?? null,
    charged: body.charged ?? null,
    vehicleStatus: body.data?.result?.rc_status ?? null,
    elapsedMs: Date.now() - started
  };
}));
console.log(JSON.stringify({ registration, results }, null, 2));
'@ | node
```

`Promise.all` starts all five HTTP requests concurrently. It does not wait for request 1 before starting request 2.

## How to interpret results

| Result | Meaning |
|---|---|
| `200` with `_cache.source: mysql` | Served from the local MySQL cache; no live provider call was needed. |
| `200` without `_cache` and `message_code: OK` | Usually a live provider response; verify usage/audit/provider metrics before claiming this. |
| `202` with `message_code: LOOKUP_QUEUED` | The request is waiting in the queue; retry using the returned job guidance. |
| `429` with quota/rate-limit message | The API key limit protected the provider; this is expected when quota or rate windows are exhausted. |
| `401` | Missing or invalid application/site API key. |
| `503` with `QUEUE_FULL` | Queue capacity was reached; no provider call should be made. |
| `500` | Unexpected application error; inspect server logs and do not treat the request as successful. |

## Test result for HR02AH0041

The first five-request run found one queue error caused by an incorrect BullMQ API call (`QueueEvents.waitUntilFinished`), while four requests returned the same successful provider result. That bug was fixed by using `job.waitUntilFinished(queueEvents, timeout)`.

The follow-up five-request run found four HTTP 200 cache responses and one HTTP 429 response. The 429 body was:

```json
{"success":false,"message":"Monthly plan quota exceeded"}
```

The four successful responses were valid JSON, reported `ACTIVE`, had valid expiry statuses, and shared the same provider order ID. They were served from the local MySQL cache. The test did not make a new live provider call because this registration was already cached and the API key quota was exhausted.

The queue implementation now uses a Redis single-flight lock. On a cache miss, the first request owns the lock and creates one BullMQ job; other requests wait for the MySQL cache result or receive a bounded `202` response. Definitive one-provider-call accounting still requires checking usage/audit/provider metrics.

## Fresh-cache result for UK17W2900

Before testing, `UK17W2900` had zero cache rows and zero usage rows. Five simultaneous requests returned HTTP 200 with valid JSON, `OK`, `ACTIVE`, valid expiry statuses, and the same provider order ID. One MySQL cache row was created. The initial usage audit labeled all five rows `way2api` because joined results were not distinguished from the owner result; that attribution defect was fixed afterward. Future runs record joined cache results as `source=mysql` and `cache_hit=1`. The historical rows remain unchanged.

## Database usage audit for HR02AH0041

The durable `api_usage_logs` audit showed:

| Source | Rows | Meaning |
|---|---:|---|
| `way2api` | 4 | Four live provider rows from the first pre-fix burst |
| `mysql` | 4 | Four local-cache responses from the follow-up burst |
| incomplete/null source | 1 | The request that hit the BullMQ completion-method bug |
| `queue` | 0 | The queue-pending response was not reached in this run |

The quota-rejected request did not create a usage row. The four live rows happened before the Redis single-flight/BullMQ fix was completed; they are evidence of the old behavior, not the expected behavior after the fix. The fixed design should be verified with a fresh cache-miss registration and a new usage audit.
