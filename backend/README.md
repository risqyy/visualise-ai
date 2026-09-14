# Backend tests

Run these Bash commands from the repository root with Go (the version in
`go.mod`) and Docker installed. The full backend suite requires PostgreSQL 17;
plain `go test ./...` without `TEST_DATABASE_URL` skips the database tests.

Use a disposable test database: fixtures truncate tables and exercise migrations.
Never point `TEST_DATABASE_URL` at an application database. This container binds
only to loopback and is separate from the application's Compose database.

```bash
docker run -d --rm --name vai-backend-test-pg \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test \
  -p 127.0.0.1:55432:5432 \
  --health-cmd 'pg_isready -U test -d test' \
  --health-interval 2s --health-timeout 5s --health-retries 15 \
  postgres:17-alpine
```

Wait until the following command reports `healthy` before running the suite:

```bash
docker inspect --format '{{.State.Health.Status}}' vai-backend-test-pg
```

Build, vet and run every package against that database, with test caching disabled:

```bash
(
  cd backend &&
  go build ./... &&
  go vet ./... &&
  TEST_DATABASE_URL='postgres://test:test@127.0.0.1:55432/test?sslmode=disable' \
    go test -count=1 -p 1 ./...
)
```

Keep `-p 1`: although HTTP, read API and SSE fixtures have separate schemas,
store and MCP tests share the default schema. Parallel packages or simultaneous
test commands against the same database can invalidate each other's fixtures.

The required `backend (go)` CI job uses the same suite and a healthy PostgreSQL 17
service, with disposable credentials and no repository secrets. Missing database
configuration fails before the suite starts; connection or migration errors fail
the database tests. Tests requiring a published MCP endpoint or a built Chromium
render page still use their separate opt-in environment variables; the mandatory
[Compose E2E gate](../e2e/README.md) covers the deployed application.

Stop the disposable container after testing (this also removes its test data):

```bash
docker stop vai-backend-test-pg
```
