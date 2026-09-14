# 0038 — Component dependencies and bounded label placement

## Decision

Selecting a visible component highlights all incident rendered relationships and
subdues unrelated ones. A collapsed container represents its hidden endpoints;
each relationship in a displayed bundle remains individually addressable. This
is a presentation of direct reported relationships, with no transitive inference
or model mutation. Explicit relationship selection retains its own inspector and
keyboard semantics.

The selected line and arrow use the focus colour. Relationship-kind dash patterns
remain intact, while reported work states retain their patterned underlay and
state badge. Selection therefore cannot be mistaken for a reported work state.

Relationship text has a fixed maximum width, including during focus and selection.
Full reported values remain in accessible names, titles and the relationship
inspector. A shared pure placement pass reserves space for every visible badge,
expanded bundle member, collapse control and work-state mark. It avoids leaf boxes
and compound headers without moving nodes. Displaced labels have a dotted leader
to their route anchor.

The interactive canvas and native PNG renderer use the same placement algorithm.
Placement depends on routes, temporary node positions, disclosure and zoom, but
not selection. It uses deterministic nearby candidates and a finite fallback
outside occupied bounds when a dense graph leaves no nearby space.

## Consequences

Labels may move away from their route in dense diagrams or extend the drawing's
visible extent. The existing native export clipping report continues to describe
the actual painted result. Bounded labels favour stable, readable geometry over
showing arbitrarily long reported text directly on the canvas.

Validation includes pure geometry tests and browser rectangle checks, alongside
selection, keyboard, saved-view and native-render acceptance tests. See issue #108.
