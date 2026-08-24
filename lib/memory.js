/**
 * The memory: a site-skill store the agent writes to and reads back.
 *
 * ego lite already knows how to load learned site skills — `site.learnContext`,
 * `site.runTool`, and `site.runBrowserTool` read a `learnings/` directory under
 * whatever `EGO_BROWSER_AGENT_WORKSPACE` points at. What ego ships is the
 * reader and two examples; ego's own README lists the writer as "coming soon".
 * This module is the writer, and the store it fills is ego's format exactly —
 * so anything learned here also loads in the stock `ego-browser` skill outside
 * dsh, and nothing here is a private lock-in format.
 *
 * The format is small and strict, and the strictness is the point:
 *
 *   learnings/<site-id>/manifest.json     id, name, domains, notes, tools
 *   learnings/<site-id>/notes/*.md        what the agent figured out in prose
 *   learnings/<site-id>/tools/*.js        Node-side tool: (ctx, args) => result
 *   learnings/<site-id>/browser-tools/*.js  page-side tool, evaluated in the tab
 *
 * The rule that earns the store its keep is the temporary-ref ban, mirrored from
 * ego's own validator: a tool or note containing `@21` or `ref=21` is rejected.
 * Snapshot refs are rebuilt on every `snapshotText()` call, so a script full of
 * them is exactly the thing that will not work tomorrow. Refusing to store it
 * forces the promotion step to re-express the discovery as a stable locator,
 * which is the difference between a memory and a pile of dead selectors.
 */
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/** Value types ego's manifest schema accepts for an argument or a return. */
const VALUE_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object'])

/** Snapshot refs, which are valid for exactly one `snapshotText()` call. */
const TEMP_REF = /(?:@\d+\b|\bref=\d+\b)/

/** Where per-tool usage counts live — outside `learnings/`, which is ego's. */
const META_DIR = '.dsh-ego'

/**
 * Where a plugin-owned agent workspace lives when the operator names none.
 * @returns {string} an absolute directory path.
 */
export function defaultWorkspace() {
  return join(homedir(), '.dsh', 'ego-browser', 'workspace')
}

/**
 * Directories a first run may inherit already-learned sites from.
 *
 * ego installs its skill (with the `learnings/` it ships) into every agent's
 * skills directory. Copying those in once means the store starts with what ego
 * knows rather than empty, and the copy — rather than a symlink or a read
 * through — keeps the agent's later edits out of the installed skill.
 * @returns {string[]} candidate workspace directories, best first.
 */
export function seedCandidates() {
  const explicit = process.env.EGO_BROWSER_AGENT_WORKSPACE
  const home = homedir()
  return [
    ...(explicit ? [explicit] : []),
    join(home, '.dsh', 'skills', 'ego-browser'),
    join(home, '.claude', 'skills', 'ego-browser'),
    join(home, '.codex', 'skills', 'ego-browser'),
    join(home, '.config', 'skills', 'ego-browser'),
  ]
}

/**
 * The hostname a URL or bare domain resolves to, matching ego's own parsing.
 * @param {string} url - a URL or hostname.
 * @returns {string} the lowercased hostname, or '' when unparseable.
 */
export function hostnameOf(url) {
  try {
    const text = String(url)
    const parsed = text.includes('://') ? new URL(text) : new URL(`https://${text}`)
    return (parsed.hostname || '').toLowerCase().replace(/\.$/, '')
  } catch {
    return ''
  }
}

/**
 * Whether a hostname is covered by one manifest domain pattern.
 * @param {string} hostname - the lowercased hostname.
 * @param {string} pattern - an exact domain or a leading `*.` wildcard.
 * @returns {boolean} whether the pattern covers the hostname.
 */
export function domainMatches(hostname, pattern) {
  const normalized = String(pattern || '').toLowerCase().replace(/\.$/, '')
  if (normalized.startsWith('*.')) return hostname.endsWith(`.${normalized.slice(2)}`)
  return hostname === normalized
}

/**
 * Whether a domain pattern is one ego will accept.
 * @param {unknown} pattern - the candidate pattern.
 * @returns {boolean} whether it is storable.
 */
export function isValidDomain(pattern) {
  if (typeof pattern !== 'string' || pattern === '') return false
  if (pattern.includes('://') || pattern.includes('/') || pattern.startsWith('.') || pattern.endsWith('.')) return false
  if (pattern.includes('*')) {
    return pattern.startsWith('*.') && pattern.indexOf('*') === pattern.lastIndexOf('*') && pattern.length > 2
  }
  return true
}

/**
 * Whether a name is safe as a directory or tool key.
 * @param {unknown} name - the candidate identifier.
 * @returns {boolean} whether it is storable.
 */
export function isSafeName(name) {
  return typeof name === 'string'
    && /^[a-z0-9][a-z0-9._-]*$/i.test(name)
    && !name.includes('..')
}

/** One learned store rooted at an agent workspace directory. */
export class Memory {
  /**
   * @param {string} workspace - absolute path to the agent workspace.
   */
  constructor(workspace) {
    this.workspace = resolve(workspace)
    this.root = join(this.workspace, 'learnings')
    this.metaDir = join(this.workspace, META_DIR)
    /**
     * Resolves once the store exists and any one-time seeding is done. Public
     * reads and writes wait on it so a tool call that lands during boot sees a
     * seeded store rather than an empty one. Set by the plugin at load.
     * @type {Promise<unknown>}
     */
    this.ready = Promise.resolve()
  }

  /** Create the store's directories if they are not there yet. */
  async ensure() {
    await mkdir(this.root, { recursive: true })
    await mkdir(this.metaDir, { recursive: true })
  }

  /**
   * Copy an existing ego workspace's learned sites in, once, when ours is empty.
   *
   * Skipped entirely once the store holds anything, so an operator who deletes a
   * seeded site does not get it back on the next boot.
   * @param {string[]} candidates - directories to look for `learnings/` in.
   * @returns {Promise<{seeded: boolean, from?: string, sites?: string[], reason?: string}>} what happened.
   */
  async seed(candidates) {
    await this.ensure()
    const receiptPath = join(this.metaDir, 'seed.json')
    if (existsSync(receiptPath)) {
      return { seeded: false, reason: 'already seeded', ...JSON.parse(await readFile(receiptPath, 'utf8')) }
    }
    if ((await this.listSiteIds()).length > 0) {
      await writeFile(receiptPath, JSON.stringify({ from: null, sites: [], note: 'store was not empty' }, null, 2))
      return { seeded: false, reason: 'store already holds sites' }
    }
    for (const candidate of candidates) {
      if (candidate === '' || resolve(candidate) === this.workspace) continue
      const source = join(candidate, 'learnings')
      if (!existsSync(source)) continue
      const names = (await readdir(source, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.'))
        .map(entry => entry.name)
      if (names.length === 0) continue
      for (const name of names) {
        await cp(join(source, name), join(this.root, name), { recursive: true })
      }
      const receipt = { from: source, sites: names }
      await writeFile(receiptPath, JSON.stringify(receipt, null, 2))
      return { seeded: true, ...receipt }
    }
    await writeFile(receiptPath, JSON.stringify({ from: null, sites: [], note: 'no source workspace found' }, null, 2))
    return { seeded: false, reason: 'no ego workspace with learnings/ was found to inherit from' }
  }

  /**
   * Site directory names currently in the store.
   * @returns {Promise<string[]>} sorted site ids.
   */
  async listSiteIds() {
    try {
      return (await readdir(this.root, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.'))
        .map(entry => entry.name)
        .sort()
    } catch {
      return []
    }
  }

  /**
   * Read one site's manifest.
   * @param {string} siteId - the site directory name.
   * @returns {Promise<object | null>} the parsed manifest, or null when unreadable.
   */
  async manifest(siteId) {
    try {
      return JSON.parse(await readFile(join(this.root, siteId, 'manifest.json'), 'utf8'))
    } catch {
      return null
    }
  }

  /**
   * Every site in the store, with its tools and usage counts.
   * @returns {Promise<object[]>} one summary per readable site.
   */
  async list() {
    await this.ready
    const usage = await this.usage()
    const out = []
    for (const siteId of await this.listSiteIds()) {
      const manifest = await this.manifest(siteId)
      if (manifest === null) continue
      const tools = [
        ...Object.entries(manifest.nodeTools || {}).map(([name, schema]) => ({ name, kind: 'node', description: schema.description })),
        ...Object.entries(manifest.browserTools || {}).map(([name, schema]) => ({ name, kind: 'browser', description: schema.description })),
      ].map(tool => ({ ...tool, ...(usage[`${siteId}/${tool.name}`] || { runs: 0 }) }))
      out.push({
        id: siteId,
        name: manifest.name || siteId,
        domains: manifest.domains || [],
        notes: (manifest.notes || []).length,
        tools,
      })
    }
    return out
  }

  /**
   * What the store knows about a URL: the notes in full, and every tool signature.
   *
   * This is the read the agent should make before it touches a page. It costs no
   * browser at all — the store is on disk — so recalling is always cheaper than
   * rediscovering.
   * @param {string} url - a URL or bare hostname.
   * @returns {Promise<object>} the matching sites, their notes, and their tools.
   */
  async recall(url) {
    await this.ready
    const hostname = hostnameOf(url)
    const usage = await this.usage()
    const sites = []
    if (hostname !== '') {
      for (const siteId of await this.listSiteIds()) {
        const manifest = await this.manifest(siteId)
        if (manifest === null) continue
        const domains = Array.isArray(manifest.domains) ? manifest.domains : []
        if (!domains.some(domain => domainMatches(hostname, domain))) continue
        const notes = []
        for (const note of manifest.notes || []) {
          try {
            notes.push({ file: note, content: await readFile(join(this.root, siteId, note), 'utf8') })
          } catch { /* a note listed but not present is reported by validate */ }
        }
        sites.push({
          id: siteId,
          name: manifest.name || siteId,
          domains,
          notes,
          tools: [
            ...Object.entries(manifest.nodeTools || {}).map(([name, schema]) => ({
              name,
              kind: 'node',
              description: schema.description,
              args: schema.args || {},
              returns: schema.returns || null,
              call: `await site.runTool(${JSON.stringify(siteId)}, ${JSON.stringify(name)}, { ... })`,
              ...(usage[`${siteId}/${name}`] || { runs: 0 }),
            })),
            ...Object.entries(manifest.browserTools || {}).map(([name, schema]) => ({
              name,
              kind: 'browser',
              description: schema.description,
              args: schema.args || {},
              returns: schema.returns || null,
              call: `await site.runBrowserTool(${JSON.stringify(siteId)}, ${JSON.stringify(name)}, { ... })`,
              ...(usage[`${siteId}/${name}`] || { runs: 0 }),
            })),
          ],
        })
      }
    }
    return { url, hostname, known: sites.length > 0, sites }
  }

  /**
   * Write a learned tool (and optionally a note) into the store.
   *
   * Everything is validated before a byte is written, so a rejected promotion
   * leaves the store exactly as it was.
   * @param {object} spec - the promotion request.
   * @returns {Promise<object>} a receipt naming every path written.
   */
  async learn(spec) {
    await this.ready
    const problems = validateLearnSpec(spec)
    if (problems.length > 0) {
      const error = new Error(`this is not storable yet:\n${problems.map(line => `  - ${line}`).join('\n')}`)
      error.problems = problems
      throw error
    }
    await this.ensure()
    const siteDir = join(this.root, spec.site)
    const kind = spec.kind === 'browser' ? 'browser' : 'node'
    const folder = kind === 'browser' ? 'browser-tools' : 'tools'
    const file = `${spec.tool.replace(/_/g, '-')}.js`
    const relativePath = `${folder}/${file}`

    const manifest = (await this.manifest(spec.site)) || {
      id: spec.site,
      name: spec.name || spec.site,
      domains: [],
      notes: [],
    }
    manifest.id = spec.site
    if (spec.name) manifest.name = spec.name
    manifest.name = manifest.name || spec.site
    manifest.domains = [...new Set([...(manifest.domains || []), ...spec.domains])]
    manifest.notes = manifest.notes || []

    const written = []
    await mkdir(join(siteDir, folder), { recursive: true })
    await writeFile(join(siteDir, relativePath), ensureTrailingNewline(spec.code))
    written.push(relativePath)

    const key = kind === 'browser' ? 'browserTools' : 'nodeTools'
    manifest[key] = manifest[key] || {}
    manifest[key][spec.tool] = {
      description: spec.description,
      path: relativePath,
      ...(kind === 'node' ? { callable: spec.callable } : {}),
      args: spec.args || {},
      returns: spec.returns,
    }

    if (typeof spec.note === 'string' && spec.note.trim() !== '') {
      const noteFile = `notes/${(spec.noteName || 'overview').replace(/[^a-z0-9-]/gi, '-')}.md`
      await mkdir(join(siteDir, 'notes'), { recursive: true })
      await writeFile(join(siteDir, noteFile), ensureTrailingNewline(spec.note))
      if (!manifest.notes.includes(noteFile)) manifest.notes.push(noteFile)
      written.push(noteFile)
    }

    await writeFile(join(siteDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    written.push('manifest.json')
    return {
      site: spec.site,
      tool: spec.tool,
      kind,
      path: join(siteDir, relativePath),
      written: written.map(entry => join(siteDir, entry)),
      call: kind === 'browser'
        ? `await site.runBrowserTool(${JSON.stringify(spec.site)}, ${JSON.stringify(spec.tool)}, { ... })`
        : `await site.runTool(${JSON.stringify(spec.site)}, ${JSON.stringify(spec.tool)}, { ... })`,
    }
  }

  /**
   * Remove a learned tool, or a whole site.
   * @param {string} siteId - the site to forget from.
   * @param {string} [toolName] - one tool; omitted forgets the whole site.
   * @returns {Promise<object>} a receipt of what was removed.
   */
  async forget(siteId, toolName) {
    await this.ready
    if (!isSafeName(siteId)) throw new Error(`"${siteId}" is not a site id`)
    const siteDir = join(this.root, siteId)
    if (!existsSync(siteDir)) throw new Error(`nothing learned about "${siteId}"`)
    if (toolName === undefined || toolName === '') {
      await rm(siteDir, { recursive: true, force: true })
      return { site: siteId, removed: 'site' }
    }
    const manifest = await this.manifest(siteId)
    if (manifest === null) throw new Error(`"${siteId}" has no readable manifest.json`)
    for (const key of ['nodeTools', 'browserTools']) {
      const schema = manifest[key]?.[toolName]
      if (schema === undefined) continue
      delete manifest[key][toolName]
      if (typeof schema.path === 'string' && !isAbsolute(schema.path) && !schema.path.includes('..')) {
        await rm(join(siteDir, schema.path), { force: true })
      }
      await writeFile(join(siteDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
      return { site: siteId, tool: toolName, removed: 'tool', file: schema.path }
    }
    throw new Error(`"${siteId}" has no tool named "${toolName}"`)
  }

  /**
   * Read the usage ledger.
   * @returns {Promise<Record<string, {runs: number, lastRun?: string, lastOk?: boolean}>>} counts keyed by `site/tool`.
   */
  async usage() {
    try {
      return JSON.parse(await readFile(join(this.metaDir, 'usage.json'), 'utf8'))
    } catch {
      return {}
    }
  }

  /**
   * Record that a learned tool ran, so a tool nobody uses is visible as such.
   * @param {string} siteId - the site.
   * @param {string} toolName - the tool.
   * @param {boolean} ok - whether the run succeeded.
   * @param {string} at - an ISO timestamp for the run.
   */
  async recordUsage(siteId, toolName, ok, at) {
    await this.ready
    await this.ensure()
    const ledger = await this.usage()
    const key = `${siteId}/${toolName}`
    const previous = ledger[key] || { runs: 0 }
    ledger[key] = { runs: previous.runs + 1, lastRun: at, lastOk: ok }
    await writeFile(join(this.metaDir, 'usage.json'), `${JSON.stringify(ledger, null, 2)}\n`)
  }

  /**
   * Check every stored site against ego's manifest rules.
   * @returns {Promise<string[]>} one line per problem; empty means the store is clean.
   */
  async validate() {
    await this.ready
    const errors = []
    for (const siteId of await this.listSiteIds()) {
      const siteDir = join(this.root, siteId)
      const manifest = await this.manifest(siteId)
      if (manifest === null) {
        errors.push(`${siteId}: invalid or missing manifest.json`)
        continue
      }
      if (manifest.id !== siteId) errors.push(`${siteId}: manifest id must match the directory name`)
      if (typeof manifest.name !== 'string' || manifest.name.trim() === '') errors.push(`${siteId}: name must be a non-empty string`)
      const domains = Array.isArray(manifest.domains) ? manifest.domains : []
      if (domains.length === 0) errors.push(`${siteId}: domains must not be empty`)
      for (const domain of domains) {
        if (!isValidDomain(domain)) errors.push(`${siteId}: invalid domain ${JSON.stringify(domain)}`)
      }
      for (const note of manifest.notes || []) {
        if (!/^notes\/[^/]+\.md$/.test(note)) {
          errors.push(`${siteId}: notes must point to notes/*.md, not ${JSON.stringify(note)}`)
          continue
        }
        errors.push(...await this.checkFile(siteDir, note, `${siteId}: note ${JSON.stringify(note)}`))
      }
      for (const [key, pattern] of [['nodeTools', /^tools\/[^/]+\.js$/], ['browserTools', /^browser-tools\/[^/]+\.js$/]]) {
        for (const [toolName, schema] of Object.entries(manifest[key] || {})) {
          const prefix = `${siteId}: ${key}.${toolName}`
          if (!pattern.test(schema?.path || '')) {
            errors.push(`${prefix}: path must be a relative ${key === 'nodeTools' ? 'tools/*.js' : 'browser-tools/*.js'} path`)
            continue
          }
          if (key === 'nodeTools' && (typeof schema.callable !== 'string' || schema.callable.trim() === '')) {
            errors.push(`${prefix}: callable must name the exported function`)
          }
          errors.push(...await this.checkFile(siteDir, schema.path, prefix))
        }
      }
    }
    return errors
  }

  /**
   * Confirm a stored file exists and holds no snapshot refs.
   * @param {string} siteDir - the site directory.
   * @param {string} relativePath - the path inside it.
   * @param {string} prefix - how to label a problem.
   * @returns {Promise<string[]>} problems found.
   */
  async checkFile(siteDir, relativePath, prefix) {
    let text
    try {
      text = await readFile(join(siteDir, relativePath), 'utf8')
    } catch {
      return [`${prefix}: missing file ${JSON.stringify(relativePath)}`]
    }
    return TEMP_REF.test(text) ? [`${prefix}: contains a temporary snapshot ref; use a stable locator instead`] : []
  }
}

/**
 * Add a trailing newline when one is missing.
 * @param {string} text - the file body.
 * @returns {string} the body, newline-terminated.
 */
function ensureTrailingNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`
}

/**
 * Check a promotion request against everything ego's loader will later demand.
 *
 * Written as a list of complaints rather than a first-failure throw so one
 * rejected promotion tells the agent every problem at once.
 * @param {object} spec - the promotion request.
 * @returns {string[]} problems; empty means storable.
 */
export function validateLearnSpec(spec) {
  const problems = []
  if (!isSafeName(spec?.site)) problems.push('site must be a short identifier like "github" or "x-com"')
  if (!isSafeName(spec?.tool)) problems.push('tool must be a short identifier like "search_repos"')
  const domains = Array.isArray(spec?.domains) ? spec.domains : []
  if (domains.length === 0) problems.push('domains must list at least one hostname, such as "github.com" or "*.github.com"')
  for (const domain of domains) {
    if (!isValidDomain(domain)) problems.push(`domain ${JSON.stringify(domain)} is not a hostname or a leading-wildcard pattern`)
  }
  if (typeof spec?.description !== 'string' || spec.description.trim() === '') {
    problems.push('description must say what the tool does, in one line')
  }
  if (typeof spec?.code !== 'string' || spec.code.trim() === '') {
    problems.push('code must be the tool source')
  } else if (TEMP_REF.test(spec.code)) {
    problems.push(
      'code contains a snapshot ref (@21 / ref=21). Those are rebuilt on every snapshotText() call and mean nothing '
      + 'on the next run — re-express the step with a stable locator (a CSS selector, or the loc=... value from the snapshot) before promoting it.',
    )
  }
  if (typeof spec?.note === 'string' && TEMP_REF.test(spec.note)) {
    problems.push('note contains a snapshot ref (@21 / ref=21); describe the element instead')
  }
  const kind = spec?.kind === 'browser' ? 'browser' : 'node'
  if (kind === 'node') {
    if (typeof spec?.callable !== 'string' || spec.callable.trim() === '') {
      problems.push('callable must name the exported function, for example "searchRepos"')
    } else if (typeof spec?.code === 'string' && !exportsCallable(spec.code, spec.callable)) {
      problems.push(`code must export ${JSON.stringify(spec.callable)} — write it as \`export async function ${spec.callable}(ctx, args) { ... }\``)
    }
  }
  problems.push(...validateValueSchemas(spec))
  return problems
}

/**
 * Check the declared argument and return schemas.
 * @param {object} spec - the promotion request.
 * @returns {string[]} problems found.
 */
function validateValueSchemas(spec) {
  const problems = []
  const args = spec?.args
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
    problems.push('args must be an object keyed by argument name')
  } else {
    for (const [name, schema] of Object.entries(args || {})) {
      if (!VALUE_TYPES.has(schema?.type)) problems.push(`args.${name}.type must be one of ${[...VALUE_TYPES].join(', ')}`)
      if (typeof schema?.required !== 'boolean') problems.push(`args.${name}.required must be a boolean`)
      if (typeof schema?.description !== 'string' || schema.description.trim() === '') {
        problems.push(`args.${name}.description must be a non-empty string`)
      }
    }
  }
  const returns = spec?.returns
  if (!returns || typeof returns !== 'object' || Array.isArray(returns)) {
    problems.push('returns must be an object like { "type": "array", "description": "..." }')
  } else {
    if (!VALUE_TYPES.has(returns.type)) problems.push(`returns.type must be one of ${[...VALUE_TYPES].join(', ')}`)
    if (typeof returns.description !== 'string' || returns.description.trim() === '') {
      problems.push('returns.description must be a non-empty string')
    }
  }
  return problems
}

/**
 * Whether a source exports the named binding.
 *
 * Deliberately a text check, not an import: the store holds code the browser
 * runtime will execute, and importing it here would run it in the harness's own
 * process instead. Syntax is checked out-of-process by the caller.
 * @param {string} code - the tool source.
 * @param {string} callable - the expected export name.
 * @returns {boolean} whether the export appears.
 */
export function exportsCallable(code, callable) {
  const name = callable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${name}\\b`
    + `|export\\s+(?:const|let|var)\\s+${name}\\b`
    + `|export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`,
  ).test(code)
}
