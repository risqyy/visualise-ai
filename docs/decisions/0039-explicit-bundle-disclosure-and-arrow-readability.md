# ADR 0039: Explicit bundle disclosure and arrow readability

Status: Accepted

Issue: #108

## Context

Collision-free text alone did not make dependency diagrams readable. Zooming
automatically opened every bundle, label leaders resembled dependency edges,
and the horizontal self-loop fallback crossed nodes in a vertical layout.

## Decision

Interactive bundles expand only through explicit disclosure, independently of
zoom. This supersedes automatic full-zoom expansion in ADRs 0008, 0013 and 0024.
Explicit full-detail native exports retain individual members, as specified by
the rendering contract.

Labels prefer free positions on their own routes, then nearby perpendicular
offsets whose attachments avoid component bodies and compound headers. Leaders
attach to the nearest route segment and use a faint solid line without an
arrowhead; they fade with the relationship. The bundle collapse control has no
leader because it represents several paths. This replaces the dotted fixed-point
leaders of ADR 0038. Label positions remain shared between both renderers.

Self-loops respect orientation and measured node dimensions, staying within the
minimum sibling gap. Neither disclosure nor selection moves graph nodes.
Parallel self-relations use nested exterior lanes within the header padding;
symmetric translation would move inward members through the component. These
lanes remain close together, with individual labels providing selection access.

## Trade-offs and validation

Inspecting every parallel relationship requires an explicit action. This keeps
zoom predictable and the default diagram quieter. Extremely dense diagrams may
still need distant labels after all local collision-free positions are exhausted.

Browser regressions check actual self-loop paths against node rectangles in both
orientations, explicit disclosure at high zoom, and annotation attachment to the
owned painted path, in addition to text collision checks. Screenshots must also
be visually reviewed: rectangle assertions alone do not establish readability.
