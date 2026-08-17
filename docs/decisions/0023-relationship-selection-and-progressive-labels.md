# 23. Relationship selection is a typed deep link and labels are progressive

- **Status:** accepted
- **Date:** 2026-08-17
- **Context issue:** #57
- **Builds on:** [0008 — Architecture canvas layout and edge bundling](./0008-architecture-canvas-layout-and-edge-bundling.md),
  [0012 — Component inspector and markdown safety](./0012-component-inspector-and-markdown-safety.md),
  [0018 — Accessible architecture nodes](./0018-accessible-architecture-nodes.md)

## Context

Relationship labels are drawn on the route midpoint. Full reported channel,
operation and protocol text makes the default canvas unreadable in dense models,
while the existing relationship selection lived only in transient UI state and
had no inspector context.

## Decision

The workspace uses a validated `relationship` search parameter as the
authoritative relationship selection, parallel to `component`. Selecting a
relationship clears component selection; reloading the URL therefore restores
the same inspector and opens both endpoint paths when needed. Bundles continue
to represent several relationships and only expand/collapse; they never select
an arbitrary member.

Normal route labels show the kind abbreviation and only a bounded discriminator
(`24` characters or fewer). The full reported detail remains available through
the label title, keyboard focus, selection and the relationship inspector.
The inspector reads the existing architecture and overlay read models without
changing the API contract and lists endpoints, reported fields, change state,
reporting agents and bundle members. Selected endpoints are ring-marked and
unrelated connections are dimmed; self-references use a loop route so a label
cannot sit inside its node.

## Trade-offs

The relationship inspector performs the same cached architecture query as the
architecture pane, but TanStack Query deduplicates it and avoids introducing a
new endpoint or contract shape. Long labels are less immediately visible on
the canvas, but the title, focus state and inspector keep all reported text
reachable without sacrificing the default graph's scanability.
