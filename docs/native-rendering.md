# Native architecture images over MCP

`visualise_view_render` returns one PNG image content block plus structured
metadata. It renders a persisted architecture view using the same native graph
pipeline as the cockpit, without opening or moving a user's browser. Unsaved
local overviews must first be saved as real views.

Read the model and view, then supply **both exact revisions**:

```json
{
  "contractVersion": "2.0.0",
  "projectId": "example-project",
  "viewId": "review-view",
  "expectedModelRevision": 3,
  "expectedViewRevision": 1,
  "viewport": { "width": 1280, "height": 800, "pixelRatio": 1 },
  "detailLevel": "standard"
}
```

The saved definition owns selection, orientation and collapsed component IDs.
The call chooses a viewport and detail level: `map` hides primary text,
`readable` shows names, `standard` adds kind/technology, and `full` adds tags
and unfolds relationship bundles. Native readable camera framing is retained
at every detail setting. It can clip a large graph; use a smaller saved scope
to inspect it in pieces.

Metadata reports `modelRevision`, `viewRevision`, `projectPosition`,
`renderedAt`, viewport/detail, PNG byte length, missing references, boundary
relationships and actually painted component/relationship IDs. Each visible-ID
array is sorted and limited to 200 entries. `clipped: true` means painted graph
content lies outside the viewport or the visible-ID list overflowed. Collapsed
descendants are not claimed as visible; a folded edge represents its original
relationship IDs, while unfolded members are checked separately.

Empty views produce a valid background PNG with empty visible-ID arrays.
Advertised tool output schemas include both successful results and the frozen
structured error object, so official SDK clients can read errors without
mistaking them for malformed successful results. Check `isError` first.
Missing/deleted saved views produce `view_not_found`. A revision mismatch
before capture produces `revision_conflict` with current revisions: read and
reconcile before requesting another image. Writes after capture cannot change
the detached image. Historical revisions are not reconstructed.

## Read, inspect, correct

This example uses a connected official MCP SDK client and an already open
orchestrator context. `identity` contains its contract/project/run/agent/parent
fields; each write receives a fresh UUID and timestamp. The chosen saved view
already exists. The model and view replies must agree on model revision.

```ts
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args })
  if (result.isError) throw new Error(JSON.stringify(result.structuredContent))
  return result
}
const read = { contractVersion: '2.0.0', projectId: identity.projectId }
const model = (await call('visualise_model_read', { ...read, limit: 200 })).structuredContent
const view = (await call('visualise_view_get', { ...read, viewId: 'review-view' })).structuredContent
if (model.modelRevision !== view.modelRevision) throw new Error('Read again: model changed')

const rendered = await call('visualise_view_render', {
  ...read, viewId: 'review-view',
  expectedModelRevision: model.modelRevision,
  expectedViewRevision: view.viewRevision,
  viewport: { width: 1280, height: 800, pixelRatio: 1 },
  detailLevel: 'full',
})
const image = rendered.content.find((item) => item.type === 'image')
await writeFile('architecture.png', Buffer.from(image.data, 'base64'))
// Inspect the image in an image-capable MCP client. Here the visible component
// gateway-api has an unnecessarily long name; correct that one known identity.
if (!rendered.structuredContent.visibleIds.componentIds.includes('gateway-api')) {
  throw new Error('The component is not in this image; choose the appropriate view')
}
await call('visualise_model_mutate', {
  ...identity, clientEventId: randomUUID(), occurredAt: new Date().toISOString(),
  expectedModelRevision: rendered.structuredContent.modelRevision,
  operations: [{ op: 'component.update', componentId: 'gateway-api', set: { name: 'Gateway' } }],
})
// Read and render again to inspect the accepted correction. A CAS conflict
// requires reading/reconciling and a new write key, never a blind overwrite.
```

## Deployment and limits

The standard source-build Compose deployment enables the render tool using the
internal `http://frontend:8080/render.html` address. Only Nginx publishes a host
port. `RENDER_BROWSER_PATH` defaults to `/usr/bin/chromium`. For another
deployment, serve the production multi-entry frontend and configure
`RENDER_ENTRY_URL` to its fixed `/render.html` URL. Leave it unset to omit
the render tool from registration and discovery. A Vite development server is
not a supported renderer target because it needs additional development routes.

For a local built preview, run `npm run build` and then
`npx vite preview --host 127.0.0.1 --port 4173 --strictPort` in `frontend/`.
Configure the locally running backend with
`RENDER_ENTRY_URL=http://127.0.0.1:4173/render.html` and its installed Chromium
executable path. This serves the static production build; it is separate from
`npm run dev`.

The backend only permits that same-origin render entry and `/assets/` files
inside the render process. The page additionally forbids API/network connections
through its content security policy. Domain strings are escaped by the native
React components and passed as CDP values, never evaluated as JavaScript.

Viewport: 320–3840 × 240–2160 CSS pixels, pixel ratio 1 or 2.
Maximum PNG: 4 MiB; maximum structured metadata: 1 MiB.
At most two requests run at once, with no queue; excess calls get
`render_failed`. The 30-second deadline covers capture, process startup, layout,
paint and screenshot; expiry gets `render_timeout`, explicit cancellation
gets `cancelled`. Size overflow gets `response_too_large`; reduce scope,
viewport or pixel ratio. Layout/browser failure gets `render_failed`.

The tested runtime is nonroot Alpine 3.24, Chromium 152.0.7977.82, Noto fonts
and chromedp 0.14.2. It requires only the GPU-specific sandbox workaround
documented in [ADR 0034](decisions/0034-native-headless-view-rendering.md).
Compose readiness does not depend on fetching the frontend during backend
startup, avoiding its frontend→healthy-backend dependency cycle.

## Verification

Go tests cover exact snapshot counters, provider mismatch guards, capture and
browser errors, PNG dimensions/size, metadata size, deadline/cancellation,
two-request admission, shutdown and fixed-entry URL restrictions. The optional
`TestNativeChromium` runs inside the actual Linux runtime against the built
frontend using `TEST_RENDER_ENTRY_URL` and optionally writes the PNG to
`TEST_RENDER_OUTPUT`. It is skipped when that environment is absent; a skipped
test is not browser evidence.

Frontend tests reuse actual ELK for scope, orientation, routing and camera;
Playwright `16-native-render.spec.ts` checks the production entry, a partially
clipped unfolded bundle and an empty view. The combined MCP acceptance flow
also exercises saved-view writes, exact revision failures and image content.
