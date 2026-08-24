/**
 * The seam to ego lite's `ego-browser` command.
 *
 * ego lite runs the browser; `ego-browser` is the only public wire into it — a
 * heredoc of JavaScript on stdin, run inside the app's Node runtime where
 * `globalThis.ego` is bound to the native browser. Everything this plugin does
 * goes through here.
 *
 * Two things about that wire are not stable, and both are handled by probing
 * the installed command rather than by assuming:
 *
 * 1. **argv.** The shipped skill documents `ego-browser nodejs <<'EOF'`. The
 *    current CLI in citrolabs/ego-lite@main takes no argv at all and answers a
 *    stray `nodejs` with its usage banner and exit 2 (verified 2026-08-24
 *    against the built `package/ego-browser` bundle). The community Linux port
 *    swallows `nodejs` as a no-op prefix. One binary name, three behaviours —
 *    so `probeArgv()` finds the shape that works and caches it.
 *
 * 2. **The helper surface.** The older runtime installs flat globals
 *    (`cliLog`, `snapshotText`, `useOrCreateTaskSpace`); the newer one installs
 *    Playwright-shaped facades (`page`, `browser`, `taskSpaces`, `site`) and
 *    drops `cliLog` for `console.log`. A script written for one throws
 *    ReferenceError on the other. `probeSurface()` asks the runtime which names
 *    it actually has, and the answer is handed to the model so it writes for the
 *    ego the user installed instead of the one the docs describe.
 *
 * The third fact worth knowing is the output sink. When a task space is taken
 * back by the user, ego marks a hard stop and DISCARDS every line the script
 * logged, printing only its own guidance. So a result sentinel cannot be relied
 * on to always arrive: its absence is itself a signal, and `classify()` reads
 * the remaining text to say why.
 */

/** Marks the end of a run so partial output is never mistaken for a result. */
export const SENTINEL = '@@DSH_EGO@@'

/**
 * Phrase common to both of ego's owned hard-stop messages
 * (EGO_TASK_SPACE_USER_IN_CONTROL, EGO_TASK_SPACE_INACTIVE). The codes are the
 * durable contract, but a hard stop never reaches us as a code — the runtime
 * prints its own wording and drops the buffer — so the wording is what there is.
 */
const HARD_STOP_PHRASE = 'taken control of this task space'

/** Probe markers, kept distinct so a probe can never be read as a real result. */
const ARGV_MARKER = 'EGO_ARGV_PROBE_OK'

/** Names asked about in the surface probe, covering both runtime generations. */
const SURFACE_NAMES = [
  'cliLog', 'snapshotText', 'captureScreenshot', 'openOrReuseTab', 'gotoAndWait',
  'click', 'fillInput', 'typeText', 'pressKey', 'scrollBy', 'waitForElement',
  'useOrCreateTaskSpace', 'completeTaskSpace', 'handOffTaskSpace', 'takeOverTaskSpace',
  'claimTaskSpace', 'listTaskSpaces', 'js', 'cdp', 'serverFetch', 'browserFetch',
  'page', 'browser', 'taskSpaces', 'site', 'learnings', 'fetch', 'help',
  'siteSkills', 'runSiteTool', 'runSiteBrowserTool', 'learnContext',
]

/**
 * Wrap an agent-written script so a run always reports how it ended.
 *
 * The sentinel is emitted from `finally`, not after the body, because the body
 * is compiled as an async function body where a top-level `return` is legal and
 * would otherwise skip it. Errors are caught and reported rather than rethrown:
 * a rethrow makes the runtime treat the run as a thrown completion and drop the
 * script's own output, which is usually the most useful part of a failure.
 * @param {string} script - the agent's JavaScript.
 * @returns {string} the script with the compatibility prologue and reporting epilogue.
 */
export function wrapScript(script) {
  return [
    `const __egoOut = (typeof cliLog === 'function' ? cliLog : console.log)`,
    `let __egoErr = null`,
    `try {`,
    script,
    `} catch (e) { __egoErr = e } finally {`,
    `  __egoOut(${JSON.stringify(SENTINEL)} + ' ' + JSON.stringify(__egoErr === null ? { ok: true } : {`,
    `    ok: false,`,
    `    error: String((__egoErr && __egoErr.message) || __egoErr),`,
    `    code: (__egoErr && __egoErr.error_code) || undefined,`,
    `  }))`,
    `}`,
  ].join('\n')
}

/**
 * Split a completed run's raw stdout into the script's own output and its verdict.
 * @param {string} stdout - everything the run wrote to stdout.
 * @param {string} stderr - everything the run wrote to stderr.
 * @returns {{output: string, ok: boolean, error?: string, code?: string, hardStop: boolean, sentinel: boolean}} the classified run.
 */
export function classify(stdout, stderr) {
  const lines = stdout.split('\n')
  const at = lines.findLastIndex(line => line.startsWith(SENTINEL))
  const hardStop = `${stdout}\n${stderr}`.includes(HARD_STOP_PHRASE)
  if (at === -1) {
    // No verdict line. Either the runtime discarded the buffer (a hard stop) or
    // the process died before the epilogue ran.
    return {
      output: stdout.trim(),
      ok: false,
      error: hardStop
        ? 'the user has taken control of this task space; ego paused the agent. Do not retry and do not take control back on your own — ask the user, and resume with ego_handoff only after they say to continue.'
        : (stderr.trim() || 'the ego runtime exited without reporting a result'),
      hardStop,
      sentinel: false,
    }
  }
  let verdict
  try {
    verdict = JSON.parse(lines[at].slice(SENTINEL.length).trim())
  } catch {
    verdict = { ok: false, error: 'unparseable result line from the ego runtime' }
  }
  lines.splice(at, 1)
  return {
    output: lines.join('\n').trim(),
    ok: verdict.ok === true,
    error: verdict.error,
    code: verdict.code,
    hardStop,
    sentinel: true,
  }
}

/**
 * Read a collected stream to the end.
 * @param {object | undefined} reader - a subprocess collected-output reader.
 * @returns {string} the whole retained text.
 */
function readAll(reader) {
  return reader === undefined ? '' : reader.readFrom(0).text
}

/** One installed `ego-browser`, with the facts about it discovered on first use. */
export class Ego {
  /**
   * @param {object} options - construction options.
   * @param {object} options.subprocess - the harness's `ctx.subprocess` service.
   * @param {object} options.config - this plugin's validated configuration.
   * @param {string} options.workspace - the agent workspace handed to the runtime.
   */
  constructor({ subprocess, config, workspace }) {
    this.subprocess = subprocess
    this.config = config
    this.workspace = workspace
    /** @type {readonly string[] | null} */
    this.argvPrefix = null
    /** @type {{globals: string[], generation: string} | null} */
    this.surface = null
  }

  /** Forget both probes so the next call rediscovers them. */
  reset() {
    this.argvPrefix = null
    this.surface = null
  }

  /**
   * Spawn `ego-browser` once with a script on stdin.
   * @param {string} script - the exact bytes to write to stdin.
   * @param {object} [options] - `argv` extra arguments, `timeoutMs`, and `signal`.
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number | null, signal: string | null}>} the raw run.
   */
  async spawn(script, options = {}) {
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs
    const timer = AbortSignal.timeout(timeoutMs)
    const signal = options.signal === undefined ? timer : AbortSignal.any([timer, options.signal])
    const handle = this.subprocess.spawn({
      argv: [this.config.bin, ...(options.argv ?? []), ...this.config.extraArgs],
      cwd: this.config.cwd || process.cwd(),
      env: {
        // The runtime resolves `learnings/` (and `agent_helpers.js`, and a
        // `.env`) relative to this directory. Pointing it at the plugin's store
        // is what makes a learned site tool survive the session that wrote it.
        EGO_BROWSER_AGENT_WORKSPACE: this.workspace,
        ...this.config.env,
      },
      stdio: {
        stdin: { data: script },
        stdout: { maxBytes: this.config.maxOutputBytes },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: this.config.graceMs,
      signal,
    })
    const outcome = await handle.done
    return {
      stdout: readAll(handle.collected.stdout),
      stderr: readAll(handle.collected.stderr),
      exitCode: outcome.exitCode,
      signal: outcome.signal,
    }
  }

  /**
   * Find the argv shape this installation accepts, and remember it.
   *
   * Bare is tried first because it is what the current CLI wants and what the
   * Linux port also accepts; `nodejs` is the documented older shape. A run that
   * prints the marker is the proof — an exit code alone would not distinguish
   * "ran the script" from "printed its usage banner".
   * @param {object} [options] - `signal` to abort the probe.
   * @returns {Promise<readonly string[]>} the argv prefix to use.
   */
  async probeArgv(options = {}) {
    if (this.argvPrefix !== null) return this.argvPrefix
    const script = `(typeof cliLog === 'function' ? cliLog : console.log)(${JSON.stringify(ARGV_MARKER)})`
    const attempts = []
    for (const prefix of [[], ['nodejs']]) {
      const run = await this.spawn(script, { argv: prefix, signal: options.signal, timeoutMs: this.config.probeTimeoutMs })
      if (run.stdout.includes(ARGV_MARKER)) {
        this.argvPrefix = prefix
        return prefix
      }
      attempts.push(`${this.config.bin} ${prefix.join(' ')} -> exit ${run.exitCode}: ${(run.stderr || run.stdout).trim().split('\n')[0] || '(no output)'}`)
    }
    throw new Error(
      `${this.config.bin} did not run a script in either argv shape. `
      + `Check that ego lite is installed and onboarded (https://lite.ego.app/), then run ego_doctor.\n`
      + attempts.map(line => `  ${line}`).join('\n'),
    )
  }

  /**
   * Ask the runtime which helper names it actually exposes.
   *
   * This is the only honest way to know: the two generations share a command
   * name and a version string tells us nothing about which helpers are bound.
   * @param {object} [options] - `signal` to abort the probe.
   * @returns {Promise<{globals: string[], generation: string}>} the observed surface.
   */
  async probeSurface(options = {}) {
    if (this.surface !== null) return this.surface
    const argv = await this.probeArgv(options)
    const script = [
      `const __out = (typeof cliLog === 'function' ? cliLog : console.log)`,
      `const __names = ${JSON.stringify(SURFACE_NAMES)}`,
      `__out(JSON.stringify(__names.filter(n => globalThis[n] !== undefined)))`,
    ].join('\n')
    const run = await this.spawn(script, { argv, signal: options.signal, timeoutMs: this.config.probeTimeoutMs })
    let globals = []
    for (const line of run.stdout.split('\n')) {
      const text = line.trim()
      if (!text.startsWith('[')) continue
      try {
        const parsed = JSON.parse(text)
        if (Array.isArray(parsed)) globals = parsed
      } catch { /* not the line we want */ }
    }
    const flat = globals.includes('snapshotText') || globals.includes('cliLog')
    const facade = globals.includes('page') && globals.includes('taskSpaces')
    this.surface = {
      globals,
      generation: flat && facade ? 'both' : flat ? 'flat' : facade ? 'facade' : 'unknown',
    }
    return this.surface
  }

  /**
   * Run one agent-written script and report how it ended.
   * @param {string} script - the agent's JavaScript.
   * @param {object} [options] - `timeoutMs` and `signal`.
   * @returns {Promise<object>} the classified run plus timing.
   */
  async run(script, options = {}) {
    const argv = await this.probeArgv(options)
    const started = Date.now()
    const raw = await this.spawn(wrapScript(script), { argv, ...options })
    const verdict = classify(raw.stdout, raw.stderr)
    return {
      ...verdict,
      exitCode: raw.exitCode,
      stderr: raw.stderr.trim(),
      ms: Date.now() - started,
    }
  }
}
