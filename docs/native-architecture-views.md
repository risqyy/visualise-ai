# Native architecture views

The architecture selector starts with the complete project overview. Saved
architecture views reference the same model components and relationships; a
rename appears in every view containing that identity. Inspector history and
explicit work scope stay project-wide, including references outside a view.

Select a saved view from the labeled selector. The URL retains `view`, selected
`component` or `relationship`, and an explicit `layout` override. It can be copied
or reloaded. Orientation and collapsed-container defaults come from the saved
definition; camera, drag, disclosure, expanded relationship bundles and selection
are remembered separately for each view during the current app session.

Click a component, or focus it and press Enter or Space, to highlight its direct
incoming and outgoing relationships. Unrelated lines fade. All members of a
bundle are included; a collapsed container represents its hidden endpoints.
Selecting the component again or pressing Escape on the focused node clears the
selection. This leaves node positions, camera and reported work states intact.

Relationship labels stay bounded even when focused or selected. Activate a label
to read its full reported values in the inspector. Where labels would overlap
each other or component text, they move into free space with dotted leaders back
to their routes. The native PNG renderer uses the same placement rules.

An explicit view contains its selected components and their structural ancestors.
It only draws selected relationships whose endpoints were explicitly selected.
Missing IDs and relationships that now cross the boundary appear as diagnostics.
A removed saved view is unavailable; selecting the complete overview returns to
the implicit project view without changing the model.

Views are authored through the shared command API: `visualise_view_put` and
`visualise_view_remove` over MCP, or `view.saved` and `view.removed` through the
existing REST event ingestion endpoint. Put requires `expectedModelRevision` and
`expectedViewRevision` (zero creates); removal requires the current view revision.
Both return the common command receipt. Removed view IDs cannot be reused.
The authoritative shapes and failure rules are in the
[frozen model/view/MCP contract](model-view-mcp-contract.md).

Read saved views through `visualise_views_list` / `visualise_view_get`, or
`GET /api/v1/projects/{projectId}/views` and
`GET /api/v1/projects/{projectId}/view?viewId=...`. Always encode the ID as a query
value. IDs are opaque: slash, spaces, percent signs, Unicode and dot IDs all
round-trip. List responses are paginated and stale snapshot cursors must restart
from the first page. Shared model writes refresh view diagnostics through SSE.

These are native architecture selections. They do not introduce separate model
copies or claim formal C4, UML or other diagram-family semantics. Native render
output is implemented separately in #81 using the same resolver and snapshot.
