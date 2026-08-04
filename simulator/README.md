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
npm run simulate -- --scenario self         # this repository, reporting on itself
npm run simulate -- --help
```

| Flag | Meaning | Default |
| --- | --- | --- |
| `--base <url>` | Public entry point, scheme and host only | `http://localhost:8080` |
| `--project <id>` | Project to report under | the scenario's own project |
| `--run <id>` | Run id | the scenario's own run id |
| `--speed <factor>` | Pause multiplier: `1` normal, `0` none, `2` twice as slow | `1` |
| `--scenario <name>` | `full`, `retry`, `conflict` or `self` | `full` |
| `--seed <n>` | Seed of the id, pause and clock streams | `20260804` |
| `--finish <bool>` | Whether the full run sends `run.finished` | `false` |
| `--json` | Machine-readable summary on stdout, narrative on stderr | off |

## Scenarios

| Scenario | Project | Run | What it demonstrates |
| --- | --- | --- | --- |
| `full` | `visualise-ai` | `run-2026-08-04-0001` | The representative run: 62 events, every event type except the optional `run.finished` |
| `retry` | `visualise-ai-retry` | `run-2026-08-04-0002` | `201`, then a byte-identical redelivery answering `200 duplicate: true` with the **same** position |
| `conflict` | `visualise-ai-conflict` | `run-2026-08-04-0003` | The same `clientEventId` with different content answering `409 client_event_id_conflict` |
| `self` | `visualise-ai-self` | `run-v0-epic-1` | 122 events reporting **this repository**: 28 components, 35 relationships, 10 agents, 7 diffs — nothing invented |

Each scenario opens its own run with its own root orchestrator and writes into
its own project, so none of them turns another one's run into the cockpit's
current run. All four expect an empty project: against a populated one the first
delivery is legitimately a duplicate, which is correct but not what the scenarios
assert.

The `full` run leaves the run **open** by default. `run.finished` is optional by
contract and no state is derived from silence, so an unterminated run is the more
honest — and more interesting — cockpit state. `--finish true` closes it. `self`
leaves its run open for the same reason and has no `--finish`.

### `self` — the cockpit on its own architecture

`full` is a fiction. It shows a shop platform with an orders service, a payment
provider and two NATS topics, because it has to exercise every structural feature
the contract has, including the ones this project does not use.

`self` is the opposite: **every statement it sends is derived from this
repository**, and where the evidence stops, the scenario stops.

| What | Where it comes from |
| --- | --- |
| Components | the directory tree, `docker-compose.yml`, `backend/go.mod`, `frontend/package.json`, the two Dockerfiles |
| Relationships | the real Go imports, the real `@/…` TypeScript imports, the `location` blocks of `frontend/nginx/default.conf.template` |
| Agents and plan | the sixteen merged pull requests of epic #1, `assignedTask` and plan step titles verbatim |
| Feedback, risks, problems | the ADRs under `docs/decisions/`, quoted with their source |
| Diffs | `git show <commit> -- <path>`, shortened with recomputed hunk headers |

The consequences are deliberate and are asserted by `test/self.test.ts`:

- **There is no `nats_topic` relationship**, no `queue` and no `topic` component.
  This project has no message bus. The contract has the kind and `full`
  demonstrates it; reporting one here would be a fabrication. A test refuses it
  by name so nobody adds one later to make the picture richer.
- The only relationship kinds are `http`, `data`, `dependency` and `async` —
  there is no gRPC anywhere in this repository either.
- The snapshot describes the model **before the changes the run reports**:
  `frontend/src/backendStatus.ts` still exists (PR #19 deleted it),
  `frontend/src/api/generated/` does not (PR #25 added it), and the Nginx probe
  edge is missing (the contract denied it until PR #30). Applying the reported
  changes ends at the repository as it is today.
- The plan has two revisions. Revision 2 is not decoration: PR #25 had to be
  inserted after the canvas landed, because the hand-written read model types
  described an API the contract never had.
- One proposal is planned and withdrawn (the full replay per page load that
  ADR 0010 records as rejected), and one stays open (the `RepositoryProvider`
  attachment point that `docs/security-and-boundaries.md` describes and
  deliberately leaves undecided).
- One `correction.issued` fixes a claim the contract really made: that `/healthz`
  and `/readyz` were not reachable from outside the Compose network. PR #30
  corrected it after curl against the published port answered `200`.

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
