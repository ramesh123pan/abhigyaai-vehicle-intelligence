# Vehicle Desk project profile

Updated: 2026-09-23

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

Plan Management uses responsive pricing cards, and create/edit forms open in a modal popup. The Dashboard API Plans section uses compact summary cards with pricing, limits, Popular styling, and a View all plans link.

External lookup resilience: metadata logging errors are now logged to `server-err.log` but do not block a valid cache/provider response. The external API remains responsible for authentication, plan, and quota errors.

Charged provider failures: the external gateway now stores the raw Way2API response in `vehicle_cache` even when Way2API returns a non-2xx verification result such as HTTP 422 with `charged: true`. The response is returned with its provider status, and later requests use the cached result within the cache TTL to avoid another paid call. Usage rows are finalized for both successful and failed provider responses.

Cached charged failures preserve their provider HTTP status. A cached Way2API body with `charged: true`, `success: false`, and `status_code: 422` is returned by the gateway as HTTP 422 rather than being mislabeled HTTP 200.

RC validation is enforced before any provider call on both `/api/rc-lookup` and `/api/v1/external/rc/:registration`. The final registration series must contain four digits; invalid values such as `UP16AN593` return HTTP 400 and do not consume quota or call Way2API.

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
