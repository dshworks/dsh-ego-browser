#!/usr/bin/env node
/**
 * Stand-in for the CURRENT `ego-browser` CLI (citrolabs/ego-lite@main,
 * package/ego-browser).
 *
 * Faithful on the four things the plugin depends on, each transcribed from that
 * package's own source rather than guessed:
 *
 *   argv     any argument at all is a usage error with exit 2 (src/run.ts:
 *            `if (argv.length > 0) { write(stderr, USAGE); return 2 }`).
 *            Verified against the built bundle on 2026-08-24: passing the
 *            documented `nodejs` prefix exits 2.
 *   stdin    the whole heredoc is compiled as an async function body.
 *   output   `console.log` is the channel and there is no `cliLog` global
 *            (src/index.ts).
 *   sink     output is BUFFERED, and a hard-stop error discards the entire
 *            buffer and prints ego's own guidance instead (src/output-sink.ts).
 *            That last one is why a result sentinel can go missing.
 *
 * `EGO_FIXTURE_HARDSTOP=1` makes the first task-space call raise the hard stop.
 */
import { readFileSync } from 'node:fs'

const USAGE = "Usage:\n  ego-browser <<'JS'\n  console.log(await page.info())\n  JS\n"

if (process.argv.slice(2).length > 0) {
  process.stderr.write(USAGE)
  process.exit(2)
}

const buffer = []
let hardStop = null

const HARD_STOP_MESSAGE = [
  'The user has taken control of this task space, so browser commands are paused.',
  'This is a hard stop, not an obstacle to route around — do not retry and do not take control back on your own.',
].join('\n')

/**
 * Raise ego's hard stop, recording it the way `buildEgoError` does.
 * @throws {Error} the hard-stop error, carrying its stable code.
 */
function raiseHardStop() {
  if (hardStop === null) hardStop = HARD_STOP_MESSAGE
  const error = new Error(HARD_STOP_MESSAGE)
  error.error_code = 'EGO_TASK_SPACE_USER_IN_CONTROL'
  throw error
}

const blocked = process.env.EGO_FIXTURE_HARDSTOP === '1'

const context = {
  page: {
    info: async () => ({ url: 'https://example.com/', title: 'Example', w: 1280, h: 800 }),
    snapshot: async () => 'heading "Example Domain" [ref=1, loc=css:h1]',
    url: async () => 'https://example.com/',
    goto: async () => ({ ok: true }),
    waitForLoadState: async () => ({ ok: true }),
    locator: () => ({ innerText: async () => 'Example Domain' }),
    evaluate: async () => null,
    screenshot: async () => ({ path: '/tmp/shot.png' }),
    keyboard: { press: async () => ({ ok: true }) },
    mouse: { click: async () => ({ ok: true }) },
  },
  browser: {
    listTabs: async () => ({ tabs: [] }),
    openOrReuseTab: async url => ({ targetId: 'T1', url }),
    currentTab: async () => ({ targetId: 'T1' }),
    switchTab: async () => ({ ok: true }),
    closeTab: async () => ({ ok: true }),
  },
  taskSpaces: {
    useOrCreate: async (name) => { if (blocked) raiseHardStop(); return { id: 7, name } },
    claim: async id => ({ id, ownership: 'agent' }),
    handOff: async () => ({ done: true }),
    takeOver: async () => ({ done: true }),
    complete: async () => ({ done: true }),
    list: async () => [],
  },
  site: {
    skills: async () => [],
    skillsForUrl: async () => [],
    runTool: async (siteId, toolName, args) => ({ siteId, toolName, args, ran: 'node' }),
    runBrowserTool: async (siteId, toolName, args) => ({ siteId, toolName, args, ran: 'browser' }),
    learnContext: async () => ({ exists: false }),
  },
  fetch: { server: async () => '', browser: async () => '' },
  cdp: async () => ({ result: {} }),
  help: () => 'help',
}

const code = readFileSync(0, 'utf8')
console.log = (...args) => buffer.push(`${args.map(value => (typeof value === 'string' ? value : JSON.stringify(value))).join(' ')}\n`)

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const names = Object.keys(context)
Object.assign(globalThis, context)
let thrown = null
try {
  await new AsyncFunction(...names, `"use strict";\n${code}`)(...Object.values(context))
} catch (error) {
  thrown = error
}
if (hardStop !== null) {
  // The buffer is dropped, exactly as the real sink does.
  if (thrown === null) process.stdout.write(`${hardStop}\n`)
} else {
  for (const chunk of buffer) process.stdout.write(chunk)
}
if (thrown !== null) {
  process.stderr.write(`${thrown.stack || thrown.message}\n`)
  process.exit(1)
}
