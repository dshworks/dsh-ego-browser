# Contributing

## Running the tests

```sh
npm install
npm test        # 81 tests, no browser needed, ~2s
```

The suite spawns real Node processes through a subprocess double that matches
`@deepseek-ai/dsh-subprocess`'s contract, environment scrub included, against
two CLI fixtures in
`fixtures/`. Those fixtures are transcribed from ego's own source — argv
handling from `src/run.ts`, the output sink from `src/output-sink.ts`, the
helper surface from `src/helpers.ts` — because a double that is weaker than
production tests nothing. If you change one, say in its header comment which
upstream file it is following.

## The claims tripwire

`tests/claims.spec.mjs` asserts the front page against the code: the tool count
and tool names, the test count, the dsh version, and every relative link in both
READMEs. Add a tool without listing it in `llms.txt` and CI goes red in the same
run — which is the point, because a stale README is the fastest way for a repo
to stop being believed.

If you change a published number, change it in every surface that states it:
`README.md`, `README.zh.md`, `llms.txt`, and this file.

## The release check

`scripts/check-dsh-release.mjs` installs dsh from npm and adds this plugin to a
fresh profile with `dsh plugin --profile web add`, the path users take. It
asserts two things: the add exits 0, which means dsh's compatibility gate
admitted every `@deepseek-ai/dsh*` peer range (the gate uses
`semver.satisfies(..., { includePrerelease: true })`), and the profile holds no
`@deepseek-ai/*` package the host also supplies. A host package in
`dependencies` gets installed into the profile and shadows the host for every
plugin there, so harness packages belong in `peerDependencies` (and pinned in
`devDependencies` for the tests). `--tree-only` checks this branch on a pull
request; the daily run also checks the published package, and reports a dsh on
`next` without failing. It needs pnpm on PATH, as `dsh plugin` does.

## What needs a real browser

Everything that touches a page: an actual page load, a real task space, a real
user takeover. None of it is verified by the maintainers. ego lite is
macOS-only and this plugin is built in a Linux container; the wire itself has
been exercised against a real install through the deva bridge, with scripts
that open no page.

**So if you have ego lite on a Mac, the most useful contribution is a
[wire report](https://github.com/dshworks/dsh-ego-browser/issues/new?template=wire_report.yml)** —
`ego_doctor` output from a real install, especially if it disagrees with what
the README claims about argv shapes, helper surfaces, or what a hard stop does
to your output. "Matches exactly" is a useful report too.

## House rules

- One idea per pull request.
- Comments explain *why*, not *what*. A comment that restates the line below it
  gets deleted.
- A claim in the README needs something that proves it — a test, a transcript, a
  file path.
- New behaviour needs a test that fails without it.
- Both READMEs move together. English-only changes to a shared claim will fail
  the tripwire.
