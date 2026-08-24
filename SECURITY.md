# Security

## What this plugin can reach

The agent drives **the user's real browser sessions**. ego lite's Spaces isolate
windows, not storage: every Space shares the live cookie jar, so a script run
through `ego_run` acts as the signed-in user on every site they are signed in
to. Treat an `ego_run` call the way you would treat a shell command.

## Trust boundaries this plugin holds

- **Learned tool source is never imported by the harness.** `ego_learn` checks
  syntax by spawning `node --check` on a temporary file and reading its exit
  code. The code is written by a model for the *browser* runtime; importing it
  to validate it would execute it in the harness process instead.
- **The memory route is read-only and fenced.** `GET /dsh-ego-browser/memory`
  answers loopback and any authority in `trustedHosts`, refuses a Host header
  naming anywhere else (the DNS-rebinding case), and refuses a request a browser
  marked cross-site. A malformed `trustedHosts` entry fails the load rather than
  quietly authorizing a different host.
- **Paths are constrained.** Site ids and tool names must match
  `^[a-z0-9][a-z0-9._-]*$` and may not contain `..`; stored files must sit in
  `notes/`, `tools/`, or `browser-tools/` inside their own site directory.

## What it does not do

- It does not vendor, patch, or launch a browser. The only wire is the
  `ego-browser` command the ego lite app installs.
- It does not read or write anything outside its own workspace directory and the
  temporary file used for a syntax check.
- It does not send anything anywhere. The store is local files.

## Reporting

Open an issue at
<https://github.com/dshworks/dsh-ego-browser/issues>. For anything you would
rather not post publicly, say so in the issue and leave out the detail; a
maintainer will follow up.
