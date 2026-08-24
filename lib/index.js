/**
 * dsh-ego-browser — ego lite for DeepSeek Harness, with a memory it keeps.
 *
 * ego lite is one browser that a human and an agent share: the agent works in
 * its own Space, reusing the user's real logins, while the user's tabs stay
 * theirs. Its own README lists one capability as still to come — "experience
 * accumulation that makes your agent faster the more you use it". The reader for
 * that already ships: `site.learnContext`, `site.runTool`, and
 * `site.runBrowserTool` load a `learnings/` directory out of whatever
 * `EGO_BROWSER_AGENT_WORKSPACE` points at. What is missing is the half that
 * fills it.
 *
 * This plugin is that half, wired into dsh:
 *
 *   recall  the agent reads what it learned about a site before it acts, off
 *           disk, with no page load and no tokens spent rediscovering
 *   run     it writes ONE script per browser task, which is the design ego's
 *           own benchmark is built on
 *   learn   a step that worked is promoted into a real site tool, in ego's
 *           format, refused if it depends on a snapshot ref that will not
 *           survive to tomorrow
 *   hand off  when a page needs a human, ego's hard stop becomes a real dsh
 *           prompt with Continue / Finish task, and Continue takes control back
 *
 * Nothing here reimplements a browser. The one wire is the `ego-browser`
 * command, and `lib/ego.js` explains why even that is probed rather than
 * assumed.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { Ego } from './ego.js'
import { Memory, defaultWorkspace, seedCandidates } from './memory.js'
import { registerTools } from './tools.js'
import { assertTrustedAuthority, checkReadRequest } from './trust.js'

export const name = 'dsh-ego-browser'

/** Where the Web UI (or curl) can read the store. */
const MEMORY_PATH = '/dsh-ego-browser/memory'

export const Config = z.object({
  /** The ego lite command. An absolute path when it is not on the harness's PATH. */
  bin: z.string().default('ego-browser'),
  /**
   * Where learned site skills live. Empty picks `~/.dsh/ego-browser/workspace`.
   * The runtime reads `learnings/` under this directory, so pointing it at an
   * existing ego skill directory shares that store instead of keeping a copy.
   */
  workspace: z.string().default(''),
  /**
   * Copy an existing ego workspace's `learnings/` in on first boot, so the store
   * starts with the sites ego already ships rather than empty. Happens once; a
   * site deleted afterwards stays deleted.
   */
  seed: z.boolean().default(true),
  /** Working directory for the `ego-browser` process. Empty uses the harness's own. */
  cwd: z.string().default(''),
  /** Extra arguments appended to every invocation. */
  extraArgs: z.array(String).default([]),
  /** Extra environment entries for the `ego-browser` process. */
  env: z.dict(String).default({}),
  /** Default milliseconds a script may run before it is aborted. */
  timeoutMs: z.number().min(1000).max(3_600_000).default(120_000),
  /** Milliseconds a capability probe may take. Probes run a one-line script. */
  probeTimeoutMs: z.number().min(1000).max(120_000).default(20_000),
  /** Bytes of script output retained. Overflow keeps the tail. */
  maxOutputBytes: z.number().min(4096).max(8 * 1024 * 1024).default(1_048_576),
  /** SIGTERM-to-SIGKILL grace when a run is aborted. */
  graceMs: z.number().min(100).max(60_000).default(3000),
  /** Expose the memory route to the Web UI. Off keeps the store tools-only. */
  route: z.boolean().default(true),
  /**
   * Authorities besides loopback that may read the memory route. Match the
   * `--trusted-host` values the deployment already runs with.
   */
  trustedHosts: z.array(String).default([]),
})

/**
 * `subprocess` is the only hard requirement — it is the wire to ego. `tools` and
 * `webServer` arrive through `ctx.inject(...)` inside `apply`, so a headless
 * profile with no web server still loads, and a profile that brings the tools
 * service up later still gets its tools registered when it does.
 */
export const inject = ['subprocess']

/**
 * Parse a tool source out-of-process.
 *
 * `node --check` parses without executing. That distinction is the whole point:
 * the store holds code written by a model for the BROWSER runtime to run, and
 * importing it here to check it would run it in the harness's process instead.
 *
 * The `.mjs` extension is load-bearing. `node --check` on a `.js` file whose
 * source is ESM exits 0 even when the source does not parse — the CJS attempt
 * fails and the module-detection retry swallows the error (verified on Node
 * v22.23.2). Checking the same bytes as `.mjs` reports the SyntaxError, which is
 * the whole reason this function exists.
 * @param {object} subprocess - the harness's subprocess service.
 * @param {number} graceMs - termination grace for the check process.
 * @returns {(code: string, signal?: AbortSignal) => Promise<string | null>} a checker returning the parse error, or null.
 */
function makeSyntaxChecker(subprocess, graceMs) {
  return async (code, signal) => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ego-'))
    const file = join(dir, 'tool.mjs')
    try {
      await writeFile(file, code)
      const handle = subprocess.spawn({
        argv: [process.execPath, '--check', file],
        cwd: dir,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 8192 }, stderr: { maxBytes: 32_768 } },
        graceMs,
        signal,
      })
      const outcome = await handle.done
      if (outcome.exitCode === 0) return null
      const text = handle.collected.stderr?.readFrom(0).text ?? ''
      return text.replace(new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'tool.mjs').trim() || 'unknown parse error'
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

/**
 * Mount the plugin: the store, the wire to ego, the tools, and the read route.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @param {ReturnType<typeof Config>} config - validated configuration.
 */
export function apply(ctx, config) {
  for (const entry of config.trustedHosts) assertTrustedAuthority(entry)

  const workspace = config.workspace === '' ? defaultWorkspace() : config.workspace
  const memory = new Memory(workspace)
  // Boot work is a promise the store's own reads wait on rather than an async
  // `apply`: a tool call that lands mid-boot must see the seeded store, and a
  // plugin that blocks its load on filesystem work delays every sibling.
  memory.ready = memory.ensure()
    .then(() => (config.seed ? memory.seed(seedCandidates()) : { seeded: false }))
    .then((seeded) => {
      if (seeded.seeded) {
        ctx.logger.info(`inherited ${seeded.sites.length} learned site(s) from ${seeded.from}`)
      }
    })
    .catch((error) => {
      ctx.logger.warn(`could not prepare the learned store at ${workspace}: ${error.message}`)
    })

  const ego = new Ego({ subprocess: ctx.subprocess, config, workspace })

  ctx.inject(['tools'], (toolCtx) => {
    registerTools(toolCtx, {
      ego,
      memory,
      config,
      checkSyntax: makeSyntaxChecker(ctx.subprocess, config.graceMs),
    })
  })

  if (!config.route) return
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: MEMORY_PATH,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' }).end()
          return
        }
        if (!checkReadRequest(req, config.trustedHosts)) {
          res.writeHead(403).end('forbidden')
          return
        }
        const body = JSON.stringify({
          workspace: memory.workspace,
          sites: await memory.list(),
          problems: await memory.validate(),
        })
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(body)
      },
    }))
  })
}
