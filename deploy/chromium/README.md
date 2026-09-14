# Chromium container seccomp profile

`seccomp-profile.json` is Moby's Docker 28.0.4 default profile with one added
allow rule for `clone`, `setns` and `unshare`, following Playwright's documented
nonroot Chromium sandbox setup. Source-build and image-override Compose deployments inherit the profile from
the base Compose file, which applies it only to the backend service. Keep this directory alongside the Compose files: Docker
loads the profile from the host, not from inside the image.

## Provenance and licensing

- Base: [Moby v28.0.4 default.json](https://raw.githubusercontent.com/moby/moby/v28.0.4/profiles/seccomp/default.json),
  12,828 bytes; Git blob `c4d91109c3a5b9be1a89d8fc8b0e820c9558c365`;
  SHA-256 `9c1025c88ccaa517b648da571961838744ea2137f176bfe6a48b21294cae9c76`.
- Added rule: [Playwright v1.62.1 seccomp_profile.json](https://raw.githubusercontent.com/microsoft/playwright/v1.62.1/utils/docker/seccomp_profile.json),
  as recommended by the [official Docker guide](https://playwright.dev/docs/docker).
  That source's SHA-256 is
  `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`.
  We copied only its three-call rule, not its different base profile.
- Both sources use Apache License 2.0. Unmodified upstream license and notice
  files accompany this derivative: [Moby license](LICENSE.moby),
  [Moby notice](NOTICE.moby), [Playwright license](LICENSE.playwright),
  [Playwright notice](NOTICE.playwright). They were retrieved from the same
  pinned tags as their respective sources.

Local modification: prepend one unconditional `SCMP_ACT_ALLOW` rule naming
`clone`, `setns` and `unshare`, with an explanatory comment. All original
properties and syscall entries are preserved. Removing the first `syscalls`
entry yields JSON structurally equal to the pinned Moby source. In particular,
`clone3` retains the default `ENOSYS` (38) response without `CAP_SYS_ADMIN`;
this profile does not add `clone3` to the allow rule.

## Scope and maintenance

The default deny action and every other Docker 28.0.4 rule remain in force.
This exception applies to the whole backend container, including its browser
children. It permits Chromium to establish its namespace sandbox without adding
capabilities, using a privileged container, or disabling Chromium's sandbox.
The image's nonroot user and existing Chromium flags are unchanged.

A vendored profile does not automatically inherit future Docker default-profile
updates. When updating its base, review the upstream diff, retain only the
namespace exception, and rerun the nonroot sandbox probe and native PNG tests.

Seccomp is only one host boundary. AppArmor or host user-namespace policy can
independently deny namespace creation even when this profile allows its syscall.
Inspect the active container AppArmor profile, host policy and available audit
logs before attributing another `EPERM` to seccomp. This configuration does not
relax AppArmor or alter host sysctls. See
[Chromium's AppArmor user-namespace guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md).
