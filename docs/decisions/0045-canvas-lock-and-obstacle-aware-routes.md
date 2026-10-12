# ADR 0045: Canvas lock and obstacle-aware relationship routes

Status: Accepted

Issue: #139

## Context

Temporary node movements invalidated only incident ELK routes. Moving a container
also moves its descendants, while moving an unrelated node can obstruct any
existing route. Expanded bundles translated an otherwise valid ELK path without
checking the new lanes against components. Label collision avoidance alone could
not protect these painted relationship paths.

## Decision

Expose a keyboard-accessible visual lock in the canvas toolbar. It is transient
viewer state remembered per project/view, not a change to the reported model or
a saved-view property. Locking stops component dragging, camera gestures and
layout/navigation controls, cancels pending camera requests, and preserves the
current positions when unlocked. Selection, inspection and live model updates
continue. It is an interaction lock rather than a frozen historical snapshot;
new reported structure or revealing a selected hidden component can still change
the projected inventory. A first model may receive its initial camera placement.

Keep ELK responsible for deterministic component placement. A shared pure route
planner runs on the current absolute node geometry before label placement in both
the interactive canvas and native exports. Leaf and collapsed component bodies
and expanded container titles are obstacles. Open container boundaries remain
traversable so relationships can enter and leave their reported hierarchy.

Retain unobstructed ELK routes when they have no congestion. Repair invalid paths,
self-loops and explicitly expanded bundle members with orthogonal A* search.
Canonical edge order and stable search ties make the output deterministic.
Path length, bends, crossings and shared lane length contribute to route cost;
this reduces avoidable crossings without claiming arbitrary graphs are planar.
Labels and their attachment lines use the resulting individual member routes.

The search begins with obstacles touching the preferred path and adds blockers
found on candidates. Every accepted candidate is checked against all components,
but distant components do not automatically enlarge each local search grid.
Normal channels reserve 12 px around obstacles and use 10 px rounded corners.
Narrow channels, including the 12 px gap below a container title, use 4 px
clearance, shorter port approaches and 2 px corners. The reduced radius prevents
rounded curves from cutting back into the obstacle that the polyline avoided.

Manual drops that would overlap unrelated components or violate a container's
interior/title bounds restore the previous local position. A 32 px clearance
between unrelated components leaves room for port approaches and routing.
Moving a container is checked together with its descendants. These presentation
constraints do not write to the architecture model.

## Trade-offs and validation

The planner is greedy in canonical edge order, not a global crossing optimum.
Shared port stems and crossings in non-planar graphs remain possible. If imported
or provisional geometry physically traps a handle in overlapping bodies, no
orthogonal route can satisfy the clearance requirement; retain the relationship
instead of silently removing it. Normal user drops reject such placements.

Routing is memoized independently of camera zoom and selection. Tests cover
unrelated moved obstacles, moved ancestors, both orientations, expanded parallel
and self-relations, narrow title gaps, deterministic permutations and actual
nested ELK results. Native preparation verifies explicit self-loop geometry.
Browser acceptance samples actual rounded SVG paths against rendered components
and titles and verifies labels, interaction locking and native rendering.
