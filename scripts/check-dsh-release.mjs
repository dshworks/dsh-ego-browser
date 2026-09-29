// Does this plugin install through dsh's own plugin path, and leave the host's
// harness alone?
//
// What users run is `dsh plugin --profile <p> add <spec>`. It runs pnpm inside
// $DSH_HOME/profiles/<p> with `nodeLinker: hoisted` and `autoInstallPeers: false`
// (packages/boot/app-boot/src/profile.ts), and at run time dsh redirects every
// harness import that is not physically present in the profile to the HOST's own
// copy (packages/boot/app-boot/src/profile-resolution/resolver.ts). Peers are
// never installed into the profile; the running dsh supplies them. So two things
// decide whether a release breaks this plugin, and this script checks both on
// that path, against a real dsh installed from npm:
//
// 1. The gate. From dsh 0.1.7-rc.1, every peer named `@deepseek-ai/dsh` or
//    `@deepseek-ai/dsh-*` is checked against the running version with
//    `semver.satisfies(runtime, range, { includePrerelease: true })`
//    (packages/boot/app-boot/src/plugin-compatibility.ts) before and after the
//    pnpm install, at profile startup, and in the plugin manager. A range that
//    does not admit the host makes `add` exit non-zero and rolls the install
//    back; at boot the plugin is skipped with one stderr line.
// 2. Shadowing. A host-supplied package listed in `dependencies` IS installed
//    into the profile, hoisted, and then shadows the host's copy for every plugin
//    in that profile. So after `add`, the profile's node_modules must hold no
//    `@deepseek-ai/*` package that the host installation also supplies.
//
// What this used to check, and why that was wrong: one fresh npm tree holding
// the host and the plugin together, asserting one version of every harness
// package. npm installs peers itself and resolves them with strict semver, so it
// reported 10-29 "split" packages on every dsh release, on a path no user takes;
// on the real path the count was zero. It also taught "never OR in the next
// line", which does not hold here: nothing installs peers, and the gate admits
// any range that covers the host.
//
// `--tree-only` checks what this branch would publish (a pull request). The
// default also checks the published package, because a fix that never reached
// npm is not a fix. Both must pass against dsh `latest` (or DSH_VERSION). A dsh
// on the `next` tag, ahead of `latest`, is checked too but only reported.
//
// Needs pnpm on PATH, as `dsh plugin` itself does. Exit 0 clean, 1 drift,
// 2 could not check.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PR_ONLY = process.argv.includes('--tree-only')
const ROOT = new URL('..', import.meta.url).pathname
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const PROFILE = 'web'
const report = []
let failed = false

const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })

/** Stop with "could not check": a check that cannot run must not read as clean. */
function giveUp(why) {
  console.log([...report, `\ncould not check: ${why}`].join('\n'))
  process.exit(2)
}

/**
 * Every `@deepseek-ai/*` package physically present under a node_modules tree,
 * nested copies included. Dot directories (`.pnpm`, `.bin`) are not resolvable
 * from a plugin's own imports, so they are skipped.
 * @param {string} nodeModules - the directory to walk.
 * @returns {Set<string>} package names such as `@deepseek-ai/schemastery`.
 */
function harnessPackages(nodeModules) {
  const found = new Set()
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const packages = entry.name.startsWith('@')
        ? readdirSync(join(dir, entry.name), { withFileTypes: true })
          .filter(child => child.isDirectory())
          .map(child => [`${entry.name}/${child.name}`, join(dir, entry.name, child.name)])
        : [[entry.name, join(dir, entry.name)]]
      for (const [name, path] of packages) {
        if (name.startsWith('@deepseek-ai/')) found.add(name)
        walk(join(path, 'node_modules'))
      }
    }
  }
  walk(nodeModules)
  return found
}

/**
 * Install one dsh from npm into a scratch directory, the way a user gets it.
 * @param {string} version - the exact dsh version.
 * @returns {{bin: string, supplied: Set<string>}} its CLI and every harness package it ships.
 * @throws {Error} when npm cannot install it.
 */
function installHost(version) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-host-'))
  try {
    run('npm', ['init', '-y'], { cwd: dir })
    run('npm', ['install', '--no-audit', '--no-fund', `@deepseek-ai/dsh@${version}`], { cwd: dir })
  } catch (error) {
    const line = String(error.stderr ?? '').split('\n').find(text => /npm error/.test(text))
    throw new Error(`npm could not install @deepseek-ai/dsh@${version}: ${line ?? error.message}`)
  }
  return { bin: join(dir, 'node_modules', '.bin', 'dsh'), supplied: harnessPackages(join(dir, 'node_modules')) }
}

/**
 * `dsh plugin add` one spec into a fresh DSH_HOME, then assert the gate let it
 * in and nothing it brought shadows the host.
 * @param {{bin: string, supplied: Set<string>}} host - from `installHost`.
 * @param {string} spec - what to add: a tarball path or `name@tag`.
 * @param {string} label - how the report names this check.
 * @param {boolean} [advisory] - report without failing.
 */
function check(host, spec, label, advisory = false) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
  const profile = join(home, 'profiles', PROFILE)
  try {
    run(host.bin, ['plugin', '--profile', PROFILE, 'add', '-w', spec], { cwd: home, env: { ...process.env, DSH_HOME: home } })
  } catch (error) {
    failed = failed || !advisory
    const lines = `${error.stdout ?? ''}${error.stderr ?? ''}`.split('\n')
    const why = lines.filter(line => /incompatible|allow-version|dsh:|ERR_PNPM|error/i.test(line)).slice(0, 8)
    report.push(`- FAIL  ${label} — \`dsh plugin add\` exited ${error.status ?? '?'}\n\n\`\`\`\n${(why.length > 0 ? why : lines.slice(-8)).join('\n')}\n\`\`\`\n`)
    return
  }
  const installed = join(profile, 'node_modules', ...pkg.name.split('/'), 'package.json')
  if (!existsSync(installed)) {
    failed = failed || !advisory
    report.push(`- FAIL  ${label} — \`dsh plugin add\` exited 0 but ${pkg.name} is not in the profile`)
    return
  }
  const version = JSON.parse(readFileSync(installed, 'utf8')).version
  const shadows = [...harnessPackages(join(profile, 'node_modules'))].filter(name => host.supplied.has(name)).sort()
  if (shadows.length > 0) {
    failed = failed || !advisory
    report.push(
      `- FAIL  ${label} — the gate admitted ${pkg.name}@${version}, but the profile now holds its own copy of`
      + ` packages the host supplies, which shadow the host for every plugin in the profile:\n\n\`\`\`\n${shadows.join('\n')}\n\`\`\`\n`
      + `\nMove them from \`dependencies\` to \`peerDependencies\` (and \`devDependencies\` for tests).\n`,
    )
    return
  }
  report.push(`- ok    ${label} — the gate admitted ${pkg.name}@${version}; the profile shadows none of the host's ${host.supplied.size} harness packages`)
}

try {
  run('pnpm', ['--version'])
} catch {
  giveUp('pnpm is not on PATH, and `dsh plugin` runs pnpm')
}

let tags
try {
  tags = JSON.parse(run('npm', ['view', '@deepseek-ai/dsh', 'dist-tags', '--json'], { cwd: ROOT }))
} catch (error) {
  giveUp(`could not read dsh dist-tags: ${error.message}`)
}
const target = process.env.DSH_VERSION?.trim() || tags.latest
report.push(`dsh ${process.env.DSH_VERSION ? 'DSH_VERSION' : '`latest` on npm'}: **${target}**\n`)

// Into a temp dir, not the repo root. `npm pack` leaves the tarball where you
// point it, and a stray .tgz beside package.json is one `git add -A` away from
// being committed — which is how these sweeps stage everything.
let tarball
const packDir = mkdtempSync(join(tmpdir(), 'dsh-release-pack-'))
try {
  tarball = join(packDir, run('npm', ['pack', '--silent', '--ignore-scripts', '--pack-destination', packDir], { cwd: ROOT }).trim().split('\n').pop())
} catch (error) {
  giveUp(`could not pack this tree: ${error.message}`)
}

let host
try {
  host = installHost(target)
} catch (error) {
  giveUp(error.message)
}
check(host, tarball, `this tree into a dsh ${target} profile`)
const treeFailed = failed

// On a pull request only THIS TREE can be green: the published package is by
// definition still the old one on the very PR that fixes it, and a check that
// is red on its own fix is a check people switch off.
if (!PR_ONLY) {
  check(host, `${pkg.name}@latest`, `published ${pkg.name}@latest into a dsh ${target} profile`)

  // Ahead of the tag, reported only: nobody installs `next` by default, and a
  // red check nobody can clear gets switched off. It buys the warning early.
  if (tags.next && tags.next !== target) {
    report.push(`\nnpm also serves **${tags.next}** on \`next\`, ahead of \`latest\`:\n`)
    try {
      check(installHost(tags.next), tarball, `this tree into a dsh ${tags.next} profile (advisory)`, true)
    } catch (error) {
      report.push(`- skip  dsh ${tags.next} (advisory) — ${error.message}`)
    }
  }
}

console.log(report.join('\n'))
process.exit((PR_ONLY ? treeFailed : failed) ? 1 : 0)
