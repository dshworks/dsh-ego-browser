import { describe, expect, it } from 'vitest'
import { Ego, classify, wrapScript } from '../lib/ego.js'
import { fixture, makeConfig, makeSubprocess } from './harness.mjs'

/**
 * Build an Ego over one CLI fixture.
 * @param {string} name - fixture basename.
 * @param {object} [overrides] - config overrides.
 * @returns {{ego: Ego, subprocess: object}} the pair.
 */
function makeEgo(name, overrides = {}) {
  const subprocess = makeSubprocess()
  const config = makeConfig(fixture(name), overrides)
  return { ego: new Ego({ subprocess, config, workspace: '/tmp/ws' }), subprocess }
}

describe('argv probe', () => {
  it('runs bare against the current CLI, which rejects any argument', async () => {
    const { ego, subprocess } = makeEgo('ego-v2')
    expect(await ego.probeArgv()).toEqual([])
    expect(subprocess.calls).toHaveLength(1)
  })

  it('falls back to the documented `nodejs` prefix when bare is refused', async () => {
    const { ego, subprocess } = makeEgo('ego-v1')
    expect(await ego.probeArgv()).toEqual(['nodejs'])
    // Bare first, then the prefix: two spawns, and the second is the one that ran.
    expect(subprocess.calls.map(call => call.argv.slice(1))).toEqual([[], ['nodejs']])
  })

  it('caches the answer instead of re-probing every run', async () => {
    const { ego, subprocess } = makeEgo('ego-v1')
    await ego.probeArgv()
    await ego.probeArgv()
    expect(subprocess.calls).toHaveLength(2)
  })

  it('reports both attempts when neither shape runs a script', async () => {
    const { ego } = makeEgo('ego-absent')
    await expect(ego.probeArgv()).rejects.toThrow(/did not run a script in either argv shape/)
  })

  it('re-probes after reset', async () => {
    const { ego, subprocess } = makeEgo('ego-v2')
    await ego.probeArgv()
    ego.reset()
    await ego.probeArgv()
    expect(subprocess.calls).toHaveLength(2)
  })
})

describe('surface probe', () => {
  it('recognises the flat-global generation', async () => {
    const { ego } = makeEgo('ego-v1')
    const surface = await ego.probeSurface()
    expect(surface.generation).toBe('flat')
    expect(surface.globals).toContain('cliLog')
    expect(surface.globals).toContain('snapshotText')
    expect(surface.globals).not.toContain('page')
  })

  it('recognises the facade generation', async () => {
    const { ego } = makeEgo('ego-v2')
    const surface = await ego.probeSurface()
    expect(surface.generation).toBe('facade')
    expect(surface.globals).toEqual(expect.arrayContaining(['page', 'browser', 'taskSpaces', 'site']))
    expect(surface.globals).not.toContain('cliLog')
  })
})

describe('running a script', () => {
  it('returns the script output and a clean verdict', async () => {
    const { ego } = makeEgo('ego-v2')
    const run = await ego.run('console.log(JSON.stringify(await page.info()))')
    expect(run.ok).toBe(true)
    expect(run.sentinel).toBe(true)
    expect(JSON.parse(run.output).url).toBe('https://example.com/')
    expect(run.output).not.toContain('@@DSH_EGO@@')
  })

  it('uses whichever output channel the generation provides', async () => {
    const { ego } = makeEgo('ego-v1')
    const run = await ego.run('cliLog(await snapshotText())')
    expect(run.ok).toBe(true)
    expect(run.output).toContain('Example Domain')
  })

  it('reports a thrown error without losing what the script printed first', async () => {
    const { ego } = makeEgo('ego-v2')
    const run = await ego.run('console.log("got this far")\nthrow new Error("selector missing")')
    expect(run.ok).toBe(false)
    expect(run.error).toContain('selector missing')
    expect(run.output).toContain('got this far')
  })

  it('still reports a verdict when the script returns early', async () => {
    const { ego } = makeEgo('ego-v2')
    const run = await ego.run('console.log("before")\nreturn')
    expect(run.ok).toBe(true)
    expect(run.output).toBe('before')
  })

  it('names a user takeover as a hard stop rather than a missing result', async () => {
    // The real sink discards every buffered line on a hard stop, so the
    // sentinel never arrives. Its absence must not read as a parse failure.
    const { ego } = makeEgo('ego-v2', { env: { EGO_FIXTURE_HARDSTOP: '1' } })
    const run = await ego.run('await taskSpaces.useOrCreate("x")\nconsole.log("never printed")')
    expect(run.hardStop).toBe(true)
    expect(run.sentinel).toBe(false)
    expect(run.ok).toBe(false)
    expect(run.error).toMatch(/taken control/)
    expect(run.error).toMatch(/ego_handoff/)
  })

  it('points the runtime at the plugin store', async () => {
    const { ego, subprocess } = makeEgo('ego-v2')
    await ego.run('console.log(1)')
    expect(subprocess.calls.at(-1).env.EGO_BROWSER_AGENT_WORKSPACE).toBe('/tmp/ws')
  })

  it('aborts a script that outruns its timeout', async () => {
    const { ego } = makeEgo('ego-v2', { timeoutMs: 1200, probeTimeoutMs: 20_000 })
    await ego.probeArgv()
    const run = await ego.run('await new Promise(resolve => setTimeout(resolve, 30000))')
    expect(run.ok).toBe(false)
  })
})

describe('classify', () => {
  it('keeps output verbatim apart from the verdict line', () => {
    const result = classify(`one\ntwo\n@@DSH_EGO@@ {"ok":true}\n`, '')
    expect(result.output).toBe('one\ntwo')
    expect(result.ok).toBe(true)
  })

  it('falls back to stderr when the runtime died before reporting', () => {
    const result = classify('', 'SyntaxError: Unexpected token\n')
    expect(result.ok).toBe(false)
    expect(result.sentinel).toBe(false)
    expect(result.error).toContain('SyntaxError')
  })
})

describe('wrapScript', () => {
  it('reports through finally, so a top-level return cannot skip the verdict', () => {
    expect(wrapScript('return 1')).toContain('} catch (e) { __egoErr = e } finally {')
  })
})
