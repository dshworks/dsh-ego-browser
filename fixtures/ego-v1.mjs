#!/usr/bin/env node
/**
 * Stand-in for the `ego-browser` the SHIPPED skill documents (SKILL.md 1.2.6):
 * `ego-browser nodejs <<'EOF'`, flat global helpers, and `cliLog` as the only
 * output channel. Rejects a bare invocation, which is the mirror image of the
 * current CLI — the two generations are why the plugin probes.
 */
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
if (argv[0] !== 'nodejs') {
  process.stderr.write("Usage:\n  ego-browser nodejs <<'EOF'\n  cliLog(await pageInfo())\n  EOF\n")
  process.exit(2)
}

const context = {
  cliLog: (...args) => process.stdout.write(`${args.map(value => (typeof value === 'string' ? value : JSON.stringify(value))).join(' ')}\n`),
  snapshotText: async () => 'heading "Example Domain" [ref=1, loc=css:h1]',
  pageInfo: async () => ({ url: 'https://example.com/', title: 'Example' }),
  captureScreenshot: async () => ({ path: '/tmp/shot.png' }),
  openOrReuseTab: async url => ({ targetId: 'T1', url }),
  gotoAndWait: async () => ({ ok: true }),
  click: async () => ({ ok: true }),
  fillInput: async () => ({ ok: true }),
  typeText: async () => ({ ok: true }),
  pressKey: async () => ({ ok: true }),
  scrollBy: async () => ({ ok: true }),
  waitForElement: async () => ({ ok: true }),
  useOrCreateTaskSpace: async name => ({ id: 3, name }),
  claimTaskSpace: async id => ({ id }),
  completeTaskSpace: async () => ({ done: true }),
  handOffTaskSpace: async () => ({ done: true }),
  takeOverTaskSpace: async () => ({ done: true }),
  listTaskSpaces: async () => [],
  js: async () => null,
  cdp: async () => ({ result: {} }),
  serverFetch: async () => '',
  browserFetch: async () => '',
  runSiteTool: async (siteId, toolName, args) => ({ siteId, toolName, args, ran: 'node' }),
  runSiteBrowserTool: async (siteId, toolName, args) => ({ siteId, toolName, args, ran: 'browser' }),
  siteSkills: async () => [],
  learnContext: async () => ({ exists: false }),
  help: () => 'help',
}

const code = readFileSync(0, 'utf8')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
Object.assign(globalThis, context)
try {
  await new AsyncFunction(...Object.keys(context), `"use strict";\n${code}`)(...Object.values(context))
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`)
  process.exit(1)
}
