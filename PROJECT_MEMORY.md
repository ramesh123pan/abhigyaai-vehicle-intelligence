# Vehicle Desk — Project Memory

## Production deployment — 2026-09-23

CyberPanel Git is attached to `rcvd.xims.au` from the GitHub `main` branch. The MySQL dump was imported into `xims_rcvd`; the server verified the application tables, 5 `vehicle_cache` records, and 2 `admins` records. PM2 process `abhigyaai` is online and serves port 4173. The production `.env` is kept only on the server. A real `WAY2API_API_KEY` still needs to be entered before live provider calls can run.

The public domain initially returned LiteSpeed 404 for `/api/profile` and `/api/plans` because only static files were configured. The vhost was updated with a LiteSpeed proxy processor and `/api/` context to forward requests to Node port 4173. Public API checks now return Node's JSON `401 Authentication required` response when unauthenticated, confirming routing is fixed.

No `.htaccess` is needed for this configuration; the vhost-level proxy is the working route. A standalone rewrite rule without a defined LiteSpeed external app produced 500 and was removed.

Clean login routing is handled by a server-side `login` alias to `login.html` because the current LiteSpeed static setup did not apply `.htaccess` rewrites. The public login URL now returns HTTP 200 with its `returnTo` query preserved.

Imported admin hashes were created with an empty pepper; production login failed while a new pepper was configured. The production pepper was aligned with the imported database and PM2 restarted. Admin password should be changed after successful login.

Clean client routes were missing static aliases on production. Aliases to `index.html` were added for dashboard, vehicle services, admin pages, plans, usage, audit, and settings; direct `/dashboard` and `/pucc` checks return 200.

The route aliases were then removed in favor of the scalable LiteSpeed vhost root proxy to Node port 4173. Node now receives all clean page URLs and API calls, so new routes do not require new server files. Protected pages correctly return 302 to login, while `/login` is served by Node with HTTP 200.

## Status correction — 2026-09-22

Shared layout update: shared-layout.js composes details with index.html's sidebar/topbar/footer and global styles. shared-account.js is used by both pages for account controls. key-details.css is content-scoped. Authenticated Chrome verification now confirms Test2 data and shared chrome at `/plan/2`; account dropdown opens correctly. Request history exports are real PDF/XLSX files and are exposed as inline icon actions in the section header.

Latest routing change: `/plan/:keyId` is now a separate HTML page (key-details.html, key-details.js, key-details.css). It loads `/api/usage/keys/:id` and cannot run the legacy Dashboard router. Usage links target the new route. Chrome verified old hash-link migration, refresh, sidebar navigation, and Back while signed out after restart. Signed-in content remains unverified. See PROJECT_PROFILE.md for scope and limitations.

Read PROJECT_PROFILE.md for the current requirements and unresolved work. Older browser-route notes below describe the original hash-based implementation, not the desired final routing.

The user requires updates to project Markdown and profile files after each implementation change; AGENTS.md records this workflow.

Request history export update: PDF and Excel actions now live inline in the Request history section heading. They call `/api/usage/keys/:id/export.pdf` or `/export.xlsx`, and the generated files contain the same latest 100 key-scoped rows shown in the table. PDF/XLSX generator checks passed; the last server restart cleared the browser session, so a signed-in browser click test remains pending.

The Request history table now supports client-side search and ascending/descending sorting by vehicle, endpoint, HTTP status, source, and timestamp, with a filtered count.

External request metadata now captures IP, forwarded chain, user-agent, device category, language, referer, host, and privacy-safe location status in `api_usage_logs`; key details and exports show IP/device/location. Existing rows remain blank for fields not previously stored.

Metadata implementation verified by syntax checks and a live port-4173 restart. Geographic lookup is intentionally not performed: public IP location would require a configured provider, while local/private addresses cannot yield a geographic location.

The login page now avoids showing the sign-in form to an active session: the server redirects authenticated `/login` requests, and login.js performs a no-store session check for cached documents.

Key detail routing remains unverified and repeatedly falls back to Dashboard. Multiple route wrappers and the hashchange conversion of `#key=2` to `/key=2` conflict with the detail renderer. Timer patches and server redirects have not demonstrated a complete fix. Do not attribute this to browser caching without evidence.

Plan form saving was verified in-browser after replacing the form `.id` check with `getAttribute('id')`: a hidden input named `id` shadows that property. The test changed Default's limit to 1,100 at that time; this is not a statement of its current database value.

Usage endpoint duplicate-handler removal was implemented. Normal admin searches do not create external API usage rows. External failed requests may retain null vehicle/status fields. Key detail history currently uses only the latest 100 global usage records. Monthly bills and genuine Excel/PDF exports remain unfinished.

Documentation update verification: source and project notes inspected; no runtime fix or server restart performed as part of this documentation update.

## Purpose

Plan page presentation now uses pricing cards; plan creation and editing open in a modal, while Dashboard plan summaries use compact cards.

The metadata insert is isolated from the external lookup response path. If a new metadata column or value fails, the server logs the database error and still serves the vehicle result; the failed metadata row must then be repaired from the logged error.

The external cache/provider response path now treats audit writes as non-blocking too. This prevents an audit-table failure from becoming `External lookup failed`.

Audit ordering was corrected: `api_usage_logs` is finalized first; `audit_logs` is best-effort afterward. This preserves vehicle/status/source/cache fields for successful external cache responses.

External gateway behavior was corrected for charged verification failures: all Way2API response bodies are cached, not only 2xx responses. A 422 charged failure is saved with provider `way2api`, status 422, and cache hit 0; subsequent calls return the cached failure with cache hit 1 instead of charging Way2API again.

The common JSON response helper now preserves a cached charged failure's provider status code, including HTTP 422.

All RC entry points now require the four-digit final registration series before live lookup. `UP16AN0593` and Delhi's `DL3SDV7431` are valid; `UP16AN593` and `UP1A5930` are rejected before provider access. The parser checks the standard two-digit numeric RTO form first, then handles Delhi's alphanumeric zonal RTO format separately.

The validator now also requires a known Indian state/UT prefix, exactly two RTO digits, and one-to-three series letters. `UP1A5930` is rejected before authentication/quota/provider work.

BH-series registrations such as `22BH5021AA` are accepted. Diplomatic and old legacy formats remain blocked until provider-specific support is implemented.

The `/usage` Recent API hits table now supports client-side search, sorting, pagination, and result counts.

The Usage page no longer presents one large card around all content; its dashboard components are visually independent cards/sections.

Key details now requests and renders all metadata for the latest 100 requests, and the detail exports match those columns.

The Usage page Recent API hits table is wrapped in its own independent card, separate from summary cards and the activity chart.

The API key summary table is styled as a separate white card as well.

Usage stat cards were updated to match the Dashboard with colored gradients and type-specific icons; the server was restarted after the style update.
Dashboard stat and critical vehicle information cards now use their own gradient colors and type-specific icons, with existing values and layout preserved.
API Usage cards were aligned with the Dashboard surface system so KPI, activity, key-summary, and Recent API hits sections do not appear as nested or uneven cards.
The final Usage cascade removes the outer `records-page` card and applies Dashboard-like page spacing so each Usage section reads as its own clean surface.
API Usage table rows now visually separate like Dashboard records using spaced rows, bordered cells, rounded row edges, and hover highlighting.
Recent API hits was tightened into one cohesive card with aligned toolbar, responsive fixed column proportions, compact rows, and horizontal overflow only on narrow screens.
The Recent API hits visual pattern now matches Dashboard Recent Records, including heading margins, subtitle padding, light header styling, and flat row separators.
Corrected the Site-key Request history column mismatch and synchronized the Usage table headings with its rendered metadata cells.
Replaced the unguarded Usage table MutationObserver with a bounded, guarded synchronization so the page does not enter a DOM rewrite loop.
Removed the shared cache-notice paragraph that created unwanted text above the Usage cards.
The duplicate inner Usage heading is hidden; the main page title remains visible.
Added `topup_credits` and `api_topup_ledger`; external requests consume monthly allowance first and then one top-up credit per call. Key details expose the balance and admin-confirmed credit form. Payment processing remains intentionally unconnected until a provider is selected.
Added fixed top-up package CRUD APIs/UI, package dropdown selection on key details, and bill-history rendering from the top-up ledger. Prices are server-controlled; payment gateway integration is still pending.
Header now includes a compact search/suggestion experience, current API-call summary pill, and profile name/Manager presentation inspired by the supplied NexLink reference.
Added profile image upload/storage with circular avatar rendering and initials fallback; standalone header logout was removed in favor of dropdown logout.
Changed the header account control to a transparent circular-avatar profile block showing name, role, and email like the supplied reference.
The header profile block now hides email and shows only name plus role; dropdown summary retains name and email.
The account control includes an explicit chevron dropdown symbol.
The left sidebar-collapse icon next to the search was hidden per the reference header design.
Header controls are arranged in three responsive columns with the search filling its column and API summary centered.
Profile control order is text, dropdown chevron, then circular avatar on the right, matching the supplied visual pattern.
Header width is no longer capped by the old max-width, and desktop controls use equal one-third columns with the role chevron on the left.
Fixed horizontal scrolling by constraining the header shell to viewport width minus the fixed sidebar while keeping its inner grid full width.
Live measurement confirmed header left/right boundaries; added `overflow-x:hidden` at the document level so only intentionally scrollable tables can overflow locally.
Added `/api/usage/today` and switched the header pill to the actual current-day request count.
Fixed Usage Recent API hits initial render so pagination/search metadata columns are applied immediately; toolbar layout is forced below the card heading.

Usage Recent API hits now renders page-size choices and numbered pagination in addition to Previous/Next.

Added delayed reconciliation after initial API data load to preserve the paginated body and enforce separate heading, toolbar, and table blocks.

Prevented the legacy usage column synchronizer from overwriting the paginated Recent API hits renderer. The extra audit columns are intentional; Details is the key navigation action.

Usage pagination now guards against NaN page-size and page values, preventing valid results from being sliced away.

Usage API now returns all request metadata fields needed by the Recent API hits table instead of only the legacy six fields.

Recent API hits now uses fixed proportional columns with wrapped long metadata values to avoid clipped/misaligned columns.

External RC responses expose normalized expiry labels for PUCC, insurance, and registration/fitness dates, making direct printing straightforward.

API Documentation includes the new expiry_status response contract and example.

Official product name: AbhigyaAI Vehicle Intelligence; parent company: Xpansion Technologies.

Vehicle Desk is a local RC/vehicle information dashboard for searching Indian vehicle registration numbers, storing provider responses in MySQL, and serving repeat lookups from a local cache.

## Runtime

- Workspace: `C:\Users\admin\OneDrive\Documents\ChatGPT\RCLorryinfo`
- Local URL: `http://127.0.0.1:4173/`
- Start command: `node server.js`
- Main files:
  - `server.js` — HTTP server, provider calls, authentication, MySQL cache, API routes
  - `app.js` — browser routing, lookup UI, dashboard, tables, filters, authentication flow
  - `index.html` — page markup and current UI overrides
  - `styles.css` — base styles
  - `.env` — local credentials; never expose or print values
  - `env.example` — safe placeholder template only

## Environment variables

Provider and database values are read from `.env`.

Admin accounts are stored in the MySQL `admins` table. Admin credentials are not stored in `.env`. The table stores name, unique email, phone, password hash, role, active state, and creation time. `PASSWORD_PEPPER` is optional and may be kept in `.env` as a server-side password-hardening secret.

Do not commit `.env`, API keys, database passwords, password peppers, or passwords.

## Authentication

- Shared server guard redirects unauthenticated HTML/page requests to `/login?returnTo=...` before rendering the application shell.
- login.html/login.js are the common standalone sign-in screen, with a validated local return URL.
- session.js handles expired sessions for both app.js pages and key-details.js pages. There are no inline per-page login forms.
- Verified login redirect and successful return to authenticated Test2 details in Chrome on 2026-09-22.

- Login endpoint: `POST /api/auth/login` using email and password
- First-admin setup endpoint: `POST /api/auth/setup` with name, email, phone, and password; works only when the admins table is empty
- Add-admin endpoint: `POST /api/admins`; requires an authenticated session
- Session endpoint: `GET /api/auth/me`
- Logout endpoint: `POST /api/auth/logout`
- Sessions use an HttpOnly, SameSite=Strict cookie and expire after 8 hours.
- All `/api/*` routes require an authenticated session.
- Current access level is `admin`; the session response already includes an access field for future role-based permissions.
- Admin CRUD is available from the Admin Users page with popup add/edit forms, activate/deactivate actions, and inline validation.

## Provider behavior

- Way2API is the default provider.
- Provider selection is intentionally not exposed in the UI.
- LorryInfo support remains in the server for existing cached records and compatibility.
- Never display provider API keys or full credentials in the browser.

## MySQL cache behavior

Table: `vehicle_cache`

- Primary key: `(vehicle, provider)`
- Stores the complete provider response as JSON.
- Cache TTL: 30 days.
- Manual live refresh cooldown: 7 days per vehicle.
- Normal lookup searches the newest cached record by vehicle, regardless of provider, before making a live request.
- This prevents duplicate paid calls when the same registration was previously saved by another provider.

## API routes

- `POST /api/rc-lookup` — cache-first vehicle lookup; supports explicit refresh
- `GET /api/dashboard` — dashboard totals, critical dates, and up to 50 recent records
- `GET /api/records` — all unique saved vehicle records for the Saved Vehicles page
- `POST /api/auth/login` — sign in
- `GET /api/auth/me` — session check
- `POST /api/auth/logout` — sign out
- `GET /api/admins`, `POST /api/admins`, `PATCH /api/admins/:id`, `DELETE /api/admins/:id` — admin management
- `GET/PATCH /api/profile` and `POST /api/profile/password` — profile and password management
- `GET /api/audit` and `POST /api/audit/event` — activity audit trail
- `GET/PUT /api/settings` — business and branding settings
- `GET /api/v1/external/rc/:registration` (legacy `/api/external/rc/:registration` also accepted) — protected external cache-first RC lookup
- `POST/GET/PATCH/DELETE /api/external-keys` — create, list, update, and deactivate external API keys

## Browser routes

- `#dashboard` — dashboard cards, critical dates, recent-records card
- `#search` — registration lookup and detailed response view
- `#records` — Saved Vehicles table with search, pagination, and View action
- `#pucc` — PUCC Monitoring with search/status/date filters
- `#insurance` — Insurance Expiry with search/status/date filters
- `#fitness` — Fitness & Tax with search/status/date filters
- `#activity` — API Activity history
- `#admins` — Admin Users management
- `#audit` — searchable/sortable Audit Log
- `#settings` — business and branding settings

## UI conventions

- Zero remaining calls show Quota exhausted and an Upgrade / Update Plan action. Plan assignment retains monthly usage and does not activate inactive or expired keys.

- Site key details show Site / Postal Address from external_api_keys.application_address, not application_url.

- Light admin-style layout with a fixed dark sidebar.
- Sidebar width is compact (220px desktop, 190px at smaller widths).
- Header contains saved-record search and Logout; no duplicate header navigation menu.
- Footer begins after the sidebar and uses the full content width.
- Visible labels use consistent title-style capitalization.
- Search and record detail UI share the same normalized field renderer.
- Data tables support searching and sortable column headers; action buttons use icons with tooltips.
- Saved Vehicle details open in a popup instead of redirecting to Search.
- Footer uses a full-height layout and stays at the bottom on short pages.

## Vehicle response normalization

Common fields are mapped from both provider formats, including:

- Registration number
- Owner and addresses
- Manufacturer/model
- Fuel, body type, category
- Chassis and engine
- Insurance and tax dates
- Fitness date
- PUCC number and PUCC expiry date
- Status and technical specifications

Provider-specific response JSON is still retained in MySQL for audit/raw-response access.

## Safe development notes

- Use `apply_patch` for source edits.
- Do not print `.env` contents.
- Keep `env.example` limited to placeholders; never copy real credentials into it.
- External API integration details are documented in `EXTERNAL_API.md`; external keys are stored as SHA-256 hashes and shown only once at creation. Keys support per-minute rate limits, daily quotas, expiry dates, and optional IP allowlists. External calls are audited and use MySQL cache before Way2API.
- After server changes, restart the Node process on port 4173.
- Verify the browser UI after layout changes.
- Preserve the cache-first behavior unless a user explicitly requests a live refresh.
- API documentation endpoint examples are origin-aware: production displays `https://rcvd.xims.au/api/v1/external/rc/...`, while local development displays the localhost endpoint.
