# ADR 0040: Persistent historical run context

Issue: #111

## Decision

The workspace header keeps the current-run query subscribed independently of
pane visibility. When the selected run differs from the server's current run,
it shows a persistent historical-run notice and an explicit link back. A newer
run arriving through the live stream updates this notice without navigating or
changing the user's selection. The run list is not used to infer recency.
Root `agent.started` events refresh the run list/current alias and project detail,
matching `context.opened`; child starts retain their narrow agent-list refresh.

Inspector evidence is labelled "Selected run", including its entries in the
cross-run history. Connection status explicitly names the connection. The
historical notice explains that the architecture is the latest loaded project
model, whereas the inspector's run-scoped evidence belongs to the selected run.
No historical architecture snapshot is invented or fetched.

## Consequences

The header may use an additional row for historical context so collapsing panes
or entering deep focus cannot conceal it. The existing left-pane explanation
remains available. Unknown current-run data does not establish historical status;
the existing query/error behavior remains unchanged.
