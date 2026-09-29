# Changelog

## 0.1.3 — 2026-09-29

- **Installs and runs on dsh 0.1.7-rc.2 (npm `latest`) and 0.2.0-rc.1
  (`next`).** Proven on the path users take: the packed plugin added to a fresh
  profile with `dsh plugin add`, dsh's compatibility gate admitting it, all
  seven tools registering, and a headless turn whose `ego_doctor`, `ego_recall`
  and `ego_run` went through dsh's tool pipeline and subprocess seam into a real
  ego lite 0.5.1.13 on a Mac, reached through the deva bridge. Scripts that open
  no page only.
- The `dsh-subprocess` and `dsh-tools` peer ranges add `^0.1.7-rc.2` and
  `^0.2.0-rc.1`. The lower bound stays where it was: no seam this plugin uses
  changed shape between 0.1.5 and 0.2.0-rc.1. dsh 0.2.0 refuses any plugin whose
  `@deepseek-ai/dsh*` ranges do not cover it.
- `@deepseek-ai/schemastery` moved from `dependencies` to `peerDependencies`.
  As a dependency, `dsh plugin add` installed it (and cosmokit) into the
  profile, where both shadowed the host's copies for every plugin in that
  profile. The harness packages the tests import are pinned in
  `devDependencies`.
- **Issue #8 was a false alarm, and so was the check that raised it.**
  `scripts/check-dsh-release.mjs` installed dsh and this plugin into one npm
  tree and counted harness packages at two versions. npm installs peers there
  and dsh does not: `dsh plugin add` runs pnpm with `autoInstallPeers: false`
  and resolves every harness import to the host's own copy. It reported 16
  split packages where the real path had none. The check now does what users
  do, `dsh plugin add` into a fresh profile, and fails on a refusal by the gate
  or on any host package shadowed in the profile. The single-version proofs
  quoted for 0.1.1 and 0.1.2 below were made on the old model.
- **Output that arrives on stderr is read there.** ego 0.5.1.13 reached through
  the deva bridge returns every byte a script prints on stderr, `--version`
  included; the plugin read stdout only, so both argv probes failed although
  the script ran. Each run is now read from the stream that carries the marker
  the script printed, stdout first, and the markers are assembled at run time
  so an error trace quoting the script cannot forge one.
- dsh strips credential-shaped variables (`/KEY|PASSWORD|SECRET|TOKEN/i`) from
  every process it spawns, which removes the deva bridge's `DEVA_EGO_TOKEN`.
  The README shows how to forward it through `env`. The subprocess test double
  passed the raw environment and hid this; it now applies dsh's own scrub.
- The front page's "verified on" version is now asserted to be the harness the
  suite runs against. It had said 0.1.1-rc.2 through two releases.

## 0.1.2 — 2026-09-17

- **Installs beside dsh 0.1.5 again.** dsh 0.1.5-rc.1 became npm `latest` on
  2026-09-10, and npm semver never lets a prerelease satisfy a caret with a
  different version tuple, so no range here matched it. Installed beside it,
  npm resolved a second, 0.1.2-rc.1 copy of 16 harness packages next to the
  host's 0.1.5 ones (issue #6).
  The `dsh-subprocess` and `dsh-tools` peer ranges now OR in `^0.1.5-rc.1`;
  proven by `scripts/check-dsh-release.mjs`: one version of every harness
  package beside dsh 0.1.5-rc.2.
- The lockfile had pinned dsh 0.1.0-rc.8 since 0.1.0; it now resolves 0.1.5-rc.2.
- No code change was needed: the seams this plugin uses (`subprocess.spawn`,
  `defineTool`, `userQuestions.ask`, `webServer.register`) kept their shape in
  0.1.5. The test double was raised to 0.1.5's `SubprocessHandle` anyway — it
  no longer offers the `pid` 0.1.5 removed, and it refuses a pre-aborted signal
  the way the real provider does.

## 0.1.1 — 2026-09-04

- Peer ranges accept dsh 0.1.2-rc.1, which had become npm `latest` and matched
  no range here.
- `scripts/check-dsh-release.mjs` and a daily workflow that opens an issue when
  a dsh release splits the harness tree.

## 0.1.0 — 2026-08-24

First release. On npm as `@dshworks/dsh-ego-browser`, MIT.

- `ego_run`, `ego_recall`, `ego_site_run`, `ego_learn`, `ego_forget`,
  `ego_handoff`, `ego_doctor`.
- The learned store, in ego lite's own `learnings/` format, written by
  `ego_learn` and read back by `ego_recall` and by ego itself. Seeds once from
  an existing ego skill workspace when it finds one.
- A promotion gate that refuses snapshot refs (`@21`, `ref=21`), bad manifest
  shapes, missing exports, and source that does not parse — checked
  out-of-process with `node --check`, never imported into the harness.
- Capability probes for both unstable parts of the `ego-browser` wire: the argv
  shape (`nodejs` prefix or none) and the helper surface (flat globals or
  facades). Verified against the built bundle from `citrolabs/ego-lite@main`.
- Hard-stop classification: when ego discards a run's output because the user
  took the task space back, the missing result is read as a takeover rather than
  as a parse failure.
- `ego_handoff` raises a real dsh question with Continue / Finish task, which is
  what ego's own hard-stop message asks the harness to do.
- `GET /dsh-ego-browser/memory`, behind a loopback-and-declared-hosts fence. It
  reports the registered tool names too, because a `tools` service that never
  arrives would otherwise register nothing and say nothing — and dsh's plugin
  logger does not reach the web app's stdout.

Verified on dsh 0.1.1-rc.2 against the published package — installed with
`dsh plugin add -w @dshworks/dsh-ego-browser`, booted, all seven tools register,
the store seeds itself from the installed ego skill (github, google, x-com), and
the validator finds zero problems in ego's own shipped learnings.
