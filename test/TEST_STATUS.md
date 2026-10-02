# Test Case Status

Last verified: 2026-10-01
Target: local `http://127.0.0.1:4173`

## Automated status

Command:

```text
npm test
```

| Result | Count | Details |
|---|---:|---|
| Passed | 3 | Server/auth contract, unauthenticated protected APIs, malformed RC validation |
| Failed | 0 | No automated failures |
| Skipped | 8 | Server was not running for contract tests; authenticated modules require `TEST_ADMIN_EMAIL` and `TEST_ADMIN_PASSWORD` |
| Total | 11 | Node test runner cases |

## Passed cases

| ID | Area | Verification |
|---|---|---|
| AUTO-01 | Server health/auth | `/api/auth/me` responds and reports a boolean authentication state |
| AUTO-02 | Protected API guard | Unauthenticated admin API and external usage requests are rejected with HTTP 401 |
| AUTO-03 | RC validation | Malformed registrations are rejected before provider access |

## Skipped cases and how to enable them

These cases are intentionally skipped when credentials are not present; this prevents tests from guessing or storing passwords.

The latest no-server run skipped three server-contract cases because port 4173 was not listening. A live-server run previously completed those three cases successfully, leaving five authenticated cases skipped.

| Area | Coverage |
|---|---|
| Shared protected modules | Dashboard, records, profile, settings, audit, API keys, plans, top-ups, usage |
| Admin CRUD | Create, validation, edit including password, deactivate |
| Plan CRUD | Create, validation, edit, deactivate |
| Top-up CRUD | Full create/edit fields, price/credits validation, deactivate |
| Service actions | Profile, settings, API-key, usage, and service API contracts |

Run them in PowerShell without committing credentials:

```powershell
$env:TEST_ADMIN_EMAIL='your-admin-email'
$env:TEST_ADMIN_PASSWORD='your-admin-password'
npm test
```

The test runner also automatically loads a local `.env.test` file when present. This file is ignored by Git. It currently contains the supplied test credentials and local test URL, so `npm test` no longer requires setting those variables in every terminal. Replace or remove the local file when credentials change; never commit it.

`.env.test` also contains the local Redis/BullMQ settings and `TEST_EXTERNAL_API_KEY=`. The external key must be a generated application/site key; the provider `WAY2API_API_KEY` must not be substituted for it.

## External API coverage

| Feature | Status | Notes |
|---|---|---|
| API-key authentication | Passed contract | Missing key returns 401 |
| Cache-first RC lookup | Implemented | MySQL cache is checked before provider access |
| RC format validation | Implemented | Standard, Delhi zonal, and BH formats supported |
| Request metadata logging | Implemented | IP, forwarded chain, user-agent, device, host, and location status |
| Quota/top-up enforcement | Implemented | Monthly allowance is consumed before top-up balance |
| Usage summary endpoint | Implemented | `/api/v1/external/usage` is read-only |
| Usage in RC response | Implemented | Successful RC responses include updated `usage` after the hit |
| Provider live-call verification | Pending | Requires a valid external key and provider configuration |

## Concurrent RC lookup report

Three simultaneous requests for `HR05BM5363` were executed against `/api/v1/external/rc/:registration` with the configured external key. All returned HTTP 200, valid JSON, `success: true`, provider `message_code: OK`, vehicle status `ACTIVE`, and valid PUCC/insurance/registration expiry statuses. All three responses had the same provider order ID. The redacted response log is [test/reports/concurrent-rc-lookup-2026-10-01.json](reports/concurrent-rc-lookup-2026-10-01.json). This proves identical results were returned, but does not by itself prove that only one paid provider call occurred.

Follow-up source test on port 4174 with Redis enabled and the same registration returned HTTP 200 for all three simultaneous requests, each with `_cache.source: mysql` and `_cache.provider: way2api`, completing in about 170 ms. This confirms that this particular run was served from the local MySQL cache; it was not a live provider-call test. A cache-miss queue test requires a registration not already cached and may incur provider usage.

The five-user guide and result interpretation are documented in [RC_CONCURRENT_USER_GUIDE.md](../docs/RC_CONCURRENT_USER_GUIDE.md). The HR02AH0041 five-request run exposed and fixed a BullMQ completion API error; the follow-up run returned four cached `200` responses and one expected `429 Monthly plan quota exceeded` response after the test key quota was exhausted.

The database audit for `HR02AH0041` recorded 4 `way2api` rows, 4 `mysql` cache-hit rows, and 1 incomplete row from the pre-fix run. This confirms the old burst made four live provider calls; it does not represent the expected post-fix single-flight behavior.

Clean post-fix verification for fresh `UK07FL6670`: 5 concurrent requests produced 5 HTTP 200 responses, exactly 1 `way2api` usage row, and 4 `mysql` cache-hit rows. See [test/reports/concurrent-rc-lookup-UK07FL6670-2026-10-01.json](reports/concurrent-rc-lookup-UK07FL6670-2026-10-01.json).

## Browser and route checks

Verified locally with HTTP route checks:

`/`, `/login`, `/dashboard`, `/plans`, `/usage`, and `/records` returned HTTP 200.

The local server was restarted after the latest external-response change and port 4173 was verified listening. This report does not claim a full authenticated browser regression run.

## Load test status

The saved-vehicle cache load harness passed at 1,000 and 3,000 concurrent requests with MySQL cache responses and no provider responses. The 5,000-request run failed with connection refusals, so the demonstrated safe capacity is 3,000 concurrent requests pending socket/backlog investigation. See [LOAD_TEST_REPORT.md](LOAD_TEST_REPORT.md).

## Known limitations

- Five authenticated automated tests remain skipped until test credentials are supplied at runtime.
- Redis/BullMQ integration remains unverified until a local Redis server is running; see [REDIS_LOCAL_TESTING.md](../docs/REDIS_LOCAL_TESTING.md).
- Provider success and charged-failure paths require a configured Way2API key and a real external key for end-to-end verification.
- Geographic location is not resolved for private/local IPs; the request records a privacy-safe location status instead.
- Existing historical usage rows may have NULL metadata because those values cannot be reconstructed safely.
### Way2API charge-aware retry verification (2026-10-01)

Added focused worker tests: charged 422 failures are cached, explicitly non-charged transient failures are retried and not cached, and charged HTTP 503 responses are not retried as free failures. Current result: 3 new tests passed. The implementation follows Way2API guidance to branch on `charged` and `message_code`, not HTTP status alone.

Full authenticated suite verification on 2026-10-02: `.env.test` now quotes the `#` character in the password, so Node loads the complete value. A verified workspace server on port 4174 produced 11 passed, 0 skipped, and 0 failed tests. The server was stopped gracefully after the run.
