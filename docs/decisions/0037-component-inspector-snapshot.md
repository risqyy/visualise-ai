# 37. One read-only snapshot per component inspector response

- **Status:** accepted
- **Context issue:** #96
- **Builds on:** [0005 — Read API shape and run scoping](0005-read-api-shape-and-run-scoping.md)

The inspector combines the project head, selected run, component and several
evidence collections. Separate autocommit reads could mix states across concurrent
commits while labelling the whole response with the earlier project position.

The public `Component` read now owns a read-only PostgreSQL Repeatable Read
transaction, matching the architecture and context readers. All inspector helpers
use that transaction. Current-run resolution, removed-component history probes
and diff pagination therefore share the response's snapshot.

The transaction lasts only for one response; it does not hold a snapshot between
pagination requests or lock writers. HTTP schemas and selection rules are unchanged.
A PostgreSQL regression commits model, work, evidence and current-run changes
immediately after the head query and verifies that the complete response still
matches the prior state while the next request sees the new commits.
