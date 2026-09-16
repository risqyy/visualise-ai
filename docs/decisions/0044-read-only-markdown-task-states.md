# 44. Read-only task states in reported Markdown

- **Status:** accepted
- **Date:** 2026-09-16
- **Context issue:** #122

Reported task lists are evidence, not editable forms. Render each sanitized task
checkbox as a non-interactive status image named “Completed” or “Open” in the UI
language, immediately before its unchanged task text. Native list structure,
nested lists and inline formatting remain intact. The decorative icon is hidden
from assistive technology; its enclosing status image supplies the state once.

The existing raw-HTML parsing and final sanitization boundary remain unchanged.
The trusted input renderer reads only the sanitized checked state and forwards no
reported attributes. Its own static icon is application output; raw SVG and
executable attributes from reports remain forbidden. Status labels do not add to
or translate the reported text content.

Validate accessible states, unchanged text, non-editability and hostile input in
unit tests; check axe and visual layout in the browser, then confirm status/task
reading order with a real screenreader against the running application.
