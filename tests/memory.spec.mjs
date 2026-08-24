import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Memory, domainMatches, exportsCallable, hostnameOf, isValidDomain, validateLearnSpec } from '../lib/memory.js'
import { withTempDir } from './harness.mjs'

/** A promotion request that passes every gate. */
function goodSpec(overrides = {}) {
  return {
    site: 'github',
    name: 'GitHub',
    domains: ['github.com', '*.github.com'],
    tool: 'open_issues',
    description: 'List open issues on a repository page.',
    callable: 'openIssues',
    code: 'export async function openIssues(ctx, args) {\n  return ctx.page.locator(".js-issue-row").evaluateAll(rows => rows.length)\n}\n',
    args: { repo: { type: 'string', required: true, description: 'owner/name.' } },
    returns: { type: 'array', description: 'Issue rows.' },
    ...overrides,
  }
}

describe('domain matching', () => {
  it('reads a hostname out of a URL or a bare domain', () => {
    expect(hostnameOf('https://github.com/a/b')).toBe('github.com')
    expect(hostnameOf('GitHub.com')).toBe('github.com')
    expect(hostnameOf('')).toBe('')
  })

  it('matches exact and leading-wildcard patterns the way ego does', () => {
    expect(domainMatches('github.com', 'github.com')).toBe(true)
    expect(domainMatches('gist.github.com', '*.github.com')).toBe(true)
    // A wildcard covers subdomains, not the apex — ego's own rule.
    expect(domainMatches('github.com', '*.github.com')).toBe(false)
    expect(domainMatches('notgithub.com', 'github.com')).toBe(false)
  })

  it('rejects patterns ego would refuse to load', () => {
    expect(isValidDomain('github.com')).toBe(true)
    expect(isValidDomain('*.github.com')).toBe(true)
    expect(isValidDomain('https://github.com')).toBe(false)
    expect(isValidDomain('github.com/x')).toBe(false)
    expect(isValidDomain('*github.com')).toBe(false)
    expect(isValidDomain('*.*.com')).toBe(false)
  })
})

describe('the promotion gate', () => {
  it('accepts a complete request', () => {
    expect(validateLearnSpec(goodSpec())).toEqual([])
  })

  it('refuses code that leans on a snapshot ref', () => {
    // This is the rule that makes the store worth keeping: @21 is rebuilt on
    // every snapshotText() call, so storing it stores nothing.
    const problems = validateLearnSpec(goodSpec({ code: 'export async function openIssues(ctx) { await ctx.click("@21") }' }))
    expect(problems.join('\n')).toMatch(/snapshot ref/)
    expect(problems.join('\n')).toMatch(/stable locator/)
  })

  it('refuses a ref=N in a note too', () => {
    expect(validateLearnSpec(goodSpec({ note: 'click ref=44 to expand' })).join('\n')).toMatch(/snapshot ref/)
  })

  it('refuses code that does not export the declared callable', () => {
    expect(validateLearnSpec(goodSpec({ callable: 'somethingElse' })).join('\n')).toMatch(/must export "somethingElse"/)
  })

  it('collects every problem at once instead of stopping at the first', () => {
    const problems = validateLearnSpec({ site: 'a b', tool: '', domains: [] })
    expect(problems.length).toBeGreaterThan(4)
  })

  it('demands a described, typed return schema', () => {
    expect(validateLearnSpec(goodSpec({ returns: { type: 'blob', description: 'x' } })).join('\n')).toMatch(/returns.type/)
    expect(validateLearnSpec(goodSpec({ returns: undefined })).join('\n')).toMatch(/returns must be an object/)
  })

  it('sees an export list as well as an export declaration', () => {
    expect(exportsCallable('async function f() {}\nexport { f }', 'f')).toBe(true)
    expect(exportsCallable('export const f = async () => {}', 'f')).toBe(true)
    expect(exportsCallable('function f() {}', 'f')).toBe(false)
  })
})

describe('the store', () => {
  it('writes a site ego itself could load', async () => {
    await withTempDir(async (dir) => {
      const memory = new Memory(dir)
      const receipt = await memory.learn(goodSpec())
      expect(receipt.call).toContain('site.runTool("github", "open_issues"')
      const manifest = JSON.parse(await readFile(join(dir, 'learnings/github/manifest.json'), 'utf8'))
      expect(manifest.id).toBe('github')
      expect(manifest.domains).toEqual(['github.com', '*.github.com'])
      expect(manifest.nodeTools.open_issues.path).toBe('tools/open-issues.js')
      expect(manifest.nodeTools.open_issues.callable).toBe('openIssues')
      expect(existsSync(join(dir, 'learnings/github/tools/open-issues.js'))).toBe(true)
      expect(await memory.validate()).toEqual([])
    })
  })

  it('adds a second tool to a site without dropping the first', async () => {
    await withTempDir(async (dir) => {
      const memory = new Memory(dir)
      await memory.learn(goodSpec())
      await memory.learn(goodSpec({ tool: 'star_count', callable: 'starCount', code: 'export async function starCount(ctx) { return 1 }', returns: { type: 'number', description: 'Stars.' } }))
      const manifest = await memory.manifest('github')
      expect(Object.keys(manifest.nodeTools).sort()).toEqual(['open_issues', 'star_count'])
    })
  })

  it('stores a browser tool in the other table', async () => {
    await withTempDir(async (dir) => {
      const memory = new Memory(dir)
      const receipt = await memory.learn(goodSpec({ kind: 'browser', tool: 'read_title', callable: undefined, code: 'document.title' }))
      expect(receipt.kind).toBe('browser')
      const manifest = await memory.manifest('github')
      expect(manifest.browserTools.read_title.path).toBe('browser-tools/read-title.js')
      expect(receipt.call).toContain('runBrowserTool')
    })
  })

  it('leaves the store untouched when a promotion is refused', async () => {
    await withTempDir(async (dir) => {
      const memory = new Memory(dir)
      await expect(memory.learn(goodSpec({ code: 'export async function openIssues(ctx) { await ctx.click("@7") }' }))).rejects.toThrow(/snapshot ref/)
      expect(existsSync(join(dir, 'learnings/github'))).toBe(false)
    })
  })

  it('recalls notes and signatures for a matching hostname', async () => {
    await withTempDir(async (dir) => {
      const memory = new Memory(dir)
      await memory.learn(goodSpec({ note: 'Issue rows are .js-issue-row; the list is client-rendered, so wait for it.' }))
      const recalled = await memory.recall('https://gist.github.com/someone/abc')
      expect(recalled.known).toBe(true)
      expect(recalled.sites[0].notes[0].content).toMatch(/client-rendered/)
      expect(recalled.sites[0].tools[0].name).toBe('open_issues')
      expect(recalled.sites[0].tools[0].runs).toBe(0)
    })
  })

  it('knows nothing about an unrelated host', async () => {
    await withTempDir(async (dir) => {
      const memory = new Memory(dir)
      await memory.learn(goodSpec())
      expect((await memory.recall('https://example.com')).known).toBe(false)
    })
  })

  it('counts runs so an unused tool is visible as unused', async () => {
    await withTempDir(async (dir) => {
      const memory = new Memory(dir)
      await memory.learn(goodSpec())
      await memory.recordUsage('github', 'open_issues', true, '2026-08-24T00:00:00.000Z')
      await memory.recordUsage('github', 'open_issues', false, '2026-08-24T00:01:00.000Z')
      const [site] = await memory.list()
      expect(site.tools[0].runs).toBe(2)
      expect(site.tools[0].lastOk).toBe(false)
    })
  })

  it('forgets one tool and then the whole site', async () => {
    await withTempDir(async (dir) => {
      const memory = new Memory(dir)
      await memory.learn(goodSpec())
      await memory.learn(goodSpec({ tool: 'star_count', callable: 'starCount', code: 'export async function starCount(ctx) { return 1 }', returns: { type: 'number', description: 'Stars.' } }))
      await memory.forget('github', 'open_issues')
      expect(existsSync(join(dir, 'learnings/github/tools/open-issues.js'))).toBe(false)
      expect(Object.keys((await memory.manifest('github')).nodeTools)).toEqual(['star_count'])
      await memory.forget('github')
      expect(await memory.listSiteIds()).toEqual([])
    })
  })

  it('refuses to forget what it never learned', async () => {
    await withTempDir(async (dir) => {
      const memory = new Memory(dir)
      await expect(memory.forget('nowhere')).rejects.toThrow(/nothing learned/)
      await expect(memory.forget('../etc')).rejects.toThrow(/not a site id/)
    })
  })

  it('flags a stored file that drifted into a snapshot ref', async () => {
    await withTempDir(async (dir) => {
      const memory = new Memory(dir)
      await memory.learn(goodSpec())
      await writeFile(join(dir, 'learnings/github/tools/open-issues.js'), 'export async function openIssues(ctx) { await ctx.click("@9") }\n')
      expect((await memory.validate()).join('\n')).toMatch(/temporary snapshot ref/)
    })
  })

  it('flags a manifest whose id stopped matching its directory', async () => {
    await withTempDir(async (dir) => {
      const memory = new Memory(dir)
      await memory.learn(goodSpec())
      const path = join(dir, 'learnings/github/manifest.json')
      const manifest = JSON.parse(await readFile(path, 'utf8'))
      manifest.id = 'gitlab'
      await writeFile(path, JSON.stringify(manifest))
      expect((await memory.validate()).join('\n')).toMatch(/manifest id must match/)
    })
  })
})

describe('seeding', () => {
  it('inherits an existing ego workspace once, and only once', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'skill')
      await mkdir(join(source, 'learnings', 'google', 'notes'), { recursive: true })
      await writeFile(join(source, 'learnings/google/manifest.json'), JSON.stringify({ id: 'google', name: 'Google', domains: ['google.com'], notes: ['notes/overview.md'] }))
      await writeFile(join(source, 'learnings/google/notes/overview.md'), 'Search results live in div.g\n')

      const memory = new Memory(join(dir, 'ws'))
      const first = await memory.seed([source])
      expect(first.seeded).toBe(true)
      expect(first.sites).toEqual(['google'])
      expect((await memory.recall('www.google.com')).known).toBe(false)
      expect((await memory.recall('google.com')).known).toBe(true)

      // Deleting a seeded site must stay deleted across restarts.
      await memory.forget('google')
      const second = await memory.seed([source])
      expect(second.seeded).toBe(false)
      expect(await memory.listSiteIds()).toEqual([])
    })
  })

  it('says so plainly when there is nothing to inherit', async () => {
    await withTempDir(async (dir) => {
      const memory = new Memory(join(dir, 'ws'))
      const result = await memory.seed([join(dir, 'nope')])
      expect(result.seeded).toBe(false)
      expect(result.reason).toMatch(/no ego workspace/)
    })
  })

  it('never seeds over a store that already holds sites', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'skill')
      await mkdir(join(source, 'learnings', 'google'), { recursive: true })
      await writeFile(join(source, 'learnings/google/manifest.json'), JSON.stringify({ id: 'google', name: 'Google', domains: ['google.com'] }))
      const memory = new Memory(join(dir, 'ws'))
      await memory.learn(goodSpec())
      const result = await memory.seed([source])
      expect(result.seeded).toBe(false)
      expect(await memory.listSiteIds()).toEqual(['github'])
    })
  })
})
