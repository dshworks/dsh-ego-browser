import { describe, expect, it, vi } from 'vitest'
import { Config, apply } from '../lib/index.js'
import { checkReadRequest } from '../lib/trust.js'
import { fixture, makeSubprocess, withTempDir } from './harness.mjs'

/**
 * A cordis-shaped context carrying only what this plugin touches.
 * @param {object} services - `subprocess`, and optionally `tools` / `webServer`.
 * @returns {object} the context, with the registered tools and routes exposed.
 */
function makeCtx(services) {
  const tools = new Map()
  const routes = []
  const logs = []
  const ctx = {
    subprocess: services.subprocess,
    logger: { info: line => logs.push(['info', line]), warn: line => logs.push(['warn', line]) },
    tools: services.tools === false ? undefined : { register: tool => tools.set(tool.name, tool) },
    webServer: services.webServer === false ? undefined : { register: route => routes.push(route) },
    get: name => ctx[name],
    effect: run => run(),
    inject: (names, run) => {
      if (names.every(name => ctx[name] !== undefined)) run(ctx)
    },
    userQuestions: services.userQuestions,
    tooling: tools,
    routes,
    logs,
  }
  return ctx
}

/** The exec object a tool receives. */
const exec = { signal: undefined, agent: { session: { id: 's1' } } }

/**
 * Load the plugin over one CLI fixture and a throwaway store.
 * @param {string} dir - the workspace directory.
 * @param {object} [options] - `bin` fixture name and context service overrides.
 * @returns {object} the context, after apply.
 */
function load(dir, options = {}) {
  const ctx = makeCtx({ subprocess: makeSubprocess(), ...options.services })
  apply(ctx, new Config({ bin: fixture(options.bin ?? 'ego-v2'), workspace: dir, seed: false, probeTimeoutMs: 20_000, timeoutMs: 20_000 }))
  return ctx
}

describe('loading', () => {
  it('registers exactly the seven tools', async () => {
    await withTempDir(async (dir) => {
      const ctx = load(dir)
      expect([...ctx.tooling.keys()].sort()).toEqual([
        'ego_doctor', 'ego_forget', 'ego_handoff', 'ego_learn', 'ego_recall', 'ego_run', 'ego_site_run',
      ])
    })
  })

  it('mounts the memory route once', async () => {
    await withTempDir(async (dir) => {
      const ctx = load(dir)
      expect(ctx.routes.map(route => route.path)).toEqual(['/dsh-ego-browser/memory'])
    })
  })

  it('loads without a web server, and simply has no route', async () => {
    await withTempDir(async (dir) => {
      const ctx = load(dir, { services: { webServer: false } })
      expect(ctx.routes).toEqual([])
      expect(ctx.tooling.size).toBe(7)
    })
  })

  it('loads without the tools service, and simply has no tools', async () => {
    await withTempDir(async (dir) => {
      const ctx = load(dir, { services: { tools: false } })
      expect(ctx.routes).toHaveLength(1)
    })
  })

  it('refuses a trustedHosts entry that is not a bare authority', async () => {
    await withTempDir(async (dir) => {
      const ctx = makeCtx({ subprocess: makeSubprocess() })
      expect(() => apply(ctx, new Config({ workspace: dir, trustedHosts: ['user@evil.example'] })))
        .toThrow(/not a bare host/)
    })
  })
})

describe('ego_doctor', () => {
  it('reports the argv shape, the surface, and the guide for it', async () => {
    await withTempDir(async (dir) => {
      const ctx = load(dir)
      const result = await ctx.tooling.get('ego_doctor').execute({}, exec)
      expect(result.argv).toMatch(/ego-v2\.mjs <<'JS'$/)
      expect(result.surface).toMatch(/facades/)
      expect(result.guide).toMatch(/console\.log/)
      expect(result.guide).not.toMatch(/Output goes through `cliLog/)
      expect(result.workspace).toBe(dir)
      expect(result.problems).toEqual([])
    })
  })

  it('reports the other generation guide against the other CLI', async () => {
    await withTempDir(async (dir) => {
      const ctx = load(dir, { bin: 'ego-v1' })
      const result = await ctx.tooling.get('ego_doctor').execute({}, exec)
      expect(result.argv).toMatch(/nodejs <<'JS'$/)
      expect(result.guide).toMatch(/cliLog/)
      expect(result.guide).toMatch(/snapshotText/)
    })
  })
})

describe('ego_run', () => {
  it('runs a script and returns what it printed', async () => {
    await withTempDir(async (dir) => {
      const ctx = load(dir)
      const result = await ctx.tooling.get('ego_run').execute({ script: 'console.log(await page.snapshot())' }, exec)
      expect(result.ok).toBe(true)
      expect(result.output).toContain('Example Domain')
    })
  })

  it('opens the named task space before the script, in the right dialect', async () => {
    await withTempDir(async (dir) => {
      const ctx = load(dir)
      const result = await ctx.tooling.get('ego_run').execute({ script: 'console.log("ran")', taskSpace: 'collect notes' }, exec)
      expect(result.ok).toBe(true)
      expect(ctx.subprocess.calls.at(-1).stdin.data).toContain('await taskSpaces.useOrCreate("collect notes")')
    })
  })

  it('uses the flat dialect against the older runtime', async () => {
    await withTempDir(async (dir) => {
      const ctx = load(dir, { bin: 'ego-v1' })
      await ctx.tooling.get('ego_run').execute({ script: 'cliLog("ran")', taskSpace: 'collect notes' }, exec)
      expect(ctx.subprocess.calls.at(-1).stdin.data).toContain('await useOrCreateTaskSpace("collect notes")')
    })
  })

  it('prepends what was already learned when a url is given', async () => {
    await withTempDir(async (dir) => {
      const ctx = load(dir)
      await ctx.tooling.get('ego_learn').execute({
        site: 'example',
        domains: ['example.com'],
        tool: 'read_title',
        description: 'Read the page title.',
        callable: 'readTitle',
        code: 'export async function readTitle(ctx) { return ctx.page.locator("h1").innerText() }',
        returns: { type: 'string', description: 'The title.' },
        note: 'The heading is an h1, always present.',
      }, exec)
      const result = await ctx.tooling.get('ego_run').execute({ script: 'console.log(1)', url: 'https://example.com/x' }, exec)
      expect(result.learned).toMatch(/read_title/)
      expect(result.learned).toMatch(/The heading is an h1/)
      expect(result.learned).toMatch(/site\.runTool\("example", "read_title"/)
    })
  })

  it('says nothing about learning when nothing is known', async () => {
    await withTempDir(async (dir) => {
      const ctx = load(dir)
      const result = await ctx.tooling.get('ego_run').execute({ script: 'console.log(1)', url: 'https://nowhere.test' }, exec)
      expect(result.learned).toBeUndefined()
    })
  })
})

describe('ego_learn', () => {
  it('refuses source that does not parse, before writing anything', async () => {
    await withTempDir(async (dir) => {
      const ctx = load(dir)
      await expect(ctx.tooling.get('ego_learn').execute({
        site: 'example',
        domains: ['example.com'],
        tool: 'broken',
        description: 'Broken on purpose.',
        callable: 'broken',
        code: 'export async function broken(ctx) { return ctx.page.locator("h1"',
        returns: { type: 'string', description: 'x' },
      }, exec)).rejects.toThrow(/does not parse/)
      expect(await ctx.tooling.get('ego_doctor').execute({}, exec).then(result => result.sites)).toEqual([])
    })
  })
})

describe('ego_site_run', () => {
  it('calls the learned tool and counts the call', async () => {
    await withTempDir(async (dir) => {
      const ctx = load(dir)
      await ctx.tooling.get('ego_learn').execute({
        site: 'example',
        domains: ['example.com'],
        tool: 'read_title',
        description: 'Read the page title.',
        callable: 'readTitle',
        code: 'export async function readTitle(ctx) { return "x" }',
        returns: { type: 'string', description: 'The title.' },
      }, exec)
      const result = await ctx.tooling.get('ego_site_run').execute({ site: 'example', tool: 'read_title' }, exec)
      expect(result.ok).toBe(true)
      expect(result.value).toMatchObject({ siteId: 'example', toolName: 'read_title', ran: 'node' })
      const recalled = await ctx.tooling.get('ego_recall').execute({ url: 'example.com' }, exec)
      expect(recalled.sites[0].tools[0].runs).toBe(1)
    })
  })
})

describe('ego_handoff', () => {
  it('asks the user, and takes control back on Continue', async () => {
    await withTempDir(async (dir) => {
      const ask = vi.fn(async () => ({ answers: [{ id: 'ego-handoff', selected: ['Continue'] }] }))
      const ctx = load(dir, { services: { userQuestions: { ask } } })
      const result = await ctx.tooling.get('ego_handoff').execute({ taskSpace: 'buy tickets', reason: 'Log in, please.' }, exec)
      expect(result.resumed).toBe(true)
      expect(ask.mock.calls[0][0].questions[0].options.map(option => option.label)).toEqual(['Continue', 'Finish task'])
      const scripts = ctx.subprocess.calls.map(call => call.stdin.data ?? '')
      expect(scripts.some(script => script.includes('taskSpaces.handOff'))).toBe(true)
      expect(scripts.some(script => script.includes('taskSpaces.takeOver'))).toBe(true)
    })
  })

  it('closes the task out on Finish, leaving the page up', async () => {
    await withTempDir(async (dir) => {
      const ask = vi.fn(async () => ({ answers: [{ id: 'ego-handoff', selected: ['Finish task'] }] }))
      const ctx = load(dir, { services: { userQuestions: { ask } } })
      const result = await ctx.tooling.get('ego_handoff').execute({ taskSpace: 'buy tickets', reason: 'Log in, please.' }, exec)
      expect(result.resumed).toBe(false)
      expect(ctx.subprocess.calls.at(-1).stdin.data).toContain('{ keep: true }')
    })
  })

  it('says so plainly when the deployment cannot ask anyone', async () => {
    await withTempDir(async (dir) => {
      const ctx = load(dir)
      const result = await ctx.tooling.get('ego_handoff').execute({ taskSpace: 'buy tickets', reason: 'Log in.' }, exec)
      expect(result.resumed).toBe(false)
      expect(result.note).toMatch(/nobody could be asked/)
    })
  })

  it('reports rather than throws when the caller is a subagent', async () => {
    await withTempDir(async (dir) => {
      const ask = vi.fn(async () => {
        const error = new Error('human interaction is unavailable while the calling agent is owned by another live agent')
        error.code = 'DELEGATED_CALLER'
        throw error
      })
      const ctx = load(dir, { services: { userQuestions: { ask } } })
      const result = await ctx.tooling.get('ego_handoff').execute({ taskSpace: 'buy tickets', reason: 'Log in.' }, exec)
      expect(result.resumed).toBe(false)
      expect(result.note).toMatch(/subagent/)
    })
  })

  it('does not swallow an unexpected failure from the ask', async () => {
    await withTempDir(async (dir) => {
      const ask = vi.fn(async () => { throw new Error('the UI fell over') })
      const ctx = load(dir, { services: { userQuestions: { ask } } })
      await expect(ctx.tooling.get('ego_handoff').execute({ taskSpace: 'x', reason: 'Log in.' }, exec))
        .rejects.toThrow(/the UI fell over/)
    })
  })

  it('takes a typed answer as a refusal unless it is Continue', async () => {
    await withTempDir(async (dir) => {
      const ask = vi.fn(async () => ({ answers: [{ id: 'ego-handoff', selected: [], custom: 'not now' }] }))
      const ctx = load(dir, { services: { userQuestions: { ask } } })
      const result = await ctx.tooling.get('ego_handoff').execute({ taskSpace: 'x', reason: 'Log in.' }, exec)
      expect(result.resumed).toBe(false)
      expect(result.answer).toBe('not now')
    })
  })
})

describe('the memory route', () => {
  /** A request the fence should judge. */
  const request = headers => ({ method: 'GET', headers })

  it('answers the dsh UI on this machine', () => {
    expect(checkReadRequest(request({ host: '127.0.0.1:8090' }), [])).toBe(true)
    expect(checkReadRequest(request({ host: 'localhost:8090', origin: 'http://localhost:8090', 'sec-fetch-site': 'same-origin' }), [])).toBe(true)
  })

  it('refuses a rebound host and a cross-site read', () => {
    expect(checkReadRequest(request({ host: 'evil.example' }), [])).toBe(false)
    expect(checkReadRequest(request({ host: 'localhost:8090', 'sec-fetch-site': 'cross-site' }), [])).toBe(false)
    expect(checkReadRequest(request({ host: 'localhost:8090', origin: 'http://evil.example' }), [])).toBe(false)
  })

  it('answers an authority the operator declared', () => {
    expect(checkReadRequest(request({ host: 'box.lan:8090' }), ['box.lan:8090'])).toBe(true)
    expect(checkReadRequest(request({ host: 'box.lan:9999' }), ['box.lan:8090'])).toBe(false)
  })

  it('serves the store as JSON', async () => {
    await withTempDir(async (dir) => {
      const ctx = load(dir)
      await ctx.tooling.get('ego_learn').execute({
        site: 'example',
        domains: ['example.com'],
        tool: 'read_title',
        description: 'Read the page title.',
        callable: 'readTitle',
        code: 'export async function readTitle(ctx) { return "x" }',
        returns: { type: 'string', description: 'The title.' },
      }, exec)
      let status = 0
      let body = ''
      const res = {
        writeHead(code) { status = code; return res },
        end(text) { body = text ?? '' },
      }
      await ctx.routes[0].handler({ method: 'GET', headers: { host: '127.0.0.1:8090' } }, res)
      expect(status).toBe(200)
      const parsed = JSON.parse(body)
      expect(parsed.sites[0].id).toBe('example')
      expect(parsed.problems).toEqual([])
    })
  })

  it('refuses a write to a read-only route', async () => {
    await withTempDir(async (dir) => {
      const ctx = load(dir)
      let status = 0
      const res = { writeHead(code) { status = code; return res }, end() {} }
      await ctx.routes[0].handler({ method: 'POST', headers: { host: '127.0.0.1' } }, res)
      expect(status).toBe(405)
    })
  })
})
