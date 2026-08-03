# AGENTS.md

These guidelines define how an agent is expected to work in this repository. They are
shared across projects; project-specific conventions may extend — but should not
contradict — this document.

## Core principles

- **Ask, don't assume.** When requirements, scope, or intent are unclear, ask before
  acting. Do not invent details or guess at decisions that are the user's to make.
- **Work minimally and incrementally.** Make the smallest change that solves the
  task. Avoid unrelated refactors, scope creep, or speculative work.
- **Use the repo's agent skills.** Prefer the Agent Skills available in the repository
  over ad-hoc approaches when one fits the task.

## Issues

- **Work on one issue at a time.** Each task is tied to a single issue; finish it
  before picking up the next.
- **Never create issues on your own.** Only create an issue with explicit permission.

## Tooling

- **Use the platform's CLI for repository operations** (issues, pull/merge requests,
  pipelines, releases). Match the tool to the host:
  - **Gitea** → the Gitea CLI (`tea`)
  - **GitHub** → the GitHub CLI (`gh`)
  - **GitLab** → the GitLab CLI (`glab`)

## Branching & pull requests

- **Always work on a feature branch.** Never commit directly to `develop` or the main
  branch. Create a dedicated feature branch for each task.
- **Open pull requests against `develop`.** Feature branches are merged into `develop`
  via pull request — not into `main`/`master` directly.
- **Only close a pull/merge request when explicitly told to.** Never close one on your
  own initiative.

## Commits

- **Do not add the agent as a commit co-author.** Commit messages must not include a
  `Co-Authored-By` trailer for the agent.
- Only commit or push when explicitly asked.

## Pipeline

- **Monitor the pipeline when one exists.** After pushing, watch the CI/CD pipeline and
  report its status. Investigate and address failures rather than ignoring them.

## Review

- **Self-review before declaring work done.** When the work appears finished, review the
  changes yourself first (diff, correctness, scope) before handing it back.

## Reporting

- **Summarize after every ticket.** Whenever you work on a ticket/issue, report what you
  did: which points were addressed, what changed, and anything important to know
  (caveats, follow-ups, open questions).

## Decision records

- **Record significant decisions** under `docs/decisions/` or `docs/concepts/`.
- Not everything needs an entry — but **large changes and major decisions must be
  documented** so there is a continuous decision/design chain.
- Keep entries concise: the decision, the reasoning, and the relevant trade-offs.
