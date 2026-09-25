# Test Case Status

Last verified: 2026-09-25  
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
| Skipped | 5 | Authenticated modules require `TEST_ADMIN_EMAIL` and `TEST_ADMIN_PASSWORD` |
| Total | 8 | Node test runner cases |

## Passed cases

| ID | Area | Verification |
|---|---|---|
| AUTO-01 | Server health/auth | `/api/auth/me` responds and reports a boolean authentication state |
| AUTO-02 | Protected API guard | Unauthenticated admin API and external usage requests are rejected with HTTP 401 |
| AUTO-03 | RC validation | Malformed registrations are rejected before provider access |

## Skipped cases and how to enable them

These cases are intentionally skipped when credentials are not present; this prevents tests from guessing or storing passwords.

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

## Browser and route checks

Verified locally with HTTP route checks:

`/`, `/login`, `/dashboard`, `/plans`, `/usage`, and `/records` returned HTTP 200.

The local server was restarted after the latest external-response change and port 4173 was verified listening. This report does not claim a full authenticated browser regression run.

## Load test status

The saved-vehicle cache load harness passed at 1,000 and 3,000 concurrent requests with MySQL cache responses and no provider responses. The 5,000-request run failed with connection refusals, so the demonstrated safe capacity is 3,000 concurrent requests pending socket/backlog investigation. See [LOAD_TEST_REPORT.md](LOAD_TEST_REPORT.md).

## Known limitations

- Five authenticated automated tests remain skipped until test credentials are supplied at runtime.
- Provider success and charged-failure paths require a configured Way2API key and a real external key for end-to-end verification.
- Geographic location is not resolved for private/local IPs; the request records a privacy-safe location status instead.
- Existing historical usage rows may have NULL metadata because those values cannot be reconstructed safely.
