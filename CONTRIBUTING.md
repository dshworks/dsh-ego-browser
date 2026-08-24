# Contributing

## Running the tests

```sh
npm install
npm test        # 74 tests, no browser needed, ~2s
```

The suite spawns real Node processes through a subprocess double that matches
`@deepseek-ai/dsh-subprocess`'s contract, against two CLI fixtures in
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

## What needs a real browser

Everything below the `ego-browser` wire: an actual page load, a real task space,
a real user takeover. None of it is verified by the maintainers, because ego
lite is macOS-only and this plugin was built in a Linux container.

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
