# Contributing

## Running the tests

```sh
npm install
npm test        # 66 tests, no browser needed
```

The suite spawns real Node processes through a subprocess double that matches
`@deepseek-ai/dsh-subprocess`'s contract, against two CLI fixtures in
`fixtures/`. Those fixtures are transcribed from ego's own source — argv
handling from `src/run.ts`, the output sink from `src/output-sink.ts`, the
helper surface from `src/helpers.ts` — because a double that is weaker than
production tests nothing. If you change one, say in its header comment which
upstream file it is following.

## What needs a real browser

Everything below the `ego-browser` wire. If you have ego lite on a Mac, the most
useful contribution is `ego_doctor` output from a real install, especially if it
disagrees with what the README claims about argv shapes or helper surfaces.

## House rules

- One idea per pull request.
- Comments explain *why*, not *what*. A comment that restates the line below it
  gets deleted.
- A claim in the README needs something that proves it — a test, a transcript, a
  file path.
- New behaviour needs a test that fails without it.
