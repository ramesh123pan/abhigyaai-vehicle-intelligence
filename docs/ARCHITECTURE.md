# Vehicle Desk architecture

## Current design

Vehicle Desk is a modular monolith: one Node.js process serves the browser shell, JSON APIs, authentication, MySQL access, provider integration, and static assets. The browser uses HTML, CSS, and vanilla JavaScript. MySQL is the durable system of record; Redis/BullMQ is an optional shared queue for cache misses and provider work.

The modular conversion is implemented under `src/`:

```text
src/
  config/runtime.js                 runtime settings and environment parsing
  infrastructure/database.js       MySQL pool and readiness probe
  security/session.js               cookie parsing and signed session tokens
  services/vehicle.service.js       registration validation and expiry normalization
  workers/provider-worker.js        provider call, retry classification, and cache persistence
  middleware/request.js              request body limits and timeout handling
  middleware/auth.js                reusable protected-route guard
  middleware/error-handler.js       consistent error response helper
  routes/system.routes.js            liveness and readiness routes
  repositories/vehicle.repository.js vehicle-cache persistence boundary
  repositories/usage.repository.js   usage history and top-up bill reads
  controllers/vehicle.controller.js  records and vehicle-deletion HTTP actions
  controllers/auth.controller.js     session check and logout actions
  controllers/admin.controller.js    admin creation and listing
  controllers/plan.controller.js     plans and top-up package CRUD
  controllers/profile.controller.js profile and password actions
  controllers/settings.controller.js settings and public-branding actions
  controllers/api-key.controller.js  external API-key lifecycle actions
  controllers/usage.controller.js    usage summary and daily count actions
  controllers/audit.controller.js    audit listing and event creation
```

`server.js` is the current HTTP composition root. All business API routes dispatch to controllers under `src/controllers`; it retains startup schema initialization, queue wiring, middleware composition, and static-file routing.

The design is layered inside the monolith:

```text
Browser / external API client
        |
HTTP routing and response helpers
        |
Authentication, validation, quota and rate-limit guards
        |
Vehicle, usage, plan and audit business operations
        |
MySQL repositories       Way2API provider       BullMQ/Redis worker
```

The shared browser shell is composed by `shared-layout.js`; account controls are in `shared-account.js`, and expired-session behavior is centralized in `session.js`. Page-specific login forms are intentionally not used.

## Request flow

1. The server validates the request and registration format.
2. Authentication and quota guards run before protected work.
3. Vehicle lookups check the MySQL cache first.
4. Cache misses use the external queue when Redis is configured, with single-flight joining for the same normalized registration.
5. Provider results are persisted when safe and usage/audit records are finalized.
6. The response is returned with normalized expiry information and usage data where applicable.

Way2API error handling is charge-aware. The worker caches only responses with an explicit `charged: true` flag. It retries only explicitly non-charged transient failures and never infers retry eligibility from HTTP 500/503 alone. This prevents charged provider outcomes from being repeated and prevents free failures from poisoning the vehicle cache.

The read path also validates cached JSON before serving it. Legacy cached rows with `charged: false` are bypassed, allowing the normal provider retry classification to run; charged cached errors retain their original HTTP status.

Cached records with an expired PUCC, insurance, or registration/fitness date are automatically refreshed after the corresponding configurable interval: `puccRefreshDays`, `insuranceRefreshDays`, or `registrationRefreshDays` (each default 7 days). These settings are stored in `app_settings` and can be changed from Settings without a code change.

## Scalability decisions

- MySQL uses a connection pool and indexed usage/cache queries.
- External API minute/day rate windows use atomic Redis `INCR` plus expiry when Redis is ready; local development falls back to bounded in-process counters.
- BullMQ limits provider work independently from web request traffic.
- Queue capacity, request body size, and request duration are bounded.
- Redis queue startup fails over once to the bounded local provider single-flight fallback instead of retrying indefinitely; this fallback is for local/single-instance operation only.
- `/health/live` checks process liveness; `/health/ready` checks database readiness.
- SIGTERM/SIGINT close the HTTP server, queue resources, Redis connection, and MySQL pool in order.
- Static JavaScript and CSS receive short-lived browser caching; HTML remains no-store because protected routes and session state are dynamic.

## Current horizontal-scaling boundary

The external queue and external API rate windows are safe to share across instances when `REDIS_URL` is configured. Admin sessions use a signed, stateless cookie generated with `SESSION_SECRET`, so every web instance can validate the same session without sticky sessions or an in-memory session store. Every instance must use the same strong `SESSION_SECRET`; changing it invalidates all existing sessions. Logout clears the client cookie, while emergency revocation requires rotating the secret or adding a shared revocation mechanism. The external API rate limiter falls back to process-local counters only when Redis is unavailable, so production should treat Redis as required for multiple instances.

## Completion audit

The external RC lookup boundary is implemented in `src/controllers/external-lookup.controller.js` and the internal `/api/rc-lookup` flow is implemented in `src/controllers/lookup.controller.js`. Setup, authentication, admin, plans, profile, settings, API keys, top-ups, usage, external usage, audit, dashboard, records, and usage detail/export are all dispatched through `src/` controllers. The duplicate route implementations have been removed from `server.js`; it is now the HTTP composition root plus static routing, queue wiring, and startup orchestration. A formal migration runner is still required; current startup schema checks must not be treated as a replacement for versioned migrations. Production readiness additionally requires live Redis verification, authenticated integration tests, load testing, metrics/alerts, and restore testing.

Redis queue single-flight now uses `vdesk:singleflight:way2api:{registration}` with an atomic `SET NX EX` lock. The lock owner creates the BullMQ job; concurrent requests that do not acquire the lock poll the MySQL cache for the completed result and return a queued response if the wait budget expires. The lock is released with token verification after completion/failure, preventing different web instances from creating duplicate provider jobs for the same registration.

The operational route wrapper explicitly returns after handling `/health/live` and `/health/ready`; without that return, the old server handler attempted to write a second response and crashed the process. Readiness correctly reports 503 when the database is unavailable.

If `REDIS_URL` is configured but unreachable, startup reports the failure once and uses the local fallback. This keeps development usable but must be treated as a deployment warning: do not run multiple production web instances without reachable Redis.

## Recommended evolution

Keep the modular monolith until measured load requires separation. Refactor the large server file into route, controller, service, repository, middleware, and worker modules without changing the public API. Then move:

- sessions and rate-limit counters to Redis;
- monthly/daily quota counters to atomic Redis counters with MySQL reconciliation;
- top-up consumption and usage insertion into one MySQL transaction;
- top-up crediting locks the API-key row and writes the balance plus ledger entry in one MySQL transaction;
- static assets to a CDN or reverse proxy;
- audit/analytics reads to paginated or asynchronous paths;
- old usage/audit rows to an archive or partitioned tables.

Do not claim million-request capacity without load tests that measure cache hits, cache misses, queue depth, database pool saturation, error rate, and p95/p99 latency.

## Operational endpoints and settings

| Item | Purpose | Default |
|---|---|---:|
| `GET /health/live` | Process liveness | 200 while process is running |
| `GET /health/ready` | MySQL readiness | 200 only when `SELECT 1` succeeds |
| `REQUEST_TIMEOUT_MS` | Maximum request duration | 30000 |
| `REQUEST_BODY_LIMIT_BYTES` | Maximum JSON body | 2097152 |
| `KEEP_ALIVE_TIMEOUT_MS` | HTTP keep-alive duration | 5000 |
| `HEADERS_TIMEOUT_MS` | Header receive timeout | 10000 |

