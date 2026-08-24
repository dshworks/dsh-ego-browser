<div align="center">

```
    ___  __ _  ___
   / _ \/ _` |/ _ \    dsh-ego-browser
  |  __/ (_| | (_) |
   \___|\__, |\___/    ego lite for DeepSeek Harness,
        |___/          with a memory it keeps
```

**The site-skill memory for dsh browser agents.**

</div>

<p align="center"><strong>
7 tools · a store in ego lite's own <code>learnings/</code> format · verified on dsh 0.1.1-rc.2 · 74 tests, no browser needed · host-only · MIT
</strong></p>

<p align="center">
<a href="https://github.com/dshworks/dsh-ego-browser/actions/workflows/ci.yml"><img src="https://github.com/dshworks/dsh-ego-browser/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="https://www.npmjs.com/package/@dshworks/dsh-ego-browser"><img src="https://img.shields.io/npm/v/@dshworks/dsh-ego-browser?color=CB3837&logo=npm&logoColor=white" alt="npm"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3DA639" alt="MIT"></a>
<img src="https://img.shields.io/badge/node-%E2%89%A520-5FA04E" alt="Node >= 20">
<img src="https://img.shields.io/badge/dsh-0.1.1--rc.2%20verified-1E90FF" alt="verified against dsh 0.1.1-rc.2">
</p>

<p align="center">
<a href="#what-it-does">What it does</a> ·
<a href="#get-started-60-seconds">60-second start</a> ·
<a href="#proof">Proof</a> ·
<a href="#when-to-use--when-to-skip">When to skip</a> ·
<a href="#prior-art">Prior art</a> ·
<a href="llms.txt">llms.txt</a> ·
<a href="README.zh.md">中文</a>
</p>

<p align="center"><sub>
AI agents / LLMs: read <a href="llms.txt">llms.txt</a> in this repo — it carries the tool signatures, the store layout, and the three wire facts about ego that the docs get wrong.
</sub></p>

---

ego lite is one browser a human and an agent share: the agent works in its own
Space with the user's real logins, the user's tabs stay theirs. This plugin
brings it into dsh — and adds the half ego's own README still lists as coming
soon.

> *"Experience accumulation that makes your agent faster the more you use it
> **(coming soon)**"* — [ego lite README](https://github.com/citrolabs/ego-lite)

The reader already ships. `site.learnContext`, `site.runTool` and
`site.runBrowserTool` load a `learnings/` directory out of whatever
`EGO_BROWSER_AGENT_WORKSPACE` points at. What was missing is the half that
**fills** it.

```
  ego_recall  ──▶  ego_run  ──▶  ego_learn  ──▶  ego_site_run
   what this       one script     promote the      one call, next
   agent already   for the whole  step that        session, instead
   learned about   browser task   worked           of rediscovering
   the site
                        │
                        └──▶  ego_handoff — the page needs a human;
                              ask them for real, then take control back
```

The loop closes. The second time you scrape that dashboard, the agent calls a
tool it wrote last week instead of rediscovering the page.

## What it does

- **Recalls before it acts** — `ego_recall` returns the notes and tool
  signatures for a hostname off disk. No browser, no page load, no tokens spent
  rediscovering what worked last month.
- **Writes one script per task** — `ego_run` hands the whole browser task to
  ego's runtime in a single script, which is the design ego's own benchmark is
  built on.
- **Promotes what worked** — `ego_learn` turns a working step into a real site
  tool, in ego's format, and refuses the ones that will not survive to tomorrow.
- **Runs what it learned** — `ego_site_run` calls a stored tool by name and
  counts the call, so a tool nobody uses is visible as unused.
- **Hands you the keyboard for real** — `ego_handoff` raises a genuine dsh
  **Continue / Finish task** prompt, which is what ego's own hard-stop message
  asks the harness to do, and takes control back only when you say so.
- **Tells the model which ego you have** — `ego_doctor` probes the installed
  command instead of trusting the docs, because there are two incompatible
  runtimes behind one command name.
- **Starts non-empty** — on first boot the store inherits the `learnings/` from
  the ego skill already on your machine.

## How it works (30 seconds)

```
  dsh agent
     │  ego_run / ego_site_run                    ego_recall / ego_learn
     ▼                                                      │
  ┌──────────────────────────────┐                          ▼
  │ dsh-ego-browser (host half)  │              ┌──────────────────────────┐
  │  · argv + surface probes     │              │ learnings/<site>/        │
  │  · script wrap + classify    │─────────────▶│   manifest.json          │
  │  · promotion gate            │   writes     │   notes/*.md             │
  └──────────────┬───────────────┘              │   tools/*.js             │
                 │ stdin heredoc                │   browser-tools/*.js     │
                 ▼                              └──────────┬───────────────┘
          `ego-browser`                                    │ EGO_BROWSER_
                 │                                         │ AGENT_WORKSPACE
                 ▼                                         ▼
          ego lite app  ◀───────── the same store, read back by ego itself
          (your logins, its own Space)
```

The only wire is the `ego-browser` command the ego lite app installs. Nothing
here vendors, patches, or launches a browser.

## Get started (60 seconds)

Needs ego lite installed and onboarded on the machine running dsh
([lite.ego.app](https://lite.ego.app/)), so `ego-browser` is on the PATH.

```sh
# 1. install
dsh plugin --profile web add -w @dshworks/dsh-ego-browser

# 2. restart dsh

# 3. verify it took — seven names, or [] if it did not
curl -s localhost:8090/dsh-ego-browser/memory | jq .tools
```

`add` registers the bundle in the profile roster for you. Then ask the agent to
run `ego_doctor` once — it is how it finds out whether to write `cliLog()` or
`console.log()` for the ego you installed:

```
command: ego-browser   invoked as: ego-browser <<'JS'
ego runtime surface: facades (console.log / page / browser / taskSpaces); 7 helper names visible.
store: ~/.dsh/ego-browser/workspace (3 sites)
  github — github.com, *.github.com — 3 tool(s): search_repos (0x), get_open_issues (0x), get_repo_stats (0x)
  google — google.com, *.google.com, www.google.com — 2 tool(s): search_and_extract (0x), get_autocomplete_suggestions (0x)
  x-com — x.com, *.x.com, twitter.com, *.twitter.com — 3 tool(s): get_timeline_posts (0x), search_users (0x), post_from_active_element (0x)
```

*Three sites and eight tools before the agent has browsed anything — that is the
store inheriting what ego already shipped.*

## Proof

**On a real dsh boot** (0.1.1-rc.2, installed from npm into a profile, booted):

| Claim | How it was checked |
|---|---|
| The published package installs and loads | `dsh plugin add -w @dshworks/dsh-ego-browser`, restart, and all seven tools register — `GET /dsh-ego-browser/memory` lists them; `[]` when the tools service never arrived |
| The store self-seeds | came up holding `github` (3 tools), `google` (2), `x-com` (3) from `~/.claude/skills/ego-browser/learnings/` |
| Our validator agrees with ego's format | **zero problems** reported against ego's own shipped sites — the useful direction of that check |
| The route is fenced | 200 on loopback, **403** for a `Host` header naming anywhere else |

**Against the genuine built `ego-browser` bundle** and a real subprocess seam:

| Claim | How it was checked |
|---|---|
| The argv probe finds the working shape | picks bare on the current CLI, `nodejs` on the older one, and reports both transcripts when neither runs |
| The surface probe is accurate | returns `facade` with `page, browser, taskSpaces, site, fetch, cdp, help` against the real bundle — matching its source exactly |
| Output survives a failure | a thrown error does not swallow what the script printed first; a top-level `return` still produces a verdict |
| A takeover is named as a takeover | not as a missing result — see [Two runtimes](#two-runtimes-one-command-name) |
| The promotion gate holds | snapshot refs, bad schemas, missing exports, and unparseable source are all refused, writing nothing |

```sh
npm install && npm test    # 74 tests, no browser needed, ~2s
```

The CLI fixtures in `fixtures/` are transcribed from ego's own source — argv
handling from `src/run.ts`, the output sink from `src/output-sink.ts`, the
helper surface from `src/helpers.ts` — with the upstream file named in each
header, because a double weaker than production tests nothing.

**Not verified.** Every path that needs the live browser: an actual page load, a
real task space, a real user takeover. ego lite is a macOS app and this was
built in a Linux container. The wire into it is exercised end to end against the
real CLI bundle; what is on the far side of that wire is not. Run `ego_doctor`
on a real install and [open an issue](https://github.com/dshworks/dsh-ego-browser/issues/new/choose)
with its output if anything below the wire disagrees with this page.

## The gate that makes the memory worth keeping

`ego_learn` refuses code containing a snapshot ref:

```
this is not storable yet:
  - code contains a snapshot ref (@21 / ref=21). Those are rebuilt on every
    snapshotText() call and mean nothing on the next run — re-express the step
    with a stable locator (a CSS selector, or the loc=... value from the
    snapshot) before promoting it.
```

This is the whole difference between a memory and a pile of dead selectors. The
script that just worked is *full* of `@21`s, because that is how the agent found
the element five seconds ago. Storing it verbatim stores nothing. The rule is
ego's own — its validator rejects the same pattern — and enforcing it at write
time is what turns "it worked once" into "it works again".

## Two runtimes, one command name

Worth stating plainly, because it will bite anyone writing against ego.

**The argv shape is not stable.** The shipped skill documents
`ego-browser nodejs <<'EOF'`. The CLI in `citrolabs/ego-lite@main` takes no argv
at all and answers a stray `nodejs` with its usage banner and **exit 2**. The
community Linux port swallows `nodejs` as a no-op prefix. One command name,
three behaviours.

**The helper surface is not stable either.** One generation installs flat
globals — `cliLog`, `snapshotText`, `useOrCreateTaskSpace`. The other installs
Playwright-shaped facades — `page`, `browser`, `taskSpaces`, `site` — and drops
`cliLog` for `console.log`. A script written for one throws `ReferenceError` on
the other, and no amount of documentation fixes it because both documents are
true somewhere. Even inside ego's own repo at HEAD, `SKILL.md` and
`references/install.md` disagree.

So this plugin does not assume. It **asks**, once per boot, and hands the answer
to the model.

**And the output sink can eat your result.** When the user takes a task space
back, ego marks a hard stop and **discards every line the script logged**,
printing only its own guidance. Any integration that parses a result sentinel
out of stdout finds nothing there and reports a parse failure. Here the
sentinel's *absence* is itself the signal, and the run comes back classified:

```
hardStop: true — the user has taken control of this task space; ego paused the
agent. Do not retry and do not take control back on your own — ask the user, and
resume with ego_handoff only after they say to continue.
```

## When to use · When to skip

**Use it if** you want browser work that gets cheaper the second time; you are
on macOS with ego lite installed; you want the agent to reach sites you are
already logged into; or you want the login wall to become a prompt you can
answer instead of a dead turn.

**Skip it if:**

- **You want to watch the agent browse.** This plugin has no viewer. Use
  [Fisfzy/dsh-ego-browser](https://github.com/Fisfzy/dsh-ego-browser) — a live
  screencast panel you can click through, and a vendored Linux port so it works
  without the macOS app.
- **You are not on macOS.** ego lite ships for macOS today. Same recommendation.
- **You want granular `click` / `fill` / `scroll` tools.** Deliberately absent:
  ego's own benchmark attributes its speed to one-script-per-task, so thirty
  small verbs would spend that advantage to look thorough. If your model writes
  poor JavaScript, the granular design will serve you better.
- **You do browser work once and never again.** The memory is the point. Without
  repetition it is overhead over the plain `ego-browser` skill.
- **You need this in CI, headless.** ego lite is a desktop app with a real
  profile. A Playwright plugin is the right tool.

## The seven tools

| tool | what it does |
|---|---|
| `ego_run` | Run one script in ego's runtime. Pass `url` and it prepends everything already learned about that site. Pass `taskSpace` and it opens the space first, in the right dialect. |
| `ego_recall` | Notes and tool signatures for a URL, read off disk. |
| `ego_site_run` | Call a learned tool by site and name, and count the call. |
| `ego_learn` | Promote a working step into a real site tool — and refuse it when it will not survive. |
| `ego_forget` | Remove a tool or a whole site. A memory that is wrong is worse than none. |
| `ego_handoff` | Hand the browser over with a real Continue / Finish task prompt, and take control back on Continue. |
| `ego_doctor` | Which ego, which argv shape, which helper surface, which store, and what is in it. |

<details>
<summary><strong>The store is ego's format, not ours</strong></summary>

```
<workspace>/learnings/<site-id>/manifest.json          id, name, domains, notes, tools
<workspace>/learnings/<site-id>/notes/*.md             what the agent figured out, in prose
<workspace>/learnings/<site-id>/tools/*.js             node tool: export async function f(ctx, args)
<workspace>/learnings/<site-id>/browser-tools/*.js     page tool: evaluated in the tab
```

Anything learned here loads in the stock `ego-browser` skill outside dsh, and in
any other agent pointed at the same workspace. There is no private format and
nothing to migrate out of.

On first boot the store inherits an existing ego skill workspace's `learnings/`
if it finds one, so it starts with the sites ego ships rather than empty. Once.
A site you delete stays deleted.

Everything is validated before a byte is written, so a refused promotion leaves
the store exactly as it was: manifest shape, domain patterns, argument and
return schemas, the declared export, and the source's syntax — parsed
out-of-process with `node --check`, never imported, because that code is written
for the browser runtime and has no business running in the harness.

Read the store at any time:

```sh
curl -s localhost:8090/dsh-ego-browser/memory | jq
```

</details>

<details>
<summary><strong>Configuration</strong></summary>

Every field is optional.

| field | default | what it is |
|---|---|---|
| `bin` | `ego-browser` | The command. An absolute path when it is not on the PATH. |
| `workspace` | `~/.dsh/ego-browser/workspace` | Where learned sites live. Point it at an existing ego skill directory to share that store instead of keeping a copy. |
| `seed` | `true` | Inherit an existing ego workspace's `learnings/` on first boot. |
| `cwd` | harness cwd | Working directory for the `ego-browser` process. |
| `extraArgs` / `env` | `[]` / `{}` | Appended to every invocation. |
| `timeoutMs` | `120000` | How long one script may run. |
| `probeTimeoutMs` | `20000` | How long a capability probe may take. |
| `maxOutputBytes` | `1048576` | Script output retained; overflow keeps the tail. |
| `route` | `true` | Serve the store at `/dsh-ego-browser/memory`. |
| `trustedHosts` | `[]` | Authorities besides loopback that may read that route. |

`subprocess` is the only required service. `tools` and `webServer` are picked up
when present, so a headless profile loads cleanly and simply has no route.

</details>

<details>
<summary><strong>The handoff, in full</strong></summary>

ego's own hard-stop message asks the harness for this, in as many words:

> *"Offer the user choices like "Continue" or "Finish task" if your harness
> supports it"*

dsh supports it. `ego_handoff` hands the space over, raises a genuine dsh
question with those two options, and on **Continue** takes control back so the
next `ego_run` resumes — no "reply continue and I'll try again" dance, no agent
grabbing the keyboard back from a user who is still typing their password.

Where nobody can be asked — headless, no question UI, or the caller is a
subagent, which the harness refuses with `DELEGATED_CALLER` rather than blocking
forever — it says so plainly rather than pretending an answer arrived.

</details>

## Prior art

Two other people wired ego into dsh first, and both are worth your time:

- **[Fisfzy/dsh-ego-browser](https://github.com/Fisfzy/dsh-ego-browser)** — 32
  granular `ego_*` tools plus a live screencast panel you can click through,
  with a vendored Linux port of the ego runtime so it works without the macOS
  app. Genuinely ambitious work, honest about its own limits, and the one to
  pick if you want to *watch* the agent browse. This plugin does not compete
  with it and ships no viewer.
- **[Da1dr1em/dsh-ego-browser](https://github.com/Da1dr1em/dsh-ego-browser)** —
  three tools around the Windows preview host: run, help, status. The smallest
  honest thing that works.

Neither fills the learnings store, and neither turns ego's hard stop into a real
prompt. That is the gap this one is for.

And the thing itself: [**ego lite**](https://github.com/citrolabs/ego-lite) by
[CitroLabs](https://github.com/citrolabs) is the good idea here — one browser
for the human and the agent, instead of a framework driving a second one. The
store format, the temp-ref rule, and the handoff protocol are all theirs; this
plugin only fills them in.

## Contributing · Security · License

[CONTRIBUTING.md](CONTRIBUTING.md) — what needs a real browser, and what does
not. If you have ego lite on a Mac, `ego_doctor` output from a real install is
the most useful thing you can send.

[SECURITY.md](SECURITY.md) — the agent drives your real logged-in sessions.
Worth two minutes before you install.

MIT. ego lite is a separate, free download under its own MIT license; nothing
from it is vendored here. Not affiliated with DeepSeek or CitroLabs.
