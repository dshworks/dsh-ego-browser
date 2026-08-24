# Changelog

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
