# 0031 — Shared domain adapters and explicit work context

Status: accepted for local implementation of #79; builds on 0029 and 0030.

MCP registers only implemented catalogue tools. Generate its complete local
input/output schemas from the same frozen source as the concrete REST events.
Use the SDK's raw-argument handler to preserve number spelling and full command
identity; validate both inputs and successful structured outputs explicitly.
Every write calls `ingest.Service.Submit`, sharing the append transaction and
post-commit publication with REST. Typed context/work reports reuse existing
projections inside one original event, without creating synthetic log entries.

Persist explicit scope per project/run/agent. Read scopes, agents, missing
references and counters in one snapshot, shared by MCP and REST hydration.
Keep the legacy REST `current` alias in the REST wrapper; MCP run IDs are literal.
Deduplicate and batch reference existence checks to bound SQL parameter counts.
Continuation cursors are signed and snapshot-bound, with invalidation on process
restart. Model page preparation currently holds the full consistent graph;
targeted element reads query exactly one descriptor and all outputs are bounded.

Work-step component associations must be run-scoped. Reconstruct old association
ownership from accepted start/correction history and preserve unassignable links
under an empty run ID instead of assigning guessed scope. Enforce ownership
across REST and MCP so a legacy write cannot take over a typed step. Preserve
legacy starts referring to planned components; typed starts require current
components. Same-owner corrections can amend metadata after closure while
retaining the original component set. No activity is inferred from transport,
model mutation or silence.

Trade-offs: signed cursors must be restarted after backend restart; full model
page preparation uses memory proportional to model size. These are explicit
limits, not alternate identity or consistency rules. Views/rendering and canvas
scope presentation remain owned by the following epic issues.
