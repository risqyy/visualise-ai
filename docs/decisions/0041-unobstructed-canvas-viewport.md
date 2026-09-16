# ADR 0041: Unobstructed canvas viewport

Issue: #114

## Decision

Canvas controls occupy normal layout space above React Flow. Search and primary
navigation remain in a compact row, alongside the native zoom controls. Named
icon buttons retain their keyboard access and explanations. A collapsed-by-default
Tools disclosure contains orientation, minimap and display information.

The primary row has a stable height based on the existing pointer hit-area size;
the secondary dock has a bounded height and can scroll. This prevents live counts
or translated labels from changing the drawing surface and moving the camera.
The drawing surface retains the camera policy's 240 px minimum height.

React Flow measures the remaining drawing surface. Initial fit, whole-map fit,
search and native keyboard auto-pan therefore share the same unobstructed
viewport, without a second set of overlay offsets or camera calculations.
Opening tools changes available space but does not request a fit; explicit
navigation still owns camera changes. Search remains a viewport-level portal.

An explicit whole-map fit may lower the native minimum zoom below its normal
0.12 limit when necessary to fit all component bounds. The limit is set before
applying that camera and retained for the mounted canvas, so native zoom controls
can return to the fitted overview. Remounts initialize it from the saved camera.
Initial fitting retains its separate readable zoom floor. Live updates and tool
disclosure neither lower this limit nor request another fit.

## Consequences

This supersedes the toolbar/minimap overlay placement in ADR 0025. The minimap
is available after opening Tools; the existing minimap preference remains intact.
Opening the dock reduces drawing height, trading temporary space for controls
that cannot cover component labels. Architecture focus and camera ownership
remain unchanged.
