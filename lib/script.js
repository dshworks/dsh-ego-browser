/**
 * Script fragments written against the helper surface the installed ego has.
 *
 * Every string ego runs is built here rather than inline at the call site, so
 * the one place that has to know about the two runtime generations is this file.
 */

/** Prefix of the line a value-returning script prints. */
export const VALUE_PREFIX = '@@DSH_EGO_VALUE@@'

/**
 * Whether this build speaks only the newer facade surface.
 * @param {{generation: string}} surface - the probe result.
 * @returns {boolean} true when flat globals are absent.
 */
function facadeOnly(surface) {
  return surface.generation === 'facade'
}

/**
 * A task-space call, in whichever form this build understands.
 * @param {{generation: string}} surface - the probe result.
 * @param {'useOrCreate' | 'claim' | 'handOff' | 'takeOver' | 'complete'} verb - the operation.
 * @param {string} argsSource - already-serialised arguments.
 * @returns {string} a JavaScript expression.
 */
export function taskSpaceCall(surface, verb, argsSource) {
  const flat = {
    useOrCreate: 'useOrCreateTaskSpace',
    claim: 'claimTaskSpace',
    handOff: 'handOffTaskSpace',
    takeOver: 'takeOverTaskSpace',
    complete: 'completeTaskSpace',
  }[verb]
  return facadeOnly(surface) ? `taskSpaces.${verb}(${argsSource})` : `${flat}(${argsSource})`
}

/**
 * A learned-tool call, in whichever form this build understands.
 * @param {{globals: string[]}} surface - the probe result.
 * @param {'node' | 'browser'} kind - which tool table the tool lives in.
 * @param {string} argsSource - already-serialised arguments.
 * @returns {string} a JavaScript expression.
 * @throws {Error} when this build exposes no learned-skill surface at all.
 */
export function siteToolCall(surface, kind, argsSource) {
  const facadeMethod = kind === 'browser' ? 'runBrowserTool' : 'runTool'
  const flatName = kind === 'browser' ? 'runSiteBrowserTool' : 'runSiteTool'
  if (surface.globals.includes('site')) return `site.${facadeMethod}(${argsSource})`
  if (surface.globals.includes(flatName)) return `${flatName}(${argsSource})`
  throw new Error(
    'this ego build exposes no learned-skill surface (neither `site.runTool` nor `runSiteTool`), '
    + 'so a stored site tool cannot be called. Update ego lite, or run the steps directly with ego_run.',
  )
}

/**
 * A script that evaluates one expression and prints its value.
 * @param {string} expression - the expression to await.
 * @returns {string} the script.
 */
export function valueScript(expression) {
  return [
    `const __value = await ${expression}`,
    `__egoOut(${JSON.stringify(VALUE_PREFIX)} + ' ' + JSON.stringify(__value === undefined ? null : __value))`,
  ].join('\n')
}

/**
 * Pull the value line out of a run's output.
 * @param {string} output - the script's own output.
 * @returns {{value: unknown, rest: string}} the parsed value and everything else.
 */
export function readValue(output) {
  const lines = output.split('\n')
  const at = lines.findLastIndex(line => line.startsWith(VALUE_PREFIX))
  if (at === -1) return { value: undefined, rest: output }
  let value
  try {
    value = JSON.parse(lines[at].slice(VALUE_PREFIX.length).trim())
  } catch {
    value = undefined
  }
  lines.splice(at, 1)
  return { value, rest: lines.join('\n').trim() }
}
