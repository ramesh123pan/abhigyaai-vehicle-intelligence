# Local Redis testing

The application expects Redis at `redis://127.0.0.1:6379` when `REDIS_URL` is set. Redis is used for BullMQ queue coordination and shared rate-limit counters. MySQL remains the durable source of truth.

## Docker Desktop

Start Docker Desktop first, then run PowerShell:

```powershell
docker run --name rc-lorryinfo-redis -p 6379:6379 -d redis:7-alpine
docker ps
```

If the container already exists, run `docker start rc-lorryinfo-redis`.

Verify the Redis port with `Test-NetConnection 127.0.0.1 -Port 6379`.

Stop it when finished with `docker stop rc-lorryinfo-redis`. Remove disposable test data with `docker rm rc-lorryinfo-redis`.

## Configure the application

Copy `env.example` to `.env` and set:

```dotenv
REDIS_URL=redis://127.0.0.1:6379
EXTERNAL_QUEUE_ENABLED=true
```

Restart the server after changing `.env`. Startup should report that the Redis/BullMQ worker is enabled. If it reports the local fallback, Redis was not reachable or the URL was not loaded.

## Smoke checks

```powershell
Test-NetConnection 127.0.0.1 -Port 6379
Invoke-WebRequest http://127.0.0.1:4173/health/live
Invoke-WebRequest http://127.0.0.1:4173/health/ready
```

Readiness also requires MySQL, so Redis can be healthy while readiness remains `503` when MySQL is unavailable. Authenticated/provider tests additionally require MySQL, `SESSION_SECRET`, test-admin credentials, an external API key, and provider credentials.

The automated test suite loads `.env.test` automatically when it exists. That file is Git-ignored and is intended for local test configuration and credentials only; it must never be committed or copied into project documentation. The file includes the local Redis queue settings and an empty `TEST_EXTERNAL_API_KEY` slot. Fill that slot only with a generated application/site key when running external RC tests.

## Verified local result

On 2026-10-01, Docker Redis was started as `rc-lorryinfo-redis`; port 6379 and `redis-cli ping` returned `PONG`. A project startup with `REDIS_URL` reported `External queue: Redis/BullMQ worker enabled`. The application server must be restarted with that environment variable for the running process to use Redis.
