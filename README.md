# dsh-ego-browser

**[ego lite](https://github.com/citrolabs/ego-lite) for DeepSeek Harness, with a memory it keeps.**

ego lite is one browser a human and an agent share: the agent works in its own
Space with the user's real logins, the user's tabs stay theirs. This plugin
brings it into dsh — and adds the half ego's own README still lists as coming
soon.

> *"Experience accumulation that makes your agent faster the more you use it
> **(coming soon)**"* — ego lite README

The reader already ships. `site.learnContext`, `site.runTool` and
`site.runBrowserTool` load a `learnings/` directory out of whatever
`EGO_BROWSER_AGENT_WORKSPACE` points at. What was missing is the half that
**fills** it. That is this plugin.

```
ego_recall     read what this agent already learned about the site  (no browser, no page load)
ego_run        write ONE script for the whole browser task
ego_learn      promote the step that worked into a reusable site tool
ego_handoff    when a page needs a human, ask them — for real — and take control back
```

The loop closes. The second time you scrape that dashboard, the agent calls a
tool it wrote last week instead of rediscovering the page.

---

## Install

Needs ego lite installed and onboarded on the machine running dsh
([lite.ego.app](https://lite.ego.app/)), so `ego-browser` is on the PATH.

```sh
dsh plugin --profile web add -w @dshworks/dsh-ego-browser
# restart dsh, then ask the agent to run ego_doctor
```

`ego_doctor` is the first call worth making. It reports which ego is installed,
how to invoke it, which helper names it has, and where the store lives.

---

## The seven tools

ego's own benchmark is the argument for this list being short: its headline
result — complex tasks up to 2.5x faster with far fewer tool calls — comes from
the agent writing **one script** that navigates, waits, extracts and branches,
instead of a call-look-call-look loop of granular verbs. Shipping thirty small
`click` / `fill` / `scroll` tools spends that advantage to look thorough. So
`ego_run` is the primitive, and the other six exist only because they do
something a script cannot do for itself.

| tool | what it does |
|---|---|
| `ego_run` | Run one script in ego's runtime. Pass `url` and it prepends everything already learned about that site. Pass `taskSpace` and it opens the space first, in the right dialect. |
| `ego_recall` | Notes and tool signatures for a URL, read off disk. No browser, no page load, no tokens spent rediscovering. |
| `ego_site_run` | Call a learned tool by site and name, and count the call. |
| `ego_learn` | Promote a working step into a real site tool — and refuse it when it will not survive to tomorrow. |
| `ego_forget` | Remove a tool or a whole site. A memory that is wrong is worse than none. |
| `ego_handoff` | Hand the browser to the user with a real **Continue / Finish task** prompt, and take control back on Continue. |
| `ego_doctor` | Which ego, which argv shape, which helper surface, which store, and what is in it. |

---

## The gate that makes the memory worth keeping

`ego_learn` refuses code containing a snapshot ref:

```
code contains a snapshot ref (@21 / ref=21). Those are rebuilt on every
snapshotText() call and mean nothing on the next run — re-express the step with
a stable locator (a CSS selector, or the loc=... value from the snapshot) before
promoting it.
```

This is the whole difference between a memory and a pile of dead selectors. The
script that just worked is *full* of `@21`s, because that is how the agent
found the element five seconds ago. Storing it verbatim stores nothing. The
rule is ego's own — its validator rejects the same pattern — and enforcing it at
write time is what turns "it worked once" into "it works again".

Everything else is validated before a byte is written, so a refused promotion
leaves the store exactly as it was: manifest shape, domain patterns, argument
and return schemas, the declared export, and the source's syntax — parsed
out-of-process with `node --check`, never imported, because that code is written
for the browser runtime and has no business running in the harness.

---

## The store is ego's format, not ours

```
<workspace>/learnings/<site-id>/manifest.json          id, name, domains, notes, tools
<workspace>/learnings/<site-id>/notes/*.md             what the agent figured out, in prose
<workspace>/learnings/<site-id>/tools/*.js             node tool: export async function f(ctx, args)
<workspace>/learnings/<site-id>/browser-tools/*.js     page tool: evaluated in the tab
```

Anything learned here loads in the stock `ego-browser` skill outside dsh, and
in any other agent pointed at the same workspace. There is no private format and
nothing to migrate out of.

On first boot the store inherits an existing ego skill workspace's `learnings/`
if it finds one, so it starts with the sites ego ships rather than empty. Once.
A site you delete stays deleted.

Read the store at any time:

```sh
curl -s localhost:8090/dsh-ego-browser/memory | jq
```

---

## Two runtimes, one command name

This is the part every other integration gets wrong, and it is worth stating
plainly because it will bite anyone writing against ego.

**The argv shape is not stable.** The shipped skill documents
`ego-browser nodejs <<'EOF'`. The CLI in `citrolabs/ego-lite@main` takes no
argv at all and answers a stray `nodejs` with its usage banner and **exit 2**.
The community Linux port swallows `nodejs` as a no-op prefix. One command name,
three behaviours.

**The helper surface is not stable either.** One generation installs flat
globals — `cliLog`, `snapshotText`, `useOrCreateTaskSpace`. The other installs
Playwright-shaped facades — `page`, `browser`, `taskSpaces`, `site` — and drops
`cliLog` for `console.log`. A script written for one throws `ReferenceError` on
the other, and no amount of documentation fixes it because both documents are
true somewhere. Even inside ego's own repo at HEAD, `SKILL.md` and
`references/install.md` disagree.

So this plugin does not assume. It **asks**:

```
$ ego_doctor
command: ego-browser   invoked as: ego-browser <<'JS'
ego runtime surface: facades (console.log / page / browser / taskSpaces); 7 helper names visible.
```

Both probes run once, cache, and the answer is handed to the model so it writes
for the ego you installed instead of the one the docs describe.

**And the output sink can eat your result.** When the user takes a task space
back, ego marks a hard stop and **discards every line the script logged**,
printing only its own guidance. Any integration that parses a result sentinel
out of stdout sees nothing there and reports a parse failure. Here the
sentinel's *absence* is itself the signal, and the run comes back classified:

```
hardStop: true — the user has taken control of this task space; ego paused the
agent. Do not retry and do not take control back on your own — ask the user, and
resume with ego_handoff only after they say to continue.
```

---

## The handoff is a real prompt

ego's own hard-stop message asks the harness for this, in as many words:

> *"Offer the user choices like "Continue" or "Finish task" if your harness
> supports it"*

dsh supports it. `ego_handoff` hands the space over, raises a genuine dsh
question with those two options, and on **Continue** takes control back so the
next `ego_run` resumes — no "reply continue and I'll try again" dance, no agent
grabbing the keyboard back from a user who is still typing their password.

Where the deployment has no way to ask anyone — headless, no UI — it says so
plainly rather than pretending an answer arrived.

---

## Configuration

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

---

## What is verified, and what is not

Honest, because a browser plugin that overclaims is worse than none.

**Verified on a real dsh boot** (0.1.1-rc.2, `dsh --profile <p>` with the plugin
linked in):

- all seven tools register — the memory route reports them, which is also how
  you check it from outside: `curl -s localhost:8090/dsh-ego-browser/memory | jq .tools`
- the store seeded itself from the installed ego skill's own `learnings/` and
  came up holding `github` (3 tools), `google` (2), and `x-com` (3)
- the validator reports **zero problems** against those shipped sites, which is
  the useful direction of that check: our rules agree with ego's format on ego's
  own files
- the route answers loopback and returns 403 for a Host header naming anywhere
  else

**Verified against the genuine built `ego-browser` bundle** and a real
subprocess seam (66 tests, `npm test`):

- the argv probe picks the shape that works, on both generations, and reports
  both transcripts when neither does
- the surface probe returns `facade` with `page, browser, taskSpaces, site,
  fetch, cdp, help` against the real bundle — matching its source exactly
- a script runs, its output comes back verbatim, and a thrown error does not
  swallow what the script printed first
- a top-level `return` still produces a verdict
- a hard stop is named as a hard stop rather than as a missing result
- the store round-trips: write, recall, count, validate, forget
- `ego_learn` refuses snapshot refs, bad schemas, missing exports, and source
  that does not parse — writing nothing in every case
- the memory route answers loopback and refuses a rebound host or cross-site read

**Not verified.** Every path that needs the live browser — an actual page load,
a real task space, a real user takeover — because ego lite is a macOS app and
this was built in a Linux container. The wire into it is exercised end to end
against the real CLI bundle; what is on the far side of that wire is not. Run
`ego_doctor` first on a real install, and open an issue with its output if
anything below the wire disagrees with what is written here.

---

## Prior art

Two other people have wired ego into dsh, and both are worth your time if this
one is not what you want:

- **[Fisfzy/dsh-ego-browser](https://github.com/Fisfzy/dsh-ego-browser)** — 32
  granular `ego_*` tools plus a live screencast panel you can click through,
  with a vendored Linux port of the ego runtime so it works without the macOS
  app. If what you want is to *watch* the agent browse, that is the one. This
  plugin does not compete with it and does not ship a viewer.
- **[Da1dr1em/dsh-ego-browser](https://github.com/Da1dr1em/dsh-ego-browser)** —
  three tools around the Windows preview host: run, help, status.

Neither fills the learnings store, and neither turns ego's hard stop into a real
prompt. That is the gap this one is for.

---

## License

MIT. ego lite is a separate, free download from
[CitroLabs](https://github.com/citrolabs/ego-lite) under its own MIT license;
nothing from it is vendored here.

Not affiliated with DeepSeek or CitroLabs.
