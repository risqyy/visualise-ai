# ADR 0034: Render captured views with the native frontend

Status: accepted for issue #81.

## Decision

Use the pinned Go chromedp 0.14.2 client to launch a fresh Chromium process for
each request. The backend captures the model, saved view and both exact revisions
in one repeatable-read transaction, then injects only that detached value into
the production frontend's dedicated `/render.html` entry using CDP function
arguments. No model-driven URL, HTML interpolation, live API fetch, user browser
session or workspace interaction store participates.

The entry reuses saved-view resolution, native graph projection, collapse,
ELK layout, node/edge registry, marker definitions, staggered label positions,
readable camera policy, i18n resources and CSS. An optional detail context selects
map/readable/standard/full without changing the interactive zoom behavior.
It waits for fonts, native nodes/edges and final paint before returning evidence;
the backend takes a viewport PNG at the requested pixel ratio.

The renderer admits at most two requests, rejects excess immediately, and applies
a 30-second deadline including snapshot capture and browser startup. Cancellation
and shutdown terminate owned processes and remove their temporary profiles.
Validate PNG dimensions and the 4 MiB image / 1 MiB metadata limits before sending
one MCP image content block. Metadata uses captured counters and actual painted
IDs, including member-specific paths for unfolded bundles.

Tool registration advertises the union of each frozen success schema and the
already frozen structured Error schema. The official TypeScript SDK 1.30 checks
any structured content against the advertised schema even when `isError` is
true; success-only metadata hid a valid `revision_conflict` behind a client
schema error. This changes advertised metadata, not either payload. Internal
success validation remains strict, and domain errors retain `isError: true`.

## Runtime and trade-offs

Alpine 3.24 supplies maintained Chromium packages and Noto fonts. It replaces the
backend's older Alpine 3.21 runtime; the Go binary remains statically linked.
Compose uses its existing internal frontend address, a nonroot UID, an init
process and 256 MiB shared memory. No extra capabilities or privileged containers.
On the tested Docker runtime, Chromium 152's GPU sandbox rejected a new syscall.
Disabling only the unused GPU sandbox allowed rendering; the renderer sandbox is
not explicitly disabled. Do not replace this with a blanket `--no-sandbox`.

Fresh processes cost startup time and the runtime image gains Chromium's sizeable
dependencies. In exchange, no shared browser profile or previous request can
affect a capture, and failure cleanup stays local to one request. A separate SVG
renderer would duplicate hierarchy, edge, detail and layout semantics; capturing
the user's page would require an active session and disturb its camera. Both
would weaken the revision guarantee.

Only current exact snapshots are supported. Writes after capture cannot alter
that image; stale revisions before capture fail. Readable framing deliberately
clips large views instead of shrinking text below the native floor. Pixel output
is reproducible within the tested browser/font/runtime combination, not promised
byte-identical across platform or Chromium upgrades.

Sources: [chromedp 0.14.2 module requirements](https://raw.githubusercontent.com/chromedp/chromedp/v0.14.2/go.mod),
[Alpine 3.24 Chromium packages](https://pkgs.alpinelinux.org/packages?branch=v3.24&name=chromium).
