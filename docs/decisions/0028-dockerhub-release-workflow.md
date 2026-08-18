# ADR 0028: Tag-gated Docker-Hub image releases

## Entscheidung

Release images are published only from SemVer Git tags (`v1.2.3` or a
prerelease such as `v1.2.3-rc.1`). The release workflow calls the existing CI
and E2E workflows as reusable gates, then publishes the backend and frontend
images in one multi-architecture job to separate Docker-Hub repositories. GHA
cache scopes are separate per image, and a Compose override provides an
explicit image-only path for operators.

Stable tags receive `1.2.3`, `1.2`, `1` and `latest`; prereleases receive only
their complete version tag. PostgreSQL remains the internal Compose service
and is not part of the project image release.

## Begründung und Trade-offs

Reusing the existing workflows keeps the release gate aligned with pull-request
and main-branch validation without copying a growing test matrix. A single
publish job makes the ordering and shared Docker login obvious, although an
external registry can still fail after one image has already been accepted;
the validation gate prevents any image push when application checks fail.
