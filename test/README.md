# Test folder

The complete module-by-module QA cases are in [TEST_CASES.md](TEST_CASES.md). The latest execution summary, passed/skipped coverage, and unresolved verification items are in [TEST_STATUS.md](TEST_STATUS.md). Executable HTTP/API coverage is in [api.test.js](api.test.js).

Coverage includes authentication/session, shared shell/account controls, dashboard, search, saved vehicles, PUCC/insurance/fitness services, API activity/documentation/audit, admin users/profile, API keys, plans/top-ups, usage/key details/exports, settings, and external API/cache/quota/security behavior.

Run `npm test` with the application listening on port 4173. Set `TEST_ADMIN_EMAIL` and `TEST_ADMIN_PASSWORD` to run authenticated CRUD cases; without them, only unauthenticated/contract cases run. Tests create temporary records and attempt cleanup. Coverage includes admin CRUD, profile/settings validation, audit events, API-key lifecycle, usage/dashboard/records/today endpoints, plans, top-ups, and external registration validation. If login returns 401, dependent CRUD cases are skipped with the login error instead of being reported as misleading CRUD failures. Browser-only interactions still require browser automation/manual verification.

For PowerShell:

```powershell
$env:TEST_ADMIN_EMAIL="your-test-admin@example.com"
$env:TEST_ADMIN_PASSWORD="your-test-admin-password"
npm test
```

For Command Prompt (`cmd.exe`):

```cmd
set "TEST_ADMIN_EMAIL=your-test-admin@example.com"
set "TEST_ADMIN_PASSWORD=your-test-admin-password"
npm test
```

Replace the example email and password with the actual test admin credentials. Do not include `mailto:`, Markdown link text, brackets, or quotes inside the email value. These variables apply only to the current terminal window.
