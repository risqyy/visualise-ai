# Trust boundary and product boundaries

What this system protects, what it explicitly does not protect, and where v0 ends.
Read this before making the cockpit accessible to anyone else.

## Local machines or private networks only

**v0 has no authentication, authorization, or multi-tenancy.**
The OpenAPI contract states this explicitly: `security: []` — no operation
requires credentials. This is a deliberate v0 decision, not an omission.

The immediate consequences are:

- **Do not expose it to the public internet.** No port forwarding, public
  reverse proxy, or tunnel.
- Anyone who can reach the published port has full read **and** write access.
- A private network is the outer boundary. There is no further boundary within it.

### There is no tenant isolation

A "project" is an organizational unit, not a boundary. `projectId` is an
identifier freely chosen by the agent, and ingestion checks only its format,
not its origin. **Anyone who can reach the ingestion endpoint can write to any
project**, including an existing project whose ID they know or guess.
Likewise, anyone who can reach the UI can read every project.

Read models are strictly scoped to a project: no response ever contains a row
from another project, even when two projects use the same run, agent, or
component ID. This ensures correct delivery, not access control.

## Nginx is the only entry point

Of the three Compose services, only `frontend` publishes a host port.
`backend` and `postgres` deliberately have no `ports:` entry and are reachable
only from the Compose network.

This has two related consequences:

- The system's entire external attack surface is a single port. Anything Nginx
  does not forward is unavailable from outside.
- Making PostgreSQL accessible for debugging requires an explicit change to
  `docker-compose.yml`. This is intentional: it should not happen accidentally.

The routes Nginx forwards are listed in the
[README](../README.md#network-topology).

## MCP and native images

MCP checks the exact Host, including its port, and the Origin when present.
Native clients may omit Origin. These checks limit unwanted browser/host
access, but they are not authentication: a client with matching headers gets
the same project access as REST.

The renderer starts its own bundled Chromium process as a non-root user and
loads a configured internal frontend entry point. Model fields do not determine
the navigation URL. Two concurrent jobs, a 30-second deadline, and fixed response
limits bound resource use. No user browser, session, or camera is used for this.
Images are native architecture views; UML/PlantUML parity and automatic quality
assessment are not included.

The [versioned seccomp profile](../deploy/chromium/README.md) extends the
Docker 28.0.4 profile with permissions for `clone`, `setns`, and `unshare`.
This exception applies to the entire backend container; it adds no capabilities
and uses neither a privileged container nor `seccomp=unconfined`.
AppArmor and the host's user namespace rules remain in effect.

## Agent feedback is untrusted input

`feedback.published` carries Markdown written by an agent. The agent's own
inputs include web pages, tool outputs, and files, all outside this system's
trust boundary. The contract says so explicitly and assigns responsibility
to the client: `FeedbackEntry.body` is "untrusted markdown … handed through
verbatim — sanitising it before rendering is the client's job".

The cockpit renders this text in the same origin that communicates with the
Read API. It therefore sanitizes it before rendering with `rehype-sanitize`
using an **allowlist**: anything not listed is removed. An unforeseen vector
is rejected by default, without someone having to anticipate it.

> **`frontend/src/components/workspace/inspector/sanitizeSchema.ts` is a
> security control, not a formatting option.** Adding an entry to `tagNames`
> or `protocols` directly expands what an agent may render in the cockpit's
> origin. A change to this file requires the same care as a change to an
> authentication rule.

The detailed rationale for the pipeline, including why it sanitizes rather
than refusing to parse HTML, is in
[ADR 0012](./decisions/0012-component-inspector-and-markdown-safety.md).

## What v0 explicitly does not support

These are defined boundaries, not pending tasks. If a user expects one of
these capabilities, that expectation is outside the system's scope.

| Outside v0 | Meaning |
| --- | --- |
| **Repository access** | The system does not read a repository. Every diff, file path, and architecture is what an agent reported, not what exists in a repository. Nothing is verified. |
| **GitHub, GitLab, or Gitea integration** | No integration, commits, pull requests, or webhooks. See the [`RepositoryProvider` boundary](#repositoryprovider-boundary). |
| **Authentication and authorization** | See above. |
| **Multi-tenancy** | See above. |
| **Program execution visualization** | The cockpit shows architecture and reported work on it, not call flows or control flows. |
| **Agent control** | Read-only observation. There is no channel back to the agent: no stopping, redirecting, or approving. |
| **Prompting from the application** | There is no input field that sends anything to the agent. |
| **Judging whether work is correct** | The system performs no quality or drift assessment. `risk.reported` and `problem.reported` are the agent's own reports about its work. The human judges. |

Status is also reported, never inferred. There is no stall detection or
time-based inference of work. Transport and render timeouts bound resource use
without changing run status. A run without a terminal event remains open and
shows its last reported state. See the
[lifecycle section](./agent-integration.md#lifecycle).

Two further technical boundaries: there is exactly **one** backend instance.
The SSE broker runs in-process, so a second instance would break live stream
delivery. The cockpit is desktop-only, with mandatory acceptance testing at
1920 × 1080 in Chromium.

<a id="repositoryprovider-boundary"></a>

## The `RepositoryProvider` boundary

v0 includes **no** repository access and **no** `RepositoryProvider` interface.
There is nothing to implement or configure. This section describes only
*where* future GitHub, GitLab, or Gitea integration would connect and which
existing assumptions keep that option open.

**The integration point.** Everything the cockpit knows about code currently
arrives as reported event content: `diff.reported` carries the unified diff and
file path; `architecture.snapshot_published` carries the model. Repository
integration would connect here, as a **resolver that checks a report against
a repository**, not as a second data source alongside the event log. The event
log would remain the record of *what the agent claimed*; a provider could show
*what actually exists in the repository* alongside it.

**The assumptions that keep this possible:**

- **Diffs use repository-relative paths and unified format.** The schema requires
  `filePath` to be repository-relative; absolute paths and `..` segments are
  rejected. A reported path can therefore be resolved against a repository tree
  without conversion. The diff itself is unified, the format every forge provides.
- **Each diff event carries exactly one file.** There are no bundled multi-file
  diffs to split first. `changeId` groups the logical change.
- **Components carry no repository identity.** A `componentId` is a stable
  identifier assigned by the agent; the model has no repository URL, branch,
  or commit. The architecture is therefore not tied to a repository and need
  not be derived from one. A future mapping would be an additional relationship,
  not a change to the model.
- **The event log is the audit source.** It is append-only, enforced in code;
  corrections and retractions are new events referencing the original, never
  edits. A future provider therefore cannot overwrite anything; it can only
  add information. This property makes integration safe.

The interface signature, its location in the code, its transport, and its
authentication with the forge are deliberately **not** specified. These
decisions belong in the issue that implements the integration and are not
made in advance here.
