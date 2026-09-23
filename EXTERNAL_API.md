# External RC Lookup API

## Implementation notes — 2026-09-22

Admin-only detail endpoint: `GET /api/usage/keys/:id` returns `key`, `months`, and `recent`. Monthly totals cover all recorded history for that API key; recent requests are limited to the latest 100 for that key. It returns 401 without an admin session and 404 for an unknown key. No key secret or hash is returned. The standalone UI is `/plan/:keyId` (API key identity, not catalog plan identity).

The gateway also checks the assigned active API plan and a monthly quota. The admin usage endpoint is `GET /api/usage` and returns `month`, `keys`, and `recent`; `recent` is limited to the latest 100 global requests. It is not a full per-key monthly report or a billing ledger.

For a particular site key, `GET /api/usage/keys/{id}/export.pdf` and `GET /api/usage/keys/{id}/export.xlsx` download the latest 100 request-history rows for that key. These endpoints require the admin session and are the same exports available as inline actions in the `/plan/{id}` Request history header.

New gateway requests record operational metadata in `api_usage_logs`: client IP, forwarded IP chain, user-agent, device category, accepted language, referer, host, and location status. The service does not infer exact geographic location from a private/local address, and no external IP geolocation service is configured. Existing records cannot be backfilled reliably.

Provider responses are cached even when verification fails after a charge. For example, a Way2API HTTP 422 response with `charged: true` is stored as the raw vehicle-cache response for the normal cache TTL, so repeated requests do not immediately create another paid provider call. The external response keeps the provider HTTP status and body.

Registration validation occurs before authentication quota consumption reaches the provider call. Use the four-digit final series format, for example `UP16AN0593`; `UP16AN593` returns HTTP 400 and is never sent to Way2API.

The gateway also checks the state/UT prefix against the supported Indian code list, requires exactly two RTO digits and one-to-three alphabetic series characters. This is format validation; official issuance still requires a government registry lookup.

BH-series values matching `YYBH####A/AA` are also accepted. Diplomatic and vintage legacy formats are rejected because they require separate provider handling.

Known logging gaps: internal admin lookups are not recorded in `api_usage_logs`, and some failed external calls leave vehicle/status fields null. Do not infer that empty or incomplete usage rows prove no lookup occurred. Key-details routing and exports remain pending full verification; see PROJECT_PROFILE.md.

## Endpoint

```http
GET http://127.0.0.1:4173/api/v1/external/rc/{registration_number}
```

Use the production host instead of `127.0.0.1` when deployed.

## Authentication

Send an external API key in either format:

```http
X-API-Key: vdesk_your_key
```

or:

```http
Authorization: Bearer vdesk_your_key
```

External keys are separate from admin login credentials. Create one while authenticated as an admin:

```http
POST /api/external-keys
Content-Type: application/json

{"name":"Fleet Application","rateLimitPerMinute":60,"dailyLimit":1000,"expiresAt":"2027-12-31","allowedIps":"203.0.113.10,203.0.113.11"}
```

The raw key is returned once. Store it securely; it cannot be recovered later. Keys can be listed without the secret, updated, rotated by deactivation/new key creation, or deactivated by ID. Each key supports a per-minute limit, daily quota, optional expiry, and optional comma-separated IP allowlist.

## Example

```bash
curl -H "X-API-Key: vdesk_your_key" \
  http://127.0.0.1:4173/api/v1/external/rc/UP16FA0981
```

The endpoint serves a valid cached MySQL response for up to 30 days. On a cache miss it uses the configured Way2API provider, stores the response, and returns it. External requests are written to the audit log with the API client name and vehicle number.

## Common errors

- `401` — missing or invalid API key
- `400` — invalid registration number
- `403` — the key is expired or the caller IP is not allowlisted
- `429` — per-minute rate limit or daily quota exceeded
- `500` — provider configuration or server error

Never expose an external API key in frontend JavaScript or public repositories. Put the API behind HTTPS in production, keep it server-to-server, and use a separate key per consuming application so access can be revoked independently. The API is cache-first: a valid cached record is returned without a paid provider call until the cache TTL expires.
