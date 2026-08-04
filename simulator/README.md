# Event simulator

A deterministic developer and test client for the cockpit. It reports a complete,
representative agent run through the published contract, so the UI has something
to show and the end-to-end acceptance test has something to assert on.

It talks to **one** URL: `<base>/api/v1/events`, the public Nginx route. It knows
nothing about internal ports and nothing about the database.

## Usage

```bash
cd simulator
npm install

npm run simulate                            # full run against http://localhost:8080
npm run simulate -- --base http://localhost:8091
npm run simulate -- --speed 0               # no pauses, for CI and E2E
npm run simulate -- --scenario retry        # idempotent redelivery
npm run simulate -- --scenario conflict     # reused client event id
npm run simulate -- --help
```

| Flag | Meaning | Default |
| --- | --- | --- |
| `--base <url>` | Public entry point, scheme and host only | `http://localhost:8080` |
| `--project <id>` | Project to report under | the scenario's own project |
| `--run <id>` | Run id | the scenario's own run id |
| `--speed <factor>` | Pause multiplier: `1` normal, `0` none, `2` twice as slow | `1` |
| `--scenario <name>` | `full`, `retry` or `conflict` | `full` |
| `--seed <n>` | Seed of the id, pause and clock streams | `20260804` |
| `--finish <bool>` | Whether the full run sends `run.finished` | `false` |
| `--json` | Machine-readable summary on stdout, narrative on stderr | off |

## Scenarios

| Scenario | Project | Run | What it demonstrates |
| --- | --- | --- | --- |
| `full` | `visualise-ai` | `run-2026-08-04-0001` | The representative run: 62 events, every event type except the optional `run.finished` |
| `retry` | `visualise-ai-retry` | `run-2026-08-04-0002` | `201`, then a byte-identical redelivery answering `200 duplicate: true` with the **same** position |
| `conflict` | `visualise-ai-conflict` | `run-2026-08-04-0003` | The same `clientEventId` with different content answering `409 client_event_id_conflict` |

Each scenario opens its own run with its own root orchestrator and writes into
its own project, so none of them turns another one's run into the cockpit's
current run. All three expect an empty database: against a populated one the
first delivery is legitimately a duplicate, which is correct but not what the
probes assert.

The `full` run leaves the run **open** by default. `run.finished` is optional by
contract and no state is derived from silence, so an unterminated run is the more
honest — and more interesting — cockpit state. `--finish true` closes it.

## Determinism

Every client event id, every pause and every `occurredAt` is drawn from a seeded
generator. `Math.random`, `Date.now` and `crypto.randomUUID` are refused by the
ESLint config. Two runs with the same seed against empty databases produce the
same events, the same positions and therefore the same read models.

## Development

```bash
npm run lint
npm run typecheck
npm test
```

The tests cover determinism, conformance of every generated event to
`IngestEventRequest`, the lifecycle preconditions the backend enforces, coverage
of the closed event catalogue, and the structural cases the end-to-end acceptance
test depends on.
