/**
 * Test doubles that stay faithful on the seams the plugin actually depends on.
 *
 * The subprocess double really spawns a real Node process with a real stdin
 * write and real collected output, because everything interesting about this
 * plugin lives in that contract — argv shape, stdin heredoc, buffered stdout,
 * exit code. A double that resolved a canned string would test nothing.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Absolute path to one of the ego CLI fixtures. */
export function fixture(name) {
  return join(HERE, '..', 'fixtures', `${name}.mjs`)
}

/**
 * A subprocess service matching `@deepseek-ai/dsh-subprocess`'s spawn contract.
 * @returns {{spawn: Function, calls: object[]}} the service and a log of every spawn.
 */
export function makeSubprocess() {
  const calls = []
  return {
    calls,
    spawn(spec) {
      calls.push({ argv: [...spec.argv], env: spec.env, stdin: spec.stdio.stdin })
      const child = spawn(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let out = ''
      let err = ''
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', chunk => { out += chunk })
      child.stderr.on('data', chunk => { err += chunk })
      if (typeof spec.stdio.stdin === 'object' && spec.stdio.stdin !== null) {
        child.stdin.end(spec.stdio.stdin.data)
      } else {
        child.stdin.end()
      }
      const onAbort = () => child.kill('SIGKILL')
      spec.signal?.addEventListener('abort', onAbort, { once: true })
      const done = new Promise((resolve) => {
        child.on('close', (exitCode, signal) => {
          spec.signal?.removeEventListener('abort', onAbort)
          resolve({ exitCode, signal })
        })
      })
      return {
        pid: child.pid ?? -1,
        done,
        collected: {
          stdout: { readFrom: () => ({ text: out, nextOffset: out.length, lossy: false }) },
          stderr: { readFrom: () => ({ text: err, nextOffset: err.length, lossy: false }) },
        },
        terminate: () => child.kill('SIGTERM'),
        waitForExit: async () => true,
      }
    },
  }
}

/** Everything `Ego` reads out of its config, with test-sized limits. */
export function makeConfig(bin, overrides = {}) {
  return {
    bin,
    extraArgs: [],
    cwd: process.cwd(),
    env: {},
    timeoutMs: 20_000,
    probeTimeoutMs: 20_000,
    maxOutputBytes: 1_048_576,
    graceMs: 1000,
    ...overrides,
  }
}

/**
 * A throwaway directory, removed when the callback returns.
 * @param {(dir: string) => Promise<unknown>} body - the work to run inside it.
 */
export async function withTempDir(body) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ego-test-'))
  try {
    return await body(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
