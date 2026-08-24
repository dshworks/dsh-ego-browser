/**
 * The claims tripwire.
 *
 * Staleness is the fastest way for a repo to stop being believed, and the
 * numbers on the front page are the first things to rot: a tool gets added, a
 * test file grows, a link is renamed, and the README quietly starts lying while
 * every other check stays green.
 *
 * So the front page is asserted like code. Every number this project publishes
 * about itself — tool count, tool names, test count, the dsh version it claims
 * to be verified against — is checked here against the thing it describes, in
 * all three surfaces that carry it: README.md, README.zh.md, and llms.txt. A
 * claim that drifts turns CI red in the same run that caused the drift.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Config, apply } from '../lib/index.js'
import { makeSubprocess, withTempDir } from './harness.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Read one repo file. */
const read = name => readFileSync(join(ROOT, name), 'utf8')

const README = read('README.md')
const README_ZH = read('README.zh.md')
const LLMS = read('llms.txt')

/**
 * The tool names this plugin actually registers, from a real load.
 * @returns {Promise<string[]>} registered tool names.
 */
async function registeredTools() {
  return withTempDir(async (dir) => {
    const names = []
    const ctx = {
      subprocess: makeSubprocess(),
      logger: { info: () => {}, warn: () => {} },
      tools: { register: tool => names.push(tool.name) },
      get: name => ctx[name],
      effect: run => run(),
      inject: (deps, run) => { if (deps.every(dep => ctx[dep] !== undefined)) run(ctx) },
    }
    apply(ctx, new Config({ workspace: dir, seed: false, route: false }))
    return names
  })
}

/** Every `it(` in the suite — the number vitest will report. */
function declaredTestCount() {
  const dir = join(ROOT, 'tests')
  return readdirSync(dir)
    .filter(name => name.endsWith('.spec.mjs'))
    .reduce((total, name) => total + (readFileSync(join(dir, name), 'utf8').match(/^\s*it\(/gm) ?? []).length, 0)
}

/**
 * Claims are matched on their exact published phrase, not on a bare number.
 *
 * A loose `(\d+) tools` also matches "came up holding github (3 tools)" in the
 * proof table — a different quantity that happens to share a word — so the
 * check would fail on a true page. Anchoring on the phrase the claim is
 * actually written in keeps the assertion precise, and finding EVERY
 * occurrence is what stops a stale copy hiding behind a fresh one elsewhere.
 * `toContain` alone would pass while a second copy of the number lied.
 * @param {Array<[string, RegExp]>} sources - document text paired with a global regex whose first group is the number.
 * @returns {number[]} every stated count, across all sources.
 */
function statedCounts(sources) {
  return sources.flatMap(([text, pattern]) => [...text.matchAll(pattern)].map(match => Number(match[1])))
}

describe('the tool count on the front page', () => {
  it('matches what the plugin registers, everywhere it is stated', async () => {
    const tools = await registeredTools()
    const stated = statedCounts([
      [README, /(\d+) tools ·/g],
      [README_ZH, /(\d+) 个工具 ·/g],
      [LLMS, /(\d+) tools, host-only/g],
    ])
    expect(stated.length, 'all three surfaces should state the tool count').toBe(3)
    expect(stated.filter(count => count !== tools.length)).toEqual([])
  })

  it('names every registered tool in llms.txt, and invents none', async () => {
    const tools = await registeredTools()
    for (const name of tools) expect(LLMS, `llms.txt is missing ${name}`).toContain(`\`${name}(`)
    const advertised = [...LLMS.matchAll(/^- `(ego_[a-z_]+)\(/gm)].map(match => match[1])
    expect(advertised.sort()).toEqual([...tools].sort())
  })

  it('lists every registered tool in both README tables', async () => {
    const tools = await registeredTools()
    for (const name of tools) {
      expect(README, `README is missing ${name}`).toContain(`\`${name}\``)
      expect(README_ZH, `README.zh is missing ${name}`).toContain(`\`${name}\``)
    }
  })
})

describe('the test count in the docs', () => {
  it('matches the suite, everywhere it is stated', () => {
    const count = declaredTestCount()
    const stated = statedCounts([
      [README, /(\d+) tests, no browser/g],
      [read('CONTRIBUTING.md'), /(\d+) tests, no browser/g],
      [README_ZH, /(\d+) 个测试，不需要浏览器/g],
    ])
    expect(stated.length, 'the docs should state the test count in at least three places').toBeGreaterThanOrEqual(3)
    expect(stated.filter(value => value !== count)).toEqual([])
  })
})

describe('the dsh version on the front page', () => {
  it('is the same version in the badge, the value line, and the proof table', () => {
    const claimed = [...README.matchAll(/0\.1\.1-{1,2}rc\.2/g)].length
    expect(claimed, 'the verified-against version should appear in badge, value line and proof').toBeGreaterThanOrEqual(3)
    expect(README_ZH).toContain('0.1.1-rc.2')
    expect(LLMS).toContain('0.1.1-rc.2')
  })
})

describe('relative links', () => {
  it('point at files that exist', () => {
    const targets = new Set()
    for (const source of [README, README_ZH]) {
      for (const match of source.matchAll(/\]\(([^)#:]+?)(?:#[^)]*)?\)/g)) targets.add(match[1])
      for (const match of source.matchAll(/href="([^"#:]+?)(?:#[^"]*)?"/g)) targets.add(match[1])
    }
    const missing = [...targets].filter(target => !target.startsWith('http') && !existsSync(join(ROOT, target)))
    expect(missing).toEqual([])
  })
})
