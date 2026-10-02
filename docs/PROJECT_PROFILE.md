# Vehicle Desk project profile

## Modular refactor update — 2026-09-28

Started the server decomposition under `src/`. `src/config/runtime.js` owns runtime settings, `src/infrastructure/database.js` owns MySQL pool creation/readiness, `src/security/session.js` owns cookie parsing and signed session-token validation, `src/services/vehicle.service.js` owns registration validation and expiry normalization, and `src/workers/provider-worker.js` owns the Way2API call/persistence boundary. `server.js` now consumes these modules. Route/controller/repository extraction remains pending and will be done incrementally with regression checks; the current code is an intermediate refactor state.

The HTTP boundary extraction now also includes `src/middleware/request.js`, `src/middleware/auth.js`, `src/middleware/error-handler.js`, and `src/routes/system.routes.js`. These are wired into `server.js`; business route extraction remains the next stage.

`src/repositories/vehicle.repository.js` now owns vehicle-cache reads, writes, and deletion, and the records/dashboard/delete paths use it. Usage repositories and controller/route composition remain pending.

`src/repositories/usage.repository.js` now owns key usage counts, monthly totals, request history, and top-up bill reads for the key-detail path. Controller and complete route composition remain pending.

`src/controllers/vehicle.controller.js` now owns Saved Vehicles listing and deletion actions and is wired from the server route boundary. Remaining business controllers/routes are still pending.

`src/controllers/auth.controller.js` now owns session status and logout actions and is wired into `/api/auth/me` and `/api/auth/logout`. Login and remaining business endpoints still need migration.

The login endpoint now dispatches to `auth.controller.js`; the previous inline implementation has been removed.

Latest controller additions include `src/controllers/audit.controller.js`, which owns `/api/audit` and `/api/audit/event`. External lookup migration remains.

`src/controllers/admin.controller.js` now owns authenticated admin creation and listing, and both `/api/admins` methods dispatch through it. Admin update/deactivation and the remaining business groups are pending.

Admin update and deactivation now also dispatch through `admin.controller.js`; the complete admin CRUD route group is migrated.

`src/controllers/plan.controller.js` now owns API-plan and top-up-package CRUD, wired to the plans/top-up endpoints. Profile/settings, API-key, usage, and external-lookup migration remains.

`src/controllers/profile.controller.js` now owns `/api/profile` reads/updates and `/api/profile/password`, including validation, password hashing, avatar validation, and audit calls.

`src/controllers/settings.controller.js` now owns protected settings reads/writes and public branding reads, including SMTP-password masking and upload-field handling.

`src/controllers/api-key.controller.js` now owns external-key creation/listing, deactivation, regeneration, and plan assignment. Key update and usage/external-lookup migrations remain.

External API-key update is now also wired through `api-key.controller.js`; the complete key lifecycle group is migrated.

`src/controllers/usage.controller.js` now owns `/api/usage` and `/api/usage/today`. Key-detail usage reads remain in the usage repository path; audit and external lookup migration remains.

## Architecture and scalability update — 2026-09-28

Added `ARCHITECTURE.md` as the authoritative structure/design document. The Node monolith now bounds request duration and JSON body size, exposes `/health/live` and `/health/ready`, caches static JS/CSS briefly, rejects new requests during shutdown, performs graceful shutdown for HTTP, BullMQ/Redis, and MySQL resources, uses atomic Redis rate windows when Redis is ready, and uses signed stateless admin session cookies shared by all instances through `SESSION_SECRET`. JavaScript syntax, `git diff --check`, and `npm test` passed; `npm test` reported 3 passed and 8 skipped because the local test server and test credentials were unavailable. A live local start served `/health/live` 200, `/health/ready` 200, and `/` 200, and SIGINT graceful shutdown was observed. Redis was configured but not running locally, so BullMQ and Redis-rate-window behavior remain unverified. Production must configure the same strong `SESSION_SECRET` on every instance.

Redis initialization now makes one connection attempt and cleanly falls back to the bounded local queue when Redis is unreachable, avoiding repeated reconnect noise. Multi-instance queue and rate-limit guarantees still require a reachable production Redis service.

Latest verification: `node --check server.js`, `git diff --check`, and `npm test` completed without failures; the test run had 3 passes and 8 skips for unavailable credentials/server prerequisites. A live start with a test `SESSION_SECRET` returned 200 from both health endpoints and logged one Redis fallback warning; SIGINT shutdown completed cleanly. No production Redis or authenticated concurrent test was available.

Top-up crediting now locks the API-key row and updates the balance and top-up ledger in one MySQL transaction. Syntax and diff checks are required after this update; authenticated concurrent top-up verification remains pending because local test credentials are not configured.

Updated: 2026-09-23

Admin update fix (2026-09-23): The admin edit endpoint now hashes and persists a newly entered password, while a blank password leaves the existing hash unchanged. The audit entry records whether the password changed without storing the password.

Vehicle deletion update (2026-09-24): The Saved Vehicles page now supports selecting rows, select-all on the current page, individual deletion, and confirmed bulk deletion. `DELETE /api/records/:vehicle` removes all cached provider rows for that registration and records an audit event. Local syntax and API checks passed; browser interaction remains to be verified after restart.

Deployment update (2026-09-23): GitHub code is attached to CyberPanel for `rcvd.xims.au`. Production MySQL database `xims_rcvd` was imported from the local `lorryinfo.sql` dump; verification found the required tables, 5 vehicle-cache records, and 2 admin records. The production app is managed by PM2 as `abhigyaai` and is online on port 4173. Production `.env` is server-only and is not committed to GitHub. The Way2API provider key must be replaced with the real production key before paid live lookups are enabled.

Public API routing fix (2026-09-23): LiteSpeed was serving the static document root directly, so public `/api/*` requests returned LiteSpeed 404 pages while localhost Node routes worked. The vhost now defines a LiteSpeed proxy external processor for `127.0.0.1:4173` and a `/api/` proxy context. Public `/api/profile` and `/api/plans` now reach Node and return the expected JSON authentication response instead of 404.

Deployment verification: no project-root `.htaccess` is required for the current CyberPanel/OpenLiteSpeed setup. The API proxy is defined at the vhost level; adding an `[P]` rewrite without an external proxy application caused a LiteSpeed 500. Public `/api/profile` currently returns JSON 401 when unauthenticated, confirming the vhost proxy is active.

Login routing fix (2026-09-23): LiteSpeed did not map the clean `/login` URL to `login.html`, so unauthenticated API redirects landed on a 404. A server-side `login` alias to `login.html` was added; `https://rcvd.xims.au/login?returnTo=%2Fdashboard` now returns HTTP 200 and preserves the return query.

Production login fix (2026-09-23): Database verification found both imported admin accounts active. Their hashes were generated locally without `PASSWORD_PEPPER`, while production had a different generated pepper, causing valid credentials to fail. Production `PASSWORD_PEPPER` was aligned with the imported hashes and PM2 was restarted successfully. Change the admin password after first login.

Clean route deployment fix (2026-09-23): The live vhost proxies clean application routes to the Node process, so `/dashboard`, `/search`, `/records`, `/pucc`, `/insurance`, `/fitness`, `/activity`, `/api-docs`, `/admins`, `/api-keys`, `/plans`, `/usage`, `/audit`, and `/settings` do not require empty route folders or symlinks. API documentation now renders the current origin dynamically and shows the production HTTPS endpoint on `rcvd.xims.au`.

Scalable route deployment fix (2026-09-23): Removed the temporary route symlinks and configured the LiteSpeed vhost root context to proxy all application requests to the Node `nodeapp` processor on port 4173. This makes future clean URLs work without adding server-side folders or aliases. Verification: protected `/dashboard`, `/pucc`, and `/plan/2` return the expected 302 login redirect; `/login` returns 200; `/api/profile` returns JSON 401 when unauthenticated.

## Purpose and preferences

Local vehicle lookup console using Node.js, MySQL, and Way2API. Preserve cache-first lookups and the light admin layout with a dark sidebar. Never expose provider credentials or API key secrets in documentation.

The user requires project Markdown and profile notes to be updated after each change. Keep verified results separate from pending work.

Latest verification (2026-09-22): port 4173 restarted with the updated source. The authenticated `/plan/2` DOM showed Request history with inline Download Excel and Download PDF buttons, and the table remained key-scoped to Test2. Standalone generator checks produced a readable PDF and an XLSX workbook with 100 request rows. Browser download clicks still need a signed-in session after the restart because restarting clears in-memory sessions.

Request history table update: the detail page now includes a search field, visible result count, and sortable Vehicle, Endpoint, Status, Source, and Time headers. Filtering and sorting are client-side over the latest 100 rows returned for that key; exports continue to include the same key-scoped rows.

Usage data-table pagination now includes a rows-per-page selector (10/25/50), numbered page buttons, and Previous/Next controls; the controls remain below the Recent API hits heading and search toolbar.

Added a delayed first-load reconciliation so the legacy usage column synchronizer cannot overwrite the paginated Recent API hits body after the table initially loads.

The legacy synchronizer is now marked as already handled before its delayed pass, preventing it from replacing the paginated rows with an empty/unpaginated body. Recent API hits metadata columns are intentional: IP address, device, and location were requested for request auditing; the API-key table's Details column is the View details action.

Hardened usage pagination against an invalid persisted page-size/page value; invalid values now fall back to 10 rows and page 1 instead of producing Page NaN and an empty table.

Updated `GET /api/usage` to select the complete latest-100 request metadata from `api_usage_logs`, including source, IP, forwarded IP, user agent, device, language, referer, host, location status, and timestamp.

Adjusted Recent API hits column widths and wrapping so all nine rendered fields stay aligned and visible within the usage content area.

External RC JSON responses now include `expiry_status.pucc`, `expiry_status.insurance`, and `expiry_status.registration`, each with `status`, `message`, `date`, and `days_remaining` for direct display by calling applications. Statuses are `valid`, `expiring_soon` (within 7 days), `expired`, or `unavailable`.

API Documentation page now includes the expiry-status schema, sample JSON, and the four status meanings.

Product branding applied: AbhigyaAI Vehicle Intelligence, by Xpansion Technologies. Recommended GitHub repository name: `abhigyaai-vehicle-intelligence`.

External API request metadata: each newly accepted gateway request stores client IP, forwarded IP chain, user-agent, device category, language, referer, host, and location status. The details table and PDF/XLSX exports show IP, device, and location status. Private/local IPs are explicitly marked as geographic location unavailable; no third-party geolocation lookup is enabled.

Verification: `server.js`, `key-details.js`, and `usage-export.js` syntax checks passed. The server is listening on port 4173 after the metadata migration startup. Existing records are not retroactively populated.

Login flow update: direct `/login` and `/login.html` navigation now redirects an already-authenticated session to its safe `returnTo` destination or dashboard. The login page also checks `/api/auth/me` on load to handle a cached login document without briefly showing the form.

## Requested key details experience

- Clean path such as `/plan/2`, without hash fragments. The displayed record must identify the site/API key; API key IDs and plan IDs are different database identities.
- Site name, assigned plan, active/inactive status, calls used and remaining.
- Monthly history, bills, and key-specific PDF and real Excel downloads. Request history exports are inline PDF and Excel icon actions in the table header.
- Correct rendering on direct entry, refresh, sidebar navigation, and back/forward.

## Current status

Saved Vehicles deletion update: the master Select all control is moved into the table header with checkbox/text alignment and no stray header label, and individual/bulk deletion requires confirmation explaining that the action is recorded. The existing server deletion route writes `vehicle_deleted` with the authenticated admin and timestamp to the Audit Log. Browser verification of the updated placement remains pending.

### QA test-case baseline — 2026-09-25

Added [test/TEST_CASES.md](test/TEST_CASES.md), [test/README.md](test/README.md), and executable [test/api.test.js](test/api.test.js). The manual baseline covers all modules; the executable suite covers server/auth contracts, protected APIs, admin CRUD, plan CRUD, top-up package CRUD, and external registration validation. Latest `npm test` run: 3 passed, 4 skipped, 0 failed; port 4173 was verified listening, but test credentials were not configured. No browser verification was performed.

The executable suite now treats a rejected test-admin login as the root cause and skips dependent CRUD tests, rather than reporting cascading 401 responses as CRUD assertion failures. Authenticated verification now passes: latest `npm test` run completed with 7 passed, 0 skipped, and 0 failed.

Admin CRUD coverage was expanded to verify invalid-email rejection, name/email/phone/role edits, password update, login with the updated password, and deactivation. This expanded test has not yet been executed in this turn.

Executable API coverage was also expanded for profile/settings validation, audit-event creation, API-key lifecycle, usage/dashboard/records/today endpoints, plan/top-up actions, and external registration validation. The latest `npm test` run completed with 3 passed, 8 skipped, and 0 failed; the skipped cases require a running port-4173 server and/or test credentials. Browser-only interactions such as clicks, modals, filters, charts, and file download rendering still require browser automation or manual QA.

Architecture completion audit (2026-10-01): the new `src/` controllers, repositories, middleware, infrastructure, session, service, and worker modules are present and syntax-checked. The refactor is not fully complete: `server.js` still contains duplicate legacy route implementations, especially external RC lookup and several dashboard/auth/business paths. Versioned database migrations, production Redis verification, authenticated integration testing, metrics/alerts, and realistic load testing remain outstanding. These are explicit remaining items, not verified completions.

External lookup extraction update (2026-10-01): added `src/controllers/external-lookup.controller.js` and wired it before the legacy external handlers. Syntax checks and the available test suite pass, but the old inline external handlers still need deletion and a live provider/cache/queue test remains unavailable without the required services and credentials.

Controller dispatch update (2026-10-01): authentication, admin, plan, profile, settings, API-key, usage, and audit requests now dispatch to their `src/controllers` implementations before the old inline blocks. Syntax checks passed; authenticated behavior remains dependent on configured database/test credentials.

Vehicle route update (2026-10-01): dashboard, records listing, and record deletion now dispatch through `vehicle.controller.js`; dashboard aggregation is backed by `vehicle.repository.js`. The old inline implementations remain below the active dispatch and are cleanup-only until the remaining detail endpoint is extracted.

Usage detail update (2026-10-01): added `src/controllers/usage-detail.controller.js` for key detail JSON and PDF/XLSX exports, and moved its active dispatch ahead of the old inline implementation. Remaining legacy active paths are setup, top-up credit, and external usage summary.

Final business-route extraction update (2026-10-01): added setup handling, transactional top-up credit handling, external usage-summary handling, and internal `/api/rc-lookup` handling to modular controllers. The duplicate business route blocks were removed from `server.js`, leaving it as the composition root and static/queue orchestration layer. A current source audit finds only controller dispatch in the request handler. Syntax checks, diff checks, and the live-server test pass completed with 3 passed, 5 skipped, and 0 failed; authenticated/live-provider tests remain environment-dependent.

Test prerequisite audit (2026-10-01): `DB_*`, `REDIS_URL`, `SESSION_SECRET`, `TEST_ADMIN_EMAIL`, and `TEST_ADMIN_PASSWORD` are not present in the process environment; Docker is installed but its daemon is unavailable. The skipped authenticated and infrastructure tests therefore cannot be promoted to executed tests from this workspace without external configuration/services.

Redis verification update (2026-10-01): Docker Desktop was started, Redis image `redis:7-alpine` was launched as `rc-lorryinfo-redis`, port 6379 accepted connections, and `redis-cli ping` returned `PONG`. Starting the project with `REDIS_URL=redis://127.0.0.1:6379` reported `External queue: Redis/BullMQ worker enabled`. The existing port-4173 process could not be replaced safely because its workspace origin was not verifiable; the supplied admin credentials returned HTTP 401, so authenticated tests still skipped.

Test credential convenience (2026-10-01): added ignored local `.env.test` loading to `test/api.test.js`, so `npm test` automatically uses the local test email/password without requiring PowerShell variables on every run. The file is ignored by Git and the supplied account still returns HTTP 401 because it is not recognized by the configured database.

Concurrent external RC test (2026-10-01): three simultaneous requests for `HR05BM5363` returned valid HTTP 200 JSON, `success: true`, `message_code: OK`, `ACTIVE` vehicle status, valid expiry statuses, and the same provider order ID. A redacted response log is saved at `test/reports/concurrent-rc-lookup-2026-10-01.json`; sensitive personal and vehicle-identifying fields were excluded. Same-result observation is verified; one-provider-call deduplication still requires provider/database usage metrics.

Source confirmation (2026-10-01): a Redis-enabled test server on port 4174 returned `_cache.source: mysql` for all three simultaneous `HR05BM5363` requests, completing in approximately 170 ms. This confirms that the follow-up run used the local MySQL cache. The first earlier run did not include the cache marker and cannot be used to prove the source or provider-call count.

Five-user RC test (2026-10-01): five concurrent requests for `HR02AH0041` were executed. The first run exposed a BullMQ v6 completion API error for one request; it was fixed by changing `QueueEvents.waitUntilFinished(job, timeout)` to `job.waitUntilFinished(queueEvents, timeout)`. The follow-up run returned four valid cached HTTP 200 responses and one HTTP 429 `Monthly plan quota exceeded`; the guide and interpretation are documented in `RC_CONCURRENT_USER_GUIDE.md`.

Fresh-cache five-user test (2026-10-01): `UK17W2900` had no cache or usage rows before testing. Five concurrent requests returned HTTP 200, valid JSON, `OK`, `ACTIVE`, and the same provider order ID; one cache row was created. The usage audit initially labeled all five rows `way2api` because joined requests were not marked as cache results. This attribution bug was fixed so future joined requests are recorded as `source=mysql`, `cache_hit=1`; the historical rows are not retroactively rewritten.

Documentation reconciliation (2026-10-01): the latest entries in this profile supersede older historical entries that describe intermediate refactor stages or earlier test counts. Current Redis setup instructions are in `REDIS_LOCAL_TESTING.md`; current test counts are maintained in `test/TEST_STATUS.md`.

Operational route fix (2026-10-01): corrected the system-route wrapper so health responses stop dispatching into the legacy handler. Live verification returned `/health/live` 200, `/health/ready` 503 because the database was unavailable, and malformed external registration 400; the server remained listening after all three requests.

Plan Management uses responsive pricing cards, and create/edit forms open in a modal popup. The Dashboard API Plans section uses compact summary cards with pricing, limits, Popular styling, and a View all plans link.

External lookup resilience: metadata logging errors are now logged to `server-err.log` but do not block a valid cache/provider response. The external API remains responsible for authentication, plan, and quota errors.

Way2API transient recovery: provider responses with `charged: false` and `REQUEST_FAILED`/`backend_down` are retried up to two times. Charged or non-transient failures are not retried, and a final non-charged backend failure is not cached.

Charged provider failures: the external gateway now stores the raw Way2API response in `vehicle_cache` even when Way2API returns a non-2xx verification result such as HTTP 422 with `charged: true`. The response is returned with its provider status, and later requests use the cached result within the cache TTL to avoid another paid call. Usage rows are finalized for both successful and failed provider responses.

Cached charged failures preserve their provider HTTP status. A cached Way2API body with `charged: true`, `success: false`, and `status_code: 422` is returned by the gateway as HTTP 422 rather than being mislabeled HTTP 200.

RC validation is enforced before any provider call on both `/api/rc-lookup` and `/api/v1/external/rc/:registration`. Standard state plates require a two-digit numeric RTO code, while Delhi's alphanumeric zonal form is supported; `DL3SDV7431` is valid (`DL` + `3S` + `DV` + `7431`). The final registration number must contain four digits; invalid values such as `UP16AN593` and `UP1A5930` return HTTP 400 and do not consume quota or call Way2API.

Validation now checks the complete application format: whitelisted Indian state/UT code, exactly two-digit RTO code, one-to-three alphabetic series letters, and exactly four final digits. It validates structure and known state/UT code; it does not prove that a specific RTO/series was officially issued.

Validation also accepts the BH series format `YYBH####A/AA`. Diplomatic and vintage legacy formats are rejected before paid lookup because the current Way2API integration has no dedicated handling for those plate types.

API Usage Recent API hits now uses the data-table behavior: search, sortable columns, ten-row pagination, previous/next controls, and a filtered result count.

Site-key details Request history now returns and displays the full latest 100 request records, including cache hit, client/forwarded IP, device, user-agent, language, referer, host, location status, vehicle, endpoint, provider source, HTTP status, and time. PDF/XLSX exports include the same fields.

Recent API hits on `/usage` is presented as its own standalone card containing the searchable, sortable, paginated table; it is visually separate from the KPI cards and request-activity chart.

The API key usage summary table is also an independent white card, separate from Recent API hits.

Usage statistics cards now follow the Dashboard visual language: four distinct gradient colors, relevant icons, high-contrast values, and consistent card spacing.
Dashboard primary stats and critical vehicle stats now use distinct gradient cards with type-specific icons and high-contrast values, while preserving the existing metrics and layout.
API Usage now follows the same clean card rhythm: KPI cards, request activity, API-key summary, and Recent API hits are independent surfaces with consistent spacing and responsive behavior.
The Usage page outer wrapper is transparent and no longer creates a white card around all sections; its spacing and content surfaces now match the Dashboard hierarchy.
Usage tables now use Dashboard-style separated rows with individual borders, rounded row ends, consistent cell padding, and hover feedback.
Recent API hits now uses one cohesive table card with a compact header/toolbar, fixed responsive column proportions, and reduced empty whitespace.
Recent API hits now follows the Dashboard Recent Records reference: one clean surface, compact heading/subtitle spacing, a light table header, and flat horizontal row separators.
Site-key Request history headers now match every rendered metadata column; Usage Recent API hits also exposes API key, vehicle, endpoint, status, source, IP, device, location, and time consistently.
The Usage metadata synchronization is guarded and no longer observes/re-writes its own DOM mutations, preventing a render loop that could stop `/usage` from loading.
Removed the repeated cache-notice paragraph from the shared page content so API Usage has a cleaner heading-to-card transition.
Hidden the duplicate inner API Usage heading so the page shows one clear title.
Top-up credits are now supported as a ledger-backed fallback after the monthly plan allowance is exhausted. Key details show the balance and provide Upgrade/Update Plan plus Add top-up credits actions. The current implementation credits admin-confirmed top-ups; a payment gateway is not configured.
Top-ups now use fixed-price packages from `api_topup_packages`, selected by dropdown. Package CRUD is available in Plan Management, and each credited package is recorded in the site key Bills history with package, calls, amount, reference, and date.
Shared header updated toward the NexLink reference: compact icon search with debounced vehicle suggestions, Today API calls pill, and profile name/role presentation with the existing account dropdown.
Profile UI now supports image upload with initials fallback, circular header/dropdown avatars, and Logout only inside the account dropdown; the standalone header Logout button is hidden.
Header profile control now uses a transparent reference-style layout with circular avatar, bold name, role, and email instead of a blue button.
Header now shows only the profile name and role; the email remains inside the opened account dropdown.
Added a visible chevron symbol to the account control to indicate the dropdown.
Removed the separate sidebar-collapse icon beside the header search to keep the reference header minimal.
Header layout now uses three columns: full-width search, centered Today API calls, and right-aligned profile control.
Profile alignment now follows the reference: name/role text first, chevron beside it, and circular avatar on the far right.
Final header alignment uses full available width and three equal columns; the chevron is positioned before the role label.
Corrected horizontal overflow caused by combining a sidebar margin with a 100% header width; the header now uses the remaining content width at each breakpoint.
Verified live geometry: the 220px sidebar and header content area align exactly; added a page-level horizontal overflow guard while preserving local table scrolling.
Header Today API calls now comes from a dedicated current-day database count instead of the monthly usage total.
Recent API hits first render now uses the same nine-column metadata renderer as later searches, with the toolbar explicitly below the section heading.

Usage layout update: the outer Usage page card is visually removed so KPI cards, activity chart, key summary table, and Recent API hits render as independent sections instead of cards nested inside one large card.

Usage-row correction: the request row is finalized before the audit insert is attempted, so cache hits record the vehicle, `mysql` source, HTTP 200, and cache hit flag even if the audit table write fails.

Audit logging is also non-blocking for external responses. A cache hit or successful provider response is returned even if `audit_logs` or usage-row enrichment fails; the exact database error is written to `server-err.log`.

Quota actions: zero remaining calls display a Quota exhausted banner with Upgrade / Update Plan. The detail page lets admins select an active catalog plan and save the assignment using the existing key-plan API. Used calls are retained; key active/inactive status is separate and unchanged by assigning a plan. No automatic upgrade or payment is performed.

Address correction: key details display “Site / Postal Address” using `application_address`, matching the API-key creation form. `application_url` is not the intended field. Missing addresses display “Not provided”; multiline addresses preserve their formatting.

### Common authentication update

All HTML/page requests now use the same server session guard. Unauthenticated access redirects to `/login?returnTo=...`, which has no sidebar, header, or footer. login.js validates local return paths and redirects after successful authentication. session.js is loaded by both main and key-detail pages and redirects on API 401 responses or failed session checks on pageshow. Removed both embedded login forms and the old app.js-specific 401 handler.

Verified in Chrome after restarting: `/plan/2` redirected to the dedicated login page with no app chrome; successful saved-account login returned to `/plan/2` and displayed Test2, its quota, status, and request history. This replaces the previous detail-page inline authentication architecture.

### Shared layout update

The server composes `/plan/:keyId` with shared-layout.js using the sidebar, topbar, footer, and global styles from index.html as the single source. key-details.css is scoped to page content. shared-account.js now owns the account menu and profile/password dialogs for both main and detail pages. The route remains independent of the legacy Dashboard router.

Verification: restarted the verified port-4173 server; Chrome showed the full shared navigation, topbar, footer, and working account menu. Signed in with the browser's saved login and verified Test2, 10 calls used, 0 remaining, Active status, September history (10 calls, 9 cache hits), and request rows at `/plan/2`. This supersedes the earlier signed-out-only verification limitation. Bills and exports remain pending as previously recorded.

### Latest update: standalone key page

`/plan/:keyId` now serves key-details.html with its own CSS and JavaScript, without loading app.js or the legacy Dashboard router. The ID is an API key ID. Usage table links now target this path. Old `/usage#key=N`, `/usage?key=N`, and `/key=N` entry points navigate to it.

`GET /api/usage/keys/:id` provides key metadata, current-month used calls, all recorded monthly aggregates, and the most recent 100 requests scoped to that key. The page displays quota remaining, active/inactive/expired state, plan and site information. Bills are explicitly unavailable rather than fabricated. `GET /api/usage/keys/:id/export.pdf` and `/export.xlsx` generate real key-scoped downloads for the latest 100 rows shown in Request history.

Verification: JavaScript syntax checks passed. Chrome reload of the old hash URL opened `/plan/2`; reload stayed on the standalone page; sidebar navigation to Usage and browser Back returned correctly. Server restart succeeded and served the new page. Authentication expired on restart, so actual signed-in key data rendering still requires verification. No claim of fully verified authenticated rendering is made.

The paragraphs below describe the earlier implementation and remaining legacy Usage code.

The repeated key-details routing issue remains unresolved by end-to-end verification. Earlier completion claims in this conversation exceeded the evidence. Source changes and syntax checks alone do not establish that the running page works.

The current frontend has multiple route wrappers, hash conversion listeners, duplicate usage renderers, and timer-based overrides. The hashchange listener converts `#key=2` to `/key=2`, which can invoke the Dashboard fallback. Server redirects alone cannot resolve client-side history changes.

The current `/plan/{number}` redirect treats the number as an API key ID, not a plan ID. This identity must be explicit when the final route is implemented.

Monthly billing records and full monthly history have not been implemented. Usage details currently filter the latest 100 global requests, which is not complete per-key history. Exports need repair: CSV is named `.xls`, the PDF action invokes print, and exports are not reliably key-scoped.

## Context sources

- Current chat: Fix blank page and vehicle search.
- Related project chats located: Build vehicle API response UI; Add dashboard charts.
- PROJECT_MEMORY.md: architecture and operational notes.
- EXTERNAL_API.md: external vehicle lookup contract.

Related chat retrieval is partial; do not claim all historical turns have been reviewed.
Plan/top-up executable coverage now assigns an active plan to a temporary key, adds an active package, reloads key details, and verifies the selected key’s plan ID/name, top-up balance, and bill ledger persist. Invalid plan IDs are rejected. The key-detail API now includes the assigned `plan_id` for this verification and client use.

## Latest verification note — 2026-09-24

Newly completed external RC requests finalize their `api_usage_logs` row with registration, provider source, HTTP status, and cache-hit data. Older incomplete rows remain NULL because they cannot be safely reconstructed. Syntax checks passed and the local port-4173 process was restarted; this is not a browser verification of the complete Postman-to-Usage flow.
## Saved Vehicles selection-column correction — 2026-09-25

The Saved Vehicles table now gives the master select-all checkbox a fixed, centered first column and fixed table layout so it cannot overlap the Registration heading. The individual row checkboxes use the same dedicated column. Browser visual verification remains pending.
## Top-up package update correction — 2026-09-25

Fixed the Plan Management top-up package edit submission so it reliably sends the package ID and all editable fields (`name`, `credits`, `price`, and `active`) to `PATCH /api/topup-packages/:id`, reports API errors, and reloads the package list after success. The previous automated test only created a package; it did not call PATCH or verify edited values. The test now verifies all four edited fields, but authenticated CRUD cases were skipped in the latest run because `TEST_ADMIN_EMAIL` and `TEST_ADMIN_PASSWORD` are not configured. JavaScript syntax checks passed; the existing local port-4173 process remained serving, so no restart was performed.
## Plan and top-up deactivation actions — 2026-09-25

Plan Management now exposes a deactivation action for catalog plans and top-up packages. Top-up package updates also treat unchanged values as a successful update when the package exists; the previous `affectedRows` check incorrectly returned “Package not found” for unchanged values. JavaScript syntax and diff checks passed. Authenticated browser verification and live deployment remain pending.
## Follow-up verification — 2026-09-25

The local server was restarted after correcting a misplaced temporary Plan route; port 4173 is listening under Node and the homepage returns HTTP 200. The invalid route was removed. Plan and top-up deactivation controls remain client actions using the existing authenticated PATCH/DELETE APIs. Browser interaction is still pending.
## Top-up edit modal identity fix — 2026-09-25

The edit modal now uses a capture-phase edit handler and explicitly writes the selected package ID into the hidden field before Save. This prevents the existing delegated click handler from leaving the PATCH request without an ID. `app.js` and `server.js` syntax checks, diff checks, and a local `/plans` route check passed. Authenticated browser submission still needs confirmation.
## Top-up save feedback correction — 2026-09-25

Removed the forced page reload after top-up package create/edit. Successful saves now refresh the package table in place, while API/database errors remain visible in the modal. Package names remain unique by database design, so duplicate names return an explicit “Package name already exists” error.
## Chrome verification — top-up CRUD — 2026-09-25

Reproduced the defect in Chrome: the Save package control performed the native form GET, producing `/plans?id=...` in the address bar instead of calling the API. Added an explicit non-submit Save control and guarded form submission. Chrome verification then created `Browser QA Package 20260925D` with 75 credits and INR 149, edited it to 80 credits and INR 159, and confirmed the updated row rendered. Successful saves now refresh the table in place without page reload. A browser-created QA package remains for cleanup.
## Top-up CRUD test coverage — 2026-09-25

Expanded `test/api.test.js` to cover the complete top-up form on create and edit (`name`, `credits`, `price`, `active`), then verify deactivation through DELETE and the refreshed database row. Updated `test/TEST_CASES.md` with the full manual workflow. The latest automated run still skips authenticated cases when test credentials are absent; Chrome create/edit was verified successfully.
## Full local test run — 2026-09-25

Completed local syntax checks for server, client, session, shared-account, key-details, and test JavaScript; `git diff --check` passed. `npm test` completed with 3 passed, 5 skipped, and 0 failed. The skipped cases are authenticated CRUD/module tests because `TEST_ADMIN_EMAIL` and `TEST_ADMIN_PASSWORD` are not configured. Local page routes `/`, `/login`, `/dashboard`, `/plans`, `/usage`, and `/records` all returned HTTP 200. This is not a complete authenticated browser regression run.

## External usage summary — 2026-09-25

Added `GET /api/v1/external/usage` with legacy `/api/external/usage` support. It authenticates the calling site API key without consuming quota or creating a request-history row, then returns period, plan, monthly allowance as `total_calls`, lifetime credited top-up total as `total_top_up_calls`, current-month used calls, monthly remaining calls, current top-up balance, and combined remaining calls. No API-key identity or secret is returned. Syntax and unauthenticated contract verification are required; authenticated key verification remains pending until a test external key is supplied safely.

External RC lookup responses now append the same live `usage` object after each successful cache or provider response, allowing consuming applications to print the updated quota immediately after a hit. The usage summary is read-only and uses the already-recorded request plus the top-up ledger.

API Documentation now includes the read-only usage-summary endpoint, the `total_calls` and `total_top_up_calls` meanings, and an inline response example. Added `test/TEST_STATUS.md` as the current QA status page with automated counts, skipped prerequisites, external API coverage, route checks, load-test status, and known limitations.

API documentation response examples were updated with complete representative RC and usage JSON contracts. The documentation now explains provider/cache fields, vehicle result fields, quota and top-up counters, expiry-status fields, status meanings, dates, and remaining-day values. Examples use the current `DL3SDV7431` response shape and are rendered as formatted JSON in the in-app documentation page.

API documentation navigation is tabwise: Quick start, Authentication, RC lookup, Usage summary, Response, and Errors & limits are separate panels. Only the selected panel is visible, and the large formatted response JSON and field tables are populated when the Response tab is opened.

Documentation response correction: the RC Response tab now documents the live `usage` object as part of the RC response, while the separate Usage summary tab now lazily displays the standalone `/api/v1/external/usage` JSON response and its own field reference.

Documentation layout correction: the generic Response tab was removed. The complete RC response now appears inside RC lookup immediately after the path-parameter table, and the complete usage response appears inside Usage summary after its endpoint details.

Settings integration correction: added upload-or-URL logo fields, login title/subtitle/logo/color controls, and SMTP host/port/user/password/from-email/security fields. Settings are saved through the existing `/api/settings` endpoint; public login branding is read through `/api/public-settings`, while SMTP credentials remain server-side and are not returned to the browser. Mail transport sending/test delivery is not enabled yet.

Login branding correction: the configured login title now updates both the sign-in heading and browser document title; when no custom title exists, the business name is used. Dynamically added Settings controls now reload their saved values from `/api/settings`.

Settings UX correction: Settings is now organized into Business Information, Branding, Login page, and SMTP mail delivery tabs. The login title is the configured application name/logo, with subtitle, background image upload/URL, background gradient, and button gradient controls.

Settings persistence correction: file input controls are excluded from the JSON payload, uploaded files are converted to data URLs before saving into their matching URL setting, and blank SMTP password submissions preserve the existing server-side password. The server also ignores upload-only fields defensively.

Settings duplication correction: the Branding enhancement now reuses the original Branding section instead of adding a second section, so only one consolidated logo upload area is displayed.

API Documentation UI was redesigned around a developer-portal pattern: quick start, sticky in-page navigation, authentication, method/path blocks, copyable cURL, parameter table, usage endpoint, complete JSON response example, quota field table, and error/security guidance. The content follows the project's actual GET endpoints and was informed by the Way2API reference and common API reference patterns; no provider credentials or secrets are shown.

Documentation UI correction: in-page navigation now scrolls explicitly to each section, code blocks fit their content instead of inheriting the application-wide tall response height, and the response example is formatted as readable two-space JSON at render time.

The API Documentation surface now uses the full available content width instead of the legacy 1,240px cap. Test results are integrated into the shared application shell at `#test-status`, registered in the common router, and exposed as the final sidebar item immediately after API Documentation. The page includes automated counts, evidence rows, load-test results, feature verification, and skipped-test prerequisites. The standalone `/test-status.html` remains as a fallback.

Routing correction: added `test-status` to the later clean-page allowlist as well as the primary hash router. This prevents the in-app QA page from being classified as an unknown route and redirected to Dashboard.

Blank-page correction: the clean route normalizes `#test-status` to `/test-status`; the QA renderer now accepts both URL forms, defers after the shared router, and uses a persistent `.test-status-view` shell placeholder. Verified in Chrome at `http://127.0.0.1:4173/test-status`: the Test case status heading, four result cards, automated result table, load-testing result table, and verification notes render in the application shell. No server restart was required because the verified port-4173 process served the updated static assets on reload.

Visual correction: the QA stylesheet is now injected even when the shared-shell placeholder already exists. This restores the dashboard-style white cards, colored result tiles, spacing, borders, and readable tables on the integrated route.

## External lookup queue — 2026-09-28

Implemented the first queue-backed external RC lookup path. Redis/BullMQ is used when `REDIS_URL` is configured, with one provider worker and a five-per-minute limiter aligned to Way2API's documented RC limit. Concurrent requests for the same normalized registration use single-flight behavior so only one provider call is made. The path has bounded waiting, a queue capacity guard, non-charged transient retries, and avoids caching final non-charged provider failures. Local development falls back to a bounded in-process single-flight queue when Redis is unavailable; this fallback is not suitable for multi-instance production. The implementation has not yet received a live Redis or browser concurrency verification; MySQL was unavailable during the last local restart attempt.
## User guidance

The authenticated application now includes a shared-shell **User Guide** page at `/user-guide`, linked from the Vehicle Services menu. It explains vehicle searching, MySQL cache-first behavior, Redis/BullMQ single-flight handling for concurrent searches, API Usage interpretation, API-key usage, quota/top-up behavior, common errors, and local testing. The existing **API Documentation** page remains the authoritative request/response reference.
Charge-aware cache correction (2026-10-01): the external lookup read path now ignores legacy cached responses with `charged: false`, including stale `REQUEST_FAILED`/`backend_down` rows, so the normal retry flow can call Way2API again. Charged cached errors preserve their original HTTP status. Worker and regression tests pass; no server restart was performed.
Settings UI update (2026-10-01): Expiry refresh policy is now presented as its own Settings tab, separate from Business Information. The tab contains independent PUCC, insurance, and registration/fitness refresh intervals.
