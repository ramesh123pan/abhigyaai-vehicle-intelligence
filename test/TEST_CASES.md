# Vehicle Desk — Module Test Cases

This manual QA baseline covers the current Vehicle Desk modules. Run browser cases against `http://127.0.0.1:4173` with a valid admin account and representative saved vehicle/API-key data. Record each result as Pass, Fail, Blocked, or Not Run.

## Authentication and shared shell

| ID | Test case | Steps | Expected result |
|---|---|---|---|
| AUTH-01 | Protected-page guard | Open `/dashboard`, `/records`, and `/plan/{keyId}` signed out. | Redirects to `/login?returnTo=...`; no app chrome or inline login form. |
| AUTH-02 | Login validation | Submit blank, malformed email, invalid phone, and wrong password. | Validation/error feedback; no session created. |
| AUTH-03 | Login return | Open a protected URL, log in validly, reload. | Returns to the safe requested path and renders its correct content. |
| AUTH-04 | Logout/session expiry | Logout, then reload/call `/api/auth/me`; expire/remove the cookie and retry. | Cookie is cleared; API is unauthenticated; protected pages return to login with safe return path. |
| SHELL-01 | Shared navigation | Visit every sidebar item, then use Back/Forward and reload. | Shared sidebar/header/footer remain consistent; correct page and data render after each transition. |
| SHELL-02 | Account controls | Open profile menu, profile/password dialogs, and test desktop/narrow widths. | Name/role/avatar render; dialogs open/close; header stays within viewport. |

## Dashboard, search, records, and vehicle services

| ID | Test case | Steps | Expected result |
|---|---|---|---|
| DASH-01 | Dashboard data | Open Dashboard with known records and upcoming dates. | Totals, critical counts, compliance chart, seven-day activity, and recent rows match API data. |
| DASH-02 | Dashboard empty/error | Test no-record and unavailable-API conditions. | Readable empty/error state appears; no permanent Loading state. |
| SEARCH-01 | Valid cached lookup | Search a valid cached registration such as `UP16AN0593`. | Normalized result, raw JSON, source, status, and expiry labels render correctly. |
| SEARCH-02 | Registration validation | Try `UP16AN593`, `UP1A5930`, unknown state, and malformed input. | HTTP 400/user error before provider/quota work; no paid call. |
| SEARCH-03 | Refresh/copy actions | Search a cached vehicle, use Refresh during cooldown, then Copy JSON. | Cooldown is enforced; copy produces valid JSON; controls are disabled before results. |
| RECORDS-01 | Saved vehicles | Search, paginate, open a View modal, close it, select rows, and bulk delete. | Filtering/pagination/modal are correct; only selected records delete; audit event is created. |
| SERVICE-01 | PUCC monitoring | Use search, All/30/90/Expired date filters, status filter, and pagination. | Only matching PUCC records appear with correct status/date. |
| SERVICE-02 | Insurance expiry | Repeat SERVICE-01 on Insurance. | Filters use insurance dates, not PUCC/fitness dates. |
| SERVICE-03 | Fitness & Tax | Repeat SERVICE-01 on Fitness & Tax. | Filters use fitness/tax data and correct normalized expiry labels. |
| SERVICE-04 | Missing dates | Include a record with no service date and apply each filter. | Missing value is clear and does not falsely match a date window. |

## Operations, administration, and settings

| ID | Test case | Steps | Expected result |
|---|---|---|---|
| OPS-01 | API Activity | Perform cached/provider lookups, then open Activity. | Vehicle, provider, status, time, and source rows are correct and newest-first. |
| OPS-02 | API Documentation | Open docs locally and on another origin. | Example URL/cURL uses current origin; local note appears only locally. |
| OPS-03 | Audit Log | Search audit by user, action, and vehicle; perform logout/delete/admin/settings actions. | Matching rows appear and applicable actions create events without secrets. |
| ADMIN-01 | Admin CRUD | Add a valid admin, submit invalid email, edit name/email/phone/role, change password, log in with the updated credentials, then deactivate it. | Invalid email is rejected; valid changes persist; updated password authenticates; deactivation prevents active use while preserving the row for audit/history. |
| ADMIN-02 | Admin validation | Submit missing name, invalid email/phone, and missing new password. | Field errors appear; no invalid admin is created. |
| PROFILE-01 | Profile/password | Save valid profile/avatar; try invalid/oversized image; change password with wrong and correct current password. | Valid values persist; invalid image/wrong password is rejected; valid password change succeeds. |
| SETTINGS-01 | Business settings | Save valid business fields/logo, reload; then submit invalid email. | Valid values persist and preview updates; invalid save is rejected without overwriting prior values. |

## API keys, plans, top-ups, usage, and key details

| ID | Test case | Steps | Expected result |
|---|---|---|---|
| KEY-01 | External key lifecycle | Create with limits/expiry/IP allowlist/address; list; update; deactivate. | Raw `vdesk_...` secret is shown once only; metadata persists; deactivated key stops authenticating. |
| KEY-02 | Key validation | Try blank name, out-of-range limits, invalid expiry, and empty/invalid changes. | Useful 400 errors; no partial mutation. |
| PLAN-01 | Plan CRUD/assignment | View, create, edit, activate/deactivate, and assign a plan. | Values persist; limits validate; used calls remain intact. |
| PLAN-02 | Top-up packages | Create/edit/activate/deactivate valid and invalid packages. | Whole-number credits and valid price/name enforced; server values drive selection. |
| PLAN-03 | Quota/top-up key assignment | Create a key, assign an active plan, reload key details, add an active top-up package, reload again. | The selected key’s plan, monthly allowance, top-up balance, and bill ledger update; invalid plan/package IDs are rejected. |
| USAGE-01 | Usage dashboard | Open Usage and inspect KPI, activity, key summary, and Recent API Hits. | Sections are independent and data is accurate. |
| USAGE-02 | Recent hits table | Search, sort every supported column, change page size, paginate, clear. | Count, rows, sort direction, and page bounds remain correct; no render loop/column mismatch. |
| USAGE-03 | Key-detail routing | Open `/plan/{apiKeyId}` directly, reload, navigate from Usage, Back/Forward. | Correct API key/site content renders every time, not merely the changed URL. |
| USAGE-04 | History and exports | Filter/sort history; click PDF and Excel actions; inspect files. | Only that key’s latest 100 rows appear; readable real PDF/XLSX contains same columns/data. |
| USAGE-05 | Unauthorized/unknown key | Request detail/export signed out and with unknown ID. | 401/redirect for unauthenticated; 404 for unknown; no secret/hash exposed. |

## External API, cache, quota, and security

| ID | Test case | Steps | Expected result |
|---|---|---|---|
| EXT-01 | Auth variants | Call both external route forms with missing, bad, `X-API-Key`, and Bearer credentials. | Missing/bad returns 401; both valid auth forms work. |
| EXT-02 | Cached request | Call a valid cached registration. | Returns cache metadata without paid provider call; usage/audit are appropriate. |
| EXT-03 | Format coverage | Test standard valid, `DL3SDV7431`, BH-series, invalid 3-digit final number, and unknown state. | Supported formats proceed; invalid formats return 400 before quota/provider work. |
| EXT-04 | Limits | Exercise minute limit, daily limit, expired key, and disallowed IP. | Correct 403/429 response; usage is not incorrectly incremented. |
| EXT-05 | Provider success/failure | Simulate cache miss success and charged 422 twice. | Success is cached; charged failure is cached with status 422 and second call avoids another charge. |
| EXT-06 | Resilience/secrets | Force optional metadata/audit failure; inspect browser/network responses. | Vehicle response survives secondary logging failure; credentials, hashes, passwords, and peppers never appear. |

The executable API suite additionally checks profile/settings validation, audit-event creation, API-key create/update/deactivate, usage/dashboard/records/today endpoints, and cleanup of temporary records.

## Verification record

| Run date | Environment/commit | Cases run | Result summary | Browser verified | Port 4173 restart verified | Notes |
|---|---|---|---|---|---|---|
| 2026-09-25 | Local workspace; port 4173 listening | `npm test` | 7 passed; 0 skipped; 0 failed. Authentication, protected modules, admin CRUD, plan CRUD, top-up package CRUD, and external validation passed. | No | Server process verified listening on 4173 | Temporary CRUD records were created and cleanup completed. |
