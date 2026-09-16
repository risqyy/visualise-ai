# 43. Announce connection changes without interrupting the reader

- **Status:** accepted
- **Date:** 2026-09-16
- **Context issue:** #121
- **Builds on:** [0003 — Frontend state split](./0003-frontend-state-split-and-live-updates.md), [0006 — SSE replay](./0006-sse-replay-and-in-process-broker.md)

## Decision

The connection badge is a keyboard focus target with the same explanation as its
hover tooltip. It remains informational: focusing it does not reconnect, change
selection, or discard the loaded model.

A separate, persistent polite status region contains the complete explanation
for the current connection state. React changes that text only when the state or
UI language changes. Event positions remain in the tooltip, so individual data
events and repeated reports of an unchanged connection state do not trigger live
announcements. Connection establishment is explicit in the restored live message.

The status region uses `aria-atomic="false"` with a single complete text node.
An isolated real Orca 46.1 / Chromium 151 comparison spoke this variant, while a
status region relying on implicit atomicity did not speak its received update.
Plain atomic live regions also worked; this observation does not establish a
general atomic-region defect or its cause. The application test must verify the
actual chosen markup, full spoken messages, and unchanged focus.

## Validation

Automated checks cover interruption and restoration, equivalent keyboard/mouse
explanations, preserved focus and loaded content, and quiet event-position updates.
Real screenreader acceptance uses the running application through a test proxy
that closes or returns HTTP 503 only for the SSE endpoint. Other API requests and
all application state remain real. Orca utterances, initialized speech-dispatcher,
audio, and focus observations provide the evidence; an accessibility-tree dump
alone is not treated as a screenreader test.
