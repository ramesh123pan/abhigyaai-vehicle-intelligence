# External RC lookup queue and retry plan

**Status:** Proposal for approval — no queue implementation is included in this document.

**Scope:** `/api/v1/external/rc/:registration`, Way2API provider calls, duplicate requests for the same vehicle, quota safety, overload protection, and operational visibility.

## 1. Recommendation

Use **Redis as the coordination store and BullMQ (or an equivalent Redis-backed worker library) as the job queue**.

Start with one queue and one worker process. Scale workers only after measuring provider latency, Redis health, database connection usage, and the configured Way2API limits.

### Why Redis/BullMQ is the right first choice

| Option | Strengths | Fit for this application | Decision |
|---|---|---|---|
| Redis + BullMQ | Fast queueing, delayed jobs, retries, concurrency controls, deduplication, rate limiting, job status | Directly solves provider throttling and same-RC single-flight requests | **Recommended** |
| RabbitMQ | Strong work-queue semantics, acknowledgements, routing, mature operations | Good alternative if RabbitMQ already exists in hosting; more components to operate | Not first choice |
| Kafka | Durable ordered event streams, replay, very high throughput, many consumers | Over-sized for one provider lookup workflow; request correlation and per-RC deduplication still need another store | Do not use initially |
| MySQL-only queue | No extra service and easy audit queries | Lock contention, delayed retry scheduling, and high-concurrency polling are less reliable | Fallback only |
| In-process memory queue | Simple local development | Jobs disappear on restart and cannot coordinate multiple instances | Never for production |

Redis is a performance component, not the source of truth. MySQL remains authoritative for vehicle cache, usage, billing, audit, and final job history.

## 2. Provider facts that drive the design

Way2API documents a limit of 5 RC verification requests per minute and 100 per day, with HTTP 429 and `Retry-After` when the limit is exceeded. It recommends backing off instead of tight retry loops. Successful verifications are charged and failed verifications are not charged. See [Way2API rate limits](https://app.way2api.com/documentation/vehicle-rc/rate-limits).

The integration must branch on `message_code` and `charged`, not HTTP status alone. In particular, `REQUEST_FAILED`, `RATE_LIMITED`, `INTERNAL_ERROR`, and `PROVIDER_UNAVAILABLE` are non-charged failures; `VERIFICATION_FAILED`, `NO_RECORD_FOUND`, `PROVIDER_NO_RESPONSE`, and `SOURCE_UNAVAILABLE` can be charged. See [Way2API error codes](https://app.way2api.com/documentation/vehicle-rc/errors).

## 3. End-to-end request flow

1. Validate and normalize the RC number before authentication quota consumption or provider access.
2. Authenticate the external API key and check the caller's application quota.
3. Read the MySQL vehicle cache.
4. If a fresh cache entry exists, return it immediately and do not enqueue a provider job.
5. If no usable cache entry exists, acquire a Redis single-flight lock keyed by normalized RC and provider.
6. If another request already owns that key, join its job and wait briefly for the same result; never start a second Way2API call for the same RC.
7. If this request owns the key, create one durable `provider_jobs` record and enqueue one Redis job.
8. The HTTP request waits up to a fixed budget, proposed as 8 seconds. If the job completes, return the normal RC response. If it is still queued or running, return `202 Accepted` with a `job_id`, status URL, and retry guidance.
9. The worker performs the provider call only after the provider limiter allows it.
10. The worker writes the result transactionally to MySQL, finalizes usage/audit metadata, releases the single-flight lock, and publishes the result to all waiting callers.

## 4. Same-RC concurrency behavior

For 100 users requesting `UP16SH0293` at the same time:

- one request creates the provider job;
- the other 99 requests join the same active job using the normalized RC key;
- only one Way2API call is made;
- when it completes, all joined requests receive the same stored result, subject to each caller's own API-key response and quota rules;
- subsequent requests use MySQL cache until the cache policy expires or an explicitly authorized refresh is allowed.

For 100 different RC numbers, requests are accepted into the bounded queue, but the worker sends them to Way2API at no more than the configured provider rate. The application must not convert 100 incoming requests into 100 immediate provider requests.

## 5. Retry policy

Retries are for provider transport/service failures only. They are not a general response retry.

### Safe automatic retry candidates

- `REQUEST_FAILED`, `charged: false`
- `PROVIDER_UNAVAILABLE`, `charged: false`
- `INTERNAL_ERROR`, `charged: false`
- network timeout or connection failure where no provider response was received, subject to an idempotency guard
- `RATE_LIMITED`, only after honoring `Retry-After` and only while the job deadline remains valid

### Never automatically retry

- invalid RC/input or authentication errors;
- quota/balance/access failures;
- `OK` or any successful response;
- `VERIFICATION_FAILED` and `NO_RECORD_FOUND`;
- `ACCEPTED` or `PROVIDER_NO_RESPONSE` unless a provider-specific status/poll contract is implemented;
- `SOURCE_UNAVAILABLE` by default because the provider documentation says this can be billed. It requires an explicit business approval before any repeat call.

### Limits

- maximum 2 retries after the first attempt;
- exponential backoff with jitter, for example 1–2 seconds then 4–8 seconds;
- absolute job deadline, proposed as 30 seconds;
- no retry of a job after it has been marked charged unless a human-approved reconciliation policy exists;
- persist every attempt and its `message_code`, HTTP status, `charged`, provider order ID, and timing.

This prevents a provider outage from creating a retry storm or repeated paid calls.

## 6. Queue capacity and user experience

Use separate limits for incoming work and provider work:

- **Queue capacity:** bounded, initially 500 waiting jobs or a value approved from load testing.
- **Provider concurrency:** initially 1 worker for the 5/minute Way2API limit.
- **Per-key application rate:** enforce the configured site-key limit before enqueueing.
- **Queue-full response:** HTTP 503 with `Retry-After`, `message_code: QUEUE_FULL`, and no provider charge.
- **Queued response:** HTTP 202 with `message_code: LOOKUP_QUEUED`, `job_id`, `status_url`, and an estimated state, not a fake vehicle result.
- **Client polling:** status endpoint with a minimum polling interval; do not make clients repeatedly call the paid lookup endpoint.
- **Cancellation:** allow cancellation only while waiting; never cancel a provider call after it has started unless the provider contract supports it.

Suggested status endpoint:

```http
GET /api/v1/external/jobs/{job_id}
X-API-Key: vdesk_your_key
```

It returns `queued`, `running`, `completed`, `failed`, or `expired`, plus safe error metadata. It never exposes provider credentials.

## 7. Circuit breaker

Add a provider circuit breaker around the worker:

- open after 3 consecutive safe transient failures;
- remain open for 30 seconds, then allow one probe;
- close after a successful probe;
- while open, do not call Way2API; return/queue a non-charged provider-unavailable response;
- do not open the circuit for invalid input, no-record, verification failures, or charged outcomes.

The breaker is a protection mechanism, not a replacement for the queue. Its state should be in Redis so multiple workers agree.

## 8. Database model

Add a `provider_jobs` table with at least:

- `id`, public-safe `job_id`, normalized `vehicle`, `provider`;
- `state`, `attempt_count`, `max_attempts`;
- `next_attempt_at`, `started_at`, `completed_at`, `expires_at`;
- `http_status`, `message_code`, `charged`, `order_id`;
- `error_message` (sanitized), `result_cache_id`, `created_by_key_id`;
- timestamps and indexes on `(vehicle, provider, state)` and `(job_id)`.

Add a unique active-job constraint or transactionally enforced equivalent for `(vehicle, provider)` while state is `queued` or `running`. The worker must use an idempotent upsert so a redelivered Redis job cannot duplicate a cache write or billing/usage entry.

Redis keys:

- `rc:singleflight:{provider}:{normalized_rc}` — short TTL lock;
- `rc:job:{job_id}` — transient status/result pointer;
- `rc:provider:limiter` — sliding-window/token limiter;
- `rc:provider:breaker` — circuit state.

## 9. Charging and usage rules

There are two different accounting questions and they must not be mixed:

1. **Provider billing:** one actual Way2API call can create at most one provider charge.
2. **Customer quota:** the product must define whether joined callers are charged individually or whether one shared lookup consumes one quota unit. Recommended policy: each accepted external request consumes the caller's quota once, but joined requests do not create additional provider charges. This policy must be shown in API documentation and audit logs.

For every request, record `cache_hit`, `provider_call_id/job_id`, `provider_attempt_count`, `charged`, `source`, and final status. A queue retry with `charged: false` must not decrement customer quota a second time.

## 10. Observability and admin controls

Add metrics and dashboard fields for:

- queue depth, oldest queued job age, running jobs;
- provider calls/minute and calls/day;
- cache hits, single-flight joins, provider calls avoided;
- retry count by error code;
- charged vs non-charged outcomes;
- p50/p95/p99 completion time;
- queue-full, timeout, circuit-open, and dead-letter counts.

Add an admin queue view with search/filter by RC, job ID, API key, state, error code, charged flag, and time. Provide safe actions to retry only eligible non-charged jobs, mark a job reviewed, and inspect the full audit trail.

## 11. Dead-letter and recovery policy

After the retry/deadline limit, move the job to a dead-letter state. Do not silently retry forever. Preserve the original error and provider response metadata. An administrator can requeue only when the result is confirmed non-charged and the provider outage has cleared.

On process restart:

- Redis jobs remain available;
- jobs stuck in `running` beyond a lease timeout are requeued once;
- MySQL remains the source of truth for completed results;
- a cache row already present wins over re-running the provider call.

## 12. Testing and approval gates

Before production enablement, automated tests must cover:

1. malformed RC rejected before queue/provider access;
2. cache hit creates no job/provider call;
3. 100 identical concurrent RC requests produce one provider call;
4. 100 different RCs respect the provider limiter;
5. transient failure succeeds on retry;
6. transient failure exhausts retries without cache pollution;
7. charged failure is cached and never blindly retried;
8. 429 honors `Retry-After`;
9. queue full returns 503 and no charge;
10. 202 job status transitions and polling authorization;
11. worker restart/re-delivery is idempotent;
12. usage, audit, cache, and provider-attempt records are complete;
13. circuit breaker opens, probes, and closes;
14. load test at the approved concurrency and queue size.

Approval is required for:

- Redis hosting and persistence policy;
- queue capacity and worker count;
- 8-second synchronous wait and 30-second job deadline;
- whether joined callers each consume customer quota;
- whether `SOURCE_UNAVAILABLE` may ever be retried;
- production alert thresholds and admin retry permissions.

## 13. Implementation phases after approval

### Phase 1 — foundations

Create the job table, provider-call service abstraction, error classifier, idempotency rules, metrics fields, and unit tests. Keep the existing synchronous path behind a feature flag.

### Phase 2 — Redis queue

Add Redis connection health checks, queue/worker, single-flight locking, provider limiter, retry/backoff, circuit breaker, and job status endpoint.

### Phase 3 — gateway integration

Route cache misses through the queue, add 202/503 responses, preserve the existing response contract, and update API documentation.

### Phase 4 — verification

Run concurrency/load tests, test provider fault simulations, verify MySQL records and billing safety, then enable for one API key before gradual rollout.

### Phase 5 — production operations

Configure Redis persistence/monitoring, alerts, dead-letter review, backup/recovery, and worker scaling. Kafka can be reconsidered later only if the product needs multiple independent event consumers, replayable event history, or sustained throughput far beyond the provider's limits.

