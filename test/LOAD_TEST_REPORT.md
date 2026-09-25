# Saved Vehicle Cache Load Test Report

## Scope

- Target: local `http://127.0.0.1:4173`
- Vehicle: `UP16AN0593`
- Endpoint: `POST /api/rc-lookup`
- Provider calls allowed: **No**
- Cache gate: the run was allowed to start only after a warm-up response returned `_cache.source = mysql`.

## Run result — 2026-09-25

| Concurrent requests | HTTP 200 | MySQL cache hits | Provider responses | Transport errors | Requests/second | Result |
|---:|---:|---:|---:|---:|---:|---|
| 1,000 | 1,000 | 1,000 | 0 | 0 | 438.71 | PASS |
| 3,000 | 3,000 | 3,000 | 0 | 0 | 490.02 | PASS |
| 5,000 | 4,604 | 4,604 | 0 | 396 (`ECONNREFUSED`) | 603.80 | FAIL |

## Conclusion

The application served all successful requests from the MySQL cache, and no Way2API/provider response was observed. The 5,000-request level did not complete successfully: 396 requests were refused and the local Node process stopped listening during the run. Therefore the overall load test is **FAIL**, with the current demonstrated safe capacity passing at 3,000 simultaneous requests but not at 5,000.

Raw machine-readable output is in [load-results.json](load-results.json). The repeatable harness is [load-saved-vehicle.js](load-saved-vehicle.js), and the local temporary-admin wrapper is [run-local-load.js](run-local-load.js).

## Repeat run — 2026-09-25 19:17 IST

Execution log: [load-run.log](load-run.log).

| Concurrent requests | Duration | HTTP 200/cache hits | Provider responses | Errors | Error reason |
|---:|---:|---:|---:|---:|---|
| 1,000 | 963 ms | 1,000 | 0 | 0 | None |
| 3,000 | 2,186 ms | 2,761 | 0 | 239 | `ECONNREFUSED` while opening connections |
| 5,000 | 2,998 ms | 4,196 | 0 | 804 | `ECONNREFUSED` while opening connections |

The repeat run again proves that successful responses were MySQL cache hits and no Way2API response was observed. The failure is connection-level refusal under burst load, not a provider failure or an HTTP application error. The listener was present after the run, so the evidence points to transient listener/backlog/socket saturation; process, OS socket, and database metrics should be captured in the next run to identify the exact limiting resource.
