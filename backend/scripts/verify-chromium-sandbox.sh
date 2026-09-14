#!/bin/sh
# Run inside the shipped backend container, as its configured nonroot user.
# No model, HTTP endpoint or active user browser is needed.
set -eu

fail() { printf '%s\n' "Chromium sandbox verification failed: $*" >&2; exit 1; }
[ "$(id -u)" -ne 0 ] || fail 'the browser must run as nonroot'
cap_eff=$(sed -n 's/^CapEff:[[:space:]]*//p' /proc/self/status)
case "$cap_eff" in ''|*[!0]*) fail 'effective Linux capabilities must be empty' ;; esac
[ "$(sed -n 's/^Seccomp:[[:space:]]*//p' /proc/self/status)" = 2 ] || fail 'container seccomp filtering is absent'

browser=${RENDER_BROWSER_PATH:-/usr/bin/chromium}
"$browser" --version
printf 'Browser UID=%s; effective capabilities=%s; container seccomp=2\n' "$(id -u)" "$cap_eff"
probe_dir=$(mktemp -d /tmp/visualise-sandbox-probe.XXXXXX)
trap 'rm -rf "$probe_dir"' EXIT
trap 'exit 1' HUP INT TERM

# The timeout supervises a shell that owns a separate Chromium process group.
# Its EXIT trap kills that group on success, startup failure and timeout, so a
# failed probe cannot leave browser children running in the application container.
if ! timeout -s TERM -k 5 20 sh -c '
  browser_pid=
  cleanup() {
    if [ -n "$browser_pid" ]; then
      kill -TERM -- "-$browser_pid" 2>/dev/null || true
      if kill -0 -- "-$browser_pid" 2>/dev/null; then
        sleep 1
        kill -KILL -- "-$browser_pid" 2>/dev/null || true
      fi
      wait "$browser_pid" 2>/dev/null || true
    fi
  }
  trap cleanup EXIT
  trap "exit 1" HUP INT TERM
  setsid "$1" --headless --disable-gpu --disable-gpu-sandbox \
    --no-first-run --no-default-browser-check --disable-background-networking \
    --lang=en-US --user-data-dir="$2/profile" \
    --allow-chrome-scheme-url --dump-dom chrome://sandbox \
    >"$2/status.html" 2>"$2/browser.log" &
  browser_pid=$!
  wait "$browser_pid"
' sandbox-probe "$browser" "$probe_dir"; then
  tail -n 80 "$probe_dir/browser.log" >&2
  fail 'Chromium failed or exceeded the 20-second probe deadline'
fi

# Inspect Chromium's live sandbox-status page, not launch flags or a mocked
# fixture. Chromium 152 reports its first layer as Namespace.
assert_row() {
  if ! grep -Eq "<tr><td[^>]*>$1</td><td[^>]*>$2</td></tr>" "$probe_dir/status.html"; then
    cat "$probe_dir/status.html" >&2
    fail "expected $1 = $2"
  fi
  printf 'Chromium sandbox: %s = %s\n' "$1" "$2"
}
assert_row 'Layer 1 Sandbox' 'Namespace'
assert_row 'PID namespaces' 'Yes'
assert_row 'Network namespaces' 'Yes'
assert_row 'Seccomp-BPF sandbox' 'Yes'
assert_row 'Seccomp-BPF sandbox supports TSYNC' 'Yes'
