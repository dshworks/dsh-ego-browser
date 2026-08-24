/**
 * The seven tools.
 *
 * ego's own benchmark is the argument for this list being short. Its headline
 * result — complex tasks finishing up to 2.5x faster with far fewer tool calls —
 * comes from the agent writing ONE script that navigates, waits, extracts and
 * branches, instead of a call-look-call-look loop of granular verbs. Shipping
 * thirty small `click` / `fill` / `scroll` tools would spend that advantage to
 * look thorough. So `ego_run` is the primitive, and the other six exist because
 * they do something a script cannot do for itself:
 *
 *   ego_recall   reads the store off disk, with no browser involved at all
 *   ego_learn    writes to the store, and refuses what will not survive
 *   ego_forget   removes what rotted
 *   ego_site_run calls a learned tool and counts the call
 *   ego_handoff  turns ego's hard stop into a real dsh prompt, and resumes
 *   ego_doctor   reports which ego is installed and what it can do
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { guideFor, surfaceLine } from './guide.js'
import { readValue, siteToolCall, taskSpaceCall, valueScript } from './script.js'

/** Foreground seconds one script may hold the calling turn. */
const RUN_SECONDS = { fallback: 120, min: 5, max: 900 }

/**
 * Clamp a caller-supplied duration.
 * @param {unknown} value - the requested seconds.
 * @param {{fallback: number, min: number, max: number}} bounds - allowed range.
 * @returns {number} milliseconds.
 */
function seconds(value, bounds) {
  const number = Number(value)
  if (!Number.isFinite(number)) return bounds.fallback * 1000
  return Math.max(bounds.min, Math.min(bounds.max, number)) * 1000
}

/**
 * Render recalled site knowledge as the block that goes in front of a result.
 * @param {object} recalled - the value from `Memory.recall`.
 * @returns {string} the block, or '' when nothing is known.
 */
function recallBlock(recalled) {
  if (!recalled.known) return ''
  const parts = [`What this agent already learned about ${recalled.hostname}:`]
  for (const site of recalled.sites) {
    parts.push(`\n[${site.id}] ${site.name} — ${site.domains.join(', ')}`)
    for (const note of site.notes) parts.push(`\n--- ${note.file} ---\n${note.content.trim()}`)
    for (const tool of site.tools) {
      const args = Object.entries(tool.args || {})
        .map(([name, schema]) => `${name}${schema.required ? '' : '?'}: ${schema.type}`)
        .join(', ')
      parts.push(
        `\n  ${tool.name}(${args}) -> ${tool.returns?.type || 'unknown'}  [${tool.kind}, used ${tool.runs}x]`
        + `\n    ${tool.description}`
        + `\n    ${tool.call}`,
      )
    }
  }
  return parts.join('\n')
}

/**
 * Register every tool on a context.
 * @param {object} ctx - the host plugin context, carrying `ctx.tools`.
 * @param {object} deps - `ego`, `memory`, `config`, and `checkSyntax`.
 */
export function registerTools(ctx, deps) {
  const { ego, memory, config, checkSyntax } = deps

  ctx.tools.register(defineTool({
    name: 'ego_run',
    description:
      'Run one JavaScript script inside ego lite\'s browser runtime, in a task space of your own that reuses the user\'s real logins. '
      + 'Write the WHOLE browser task as a single script — navigate, wait, extract, verify and branch inside it — because the runtime exits between calls and keeps no variables; a call-per-step loop is the slow path ego exists to remove. '
      + 'Pass `url` and the tool prepends everything this agent already learned about that site, so start from what worked last time instead of a blind snapshot. '
      + 'Call ego_doctor first if you have not yet seen which helper surface this ego build exposes; the two generations use different names.',
    parameters: {
      script: { type: 'string', required: true, description: 'The JavaScript to run. ego helpers are already in scope; print results with cliLog() or console.log() as ego_doctor reports.' },
      url: { type: 'string', description: 'The page this script works on. Costs no browser call and prepends the learned notes and tool signatures for that site.' },
      taskSpace: { type: 'string', description: 'Short name for the user goal. Reuse the same name for every follow-up; a new name means a genuinely different goal.' },
      timeoutSeconds: { type: 'number', description: `Seconds before the run is aborted (default ${RUN_SECONDS.fallback}).` },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          output: { type: 'string' },
          ok: { type: 'boolean' },
          error: { type: 'string' },
          hardStop: { type: 'boolean' },
          learned: { type: 'string' },
          ms: { type: 'number' },
        },
        additionalProperties: true,
      },
      render: (_args, value) => [{
        type: 'text',
        text: [value.learned, value.output, value.ok ? '' : `\n[ego] ${value.error}`]
          .filter(part => part !== undefined && part !== '')
          .join('\n\n') || '(the script produced no output)',
      }],
    },
    async execute(args, exec) {
      const surface = await ego.probeSurface({ signal: exec.signal })
      const learned = args.url ? recallBlock(await memory.recall(args.url)) : ''
      const prologue = args.taskSpace
        ? `await ${taskSpaceCall(surface, 'useOrCreate', JSON.stringify(args.taskSpace))}\n`
        : ''
      const run = await ego.run(prologue + args.script, {
        timeoutMs: seconds(args.timeoutSeconds, RUN_SECONDS),
        signal: exec.signal,
      })
      return {
        output: run.output,
        ok: run.ok,
        ...(run.ok ? {} : { error: run.error }),
        hardStop: run.hardStop,
        ...(learned === '' ? {} : { learned }),
        ms: run.ms,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ego_recall',
    description:
      'What this agent already learned about a site: the notes it wrote, and every stored tool with its signature and how often it has been used. '
      + 'Reads from disk — no browser, no page load, no tokens spent rediscovering. Call it before any browser work on a site you may have visited before.',
    parameters: {
      url: { type: 'string', required: true, description: 'A URL or bare hostname, such as "https://github.com/x/y" or "github.com".' },
    },
    output: {
      schema: {
        type: 'object',
        properties: { known: { type: 'boolean' }, hostname: { type: 'string' }, sites: { type: 'array', items: { type: 'object', additionalProperties: true } } },
        additionalProperties: true,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.known
          ? recallBlock(value)
          : `Nothing learned about ${value.hostname || 'that address'} yet. Do the task with ego_run, then promote what worked with ego_learn.`,
      }],
    },
    async execute(args) {
      return memory.recall(args.url)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ego_site_run',
    description:
      'Run a tool this agent learned earlier, by site id and tool name, from ego_recall\'s list. '
      + 'One call replaces the snapshot-click-scroll-extract loop that originally discovered it, which is where the tokens went.',
    parameters: {
      site: { type: 'string', required: true, description: 'Site id from ego_recall, such as "github".' },
      tool: { type: 'string', required: true, description: 'Tool name from ego_recall.' },
      kind: { type: 'string', description: '"node" (default) or "browser", as ego_recall reports for that tool.' },
      args: { type: 'object', additionalProperties: true, description: 'Arguments matching the tool signature ego_recall printed.' },
      timeoutSeconds: { type: 'number', description: `Seconds before the run is aborted (default ${RUN_SECONDS.fallback}).` },
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, value: { type: 'json' }, output: { type: 'string' }, error: { type: 'string' } }, additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? [value.output, JSON.stringify(value.value, null, 2)].filter(part => part).join('\n\n')
          : `[ego] ${value.error}`,
      }],
    },
    async execute(args, exec) {
      const surface = await ego.probeSurface({ signal: exec.signal })
      const kind = args.kind === 'browser' ? 'browser' : 'node'
      const call = siteToolCall(surface, kind, [
        JSON.stringify(args.site),
        JSON.stringify(args.tool),
        JSON.stringify(args.args || {}),
      ].join(', '))
      const run = await ego.run(valueScript(call), {
        timeoutMs: seconds(args.timeoutSeconds, RUN_SECONDS),
        signal: exec.signal,
      })
      const { value, rest } = readValue(run.output)
      await memory.recordUsage(args.site, args.tool, run.ok, new Date().toISOString())
      return {
        ok: run.ok,
        value,
        output: rest,
        ...(run.ok ? {} : { error: run.error }),
        hardStop: run.hardStop,
        ms: run.ms,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ego_learn',
    description:
      'Promote a browser step that just worked into a reusable tool for that site, stored in ego\'s own learnings format so it loads again next session. '
      + 'Do this after finishing a non-trivial task the user is likely to repeat. '
      + 'The stored code must not contain snapshot refs (@21, ref=21) — those are rebuilt on every snapshot and mean nothing tomorrow; re-express the step with a CSS selector or a loc=... value first. '
      + 'A node tool is `export async function name(ctx, args)` and gets ctx.page / ctx.browser; a browser tool is an expression evaluated in the page.',
    parameters: {
      site: { type: 'string', required: true, description: 'Short site id, such as "github" or "x-com". Reuse the existing id when ego_recall already knows the site.' },
      domains: { type: 'array', required: true, items: { type: 'string' }, description: 'Hostnames this applies to, such as ["github.com", "*.github.com"].' },
      tool: { type: 'string', required: true, description: 'Tool name, such as "search_repos".' },
      description: { type: 'string', required: true, description: 'One line saying what the tool does.' },
      code: { type: 'string', required: true, description: 'The tool source. For a node tool, an ES module exporting the callable.' },
      callable: { type: 'string', description: 'The exported function name for a node tool, such as "searchRepos".' },
      kind: { type: 'string', description: '"node" (default, runs in the ego runtime with ctx.page) or "browser" (evaluated inside the page).' },
      args: { type: 'object', additionalProperties: true, description: 'Argument schema: { "query": { "type": "string", "required": true, "description": "..." } }.' },
      returns: { type: 'object', required: true, additionalProperties: true, description: 'Return schema: { "type": "array", "description": "..." }.' },
      name: { type: 'string', description: 'Human-readable site name, used when the site is new.' },
      note: { type: 'string', description: 'Markdown worth remembering about the site: what breaks, what to wait for, which selector is stable.' },
      noteName: { type: 'string', description: 'Note filename stem (default "overview").' },
    },
    output: {
      schema: { type: 'object', properties: { site: { type: 'string' }, tool: { type: 'string' }, path: { type: 'string' }, call: { type: 'string' }, written: { type: 'array', items: { type: 'string' } } }, additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: `Learned ${value.site}/${value.tool}.\nCall it next time with:\n  ${value.call}\nor with ego_site_run.\n\nWrote:\n${value.written.map(path => `  ${path}`).join('\n')}` }],
    },
    async execute(args, exec) {
      if (args.kind !== 'browser') {
        const problem = await checkSyntax(args.code, exec.signal)
        if (problem !== null) throw new Error(`the tool source does not parse: ${problem}`)
      }
      return memory.learn(args)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ego_forget',
    description:
      'Remove a learned tool, or a whole site, from the store. Use it when a stored tool has started failing because the site changed — a memory that is wrong is worse than none.',
    parameters: {
      site: { type: 'string', required: true, description: 'Site id to forget from.' },
      tool: { type: 'string', description: 'One tool name; omit to forget the entire site.' },
    },
    output: {
      schema: { type: 'object', properties: { site: { type: 'string' }, tool: { type: 'string' }, removed: { type: 'string' } }, additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: value.removed === 'site' ? `Forgot everything about ${value.site}.` : `Forgot ${value.site}/${value.tool} (${value.file}).` }],
    },
    async execute(args) {
      return memory.forget(args.site, args.tool)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ego_handoff',
    description:
      'Give the browser back to the user for a step only they can do — a login, a captcha, a payment confirmation — and wait for their decision. '
      + 'ego pauses the agent and asks the harness to offer "Continue" or "Finish task"; this tool is that offer. On Continue it takes control back so the next ego_run resumes; on Finish it closes the task out. '
      + 'Use it the moment a run reports the user has taken control: that is a hard stop, and retrying or grabbing control back is the wrong move.',
    parameters: {
      taskSpace: { type: 'string', required: true, description: 'The task space name or numeric id to hand over.' },
      reason: { type: 'string', required: true, description: 'One line the user will read: what is blocked and why you need them.' },
      instructions: { type: 'string', description: 'Exactly what to do in the browser, in the order to do it.' },
    },
    output: {
      schema: { type: 'object', properties: { resumed: { type: 'boolean' }, answer: { type: 'string' }, note: { type: 'string' } }, additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.resumed
          ? `The user finished and handed the browser back. ${value.note || ''}`.trim()
          : `The user did not hand the browser back: ${value.answer || value.note}. Do not retry browser work until they say to continue.`,
      }],
    },
    async execute(args, exec) {
      const surface = await ego.probeSurface({ signal: exec.signal })
      const space = JSON.stringify(args.taskSpace)
      const handOff = await ego.run(valueScript(taskSpaceCall(surface, 'handOff', space)), { signal: exec.signal })
      if (!handOff.ok) throw new Error(`could not hand the task space over: ${handOff.error}`)

      const questions = ctx.get('userQuestions')
      const detail = [args.reason, args.instructions].filter(part => part).join('\n\n')
      let answer
      if (questions !== undefined) {
        try {
          answer = await questions.ask({
            agent: exec.agent,
            signal: exec.signal,
            questions: [{
              id: 'ego-handoff',
              header: 'Browser',
              question: args.reason,
              detail,
              options: [
                { label: 'Continue', description: 'I am done in the browser — carry on.' },
                { label: 'Finish task', description: 'Stop here and leave the page to me.' },
              ],
            }],
          })
        } catch (error) {
          // A subagent has no human answerer — the harness refuses the ask with
          // DELEGATED_CALLER rather than blocking forever. That is the correct
          // outcome, so report the handoff and let the parent turn do the asking.
          if (error?.code !== 'DELEGATED_CALLER' && error?.code !== 'CALLER_NOT_LIVE') throw error
        }
      }
      if (answer === undefined) {
        // Headless, no question provider, or a delegated caller. The handoff
        // still happened; say so plainly rather than pretending an answer came.
        return {
          resumed: false,
          note: 'nobody could be asked from here (headless, no question UI, or this agent is a subagent), so the browser is now the user\'s and nothing is waiting on it. '
            + 'Say in your reply exactly what they should do, and call ego_handoff again with the same task space once they reply "continue" — it will take control back.',
        }
      }
      const chosen = answer.answers?.[0]
      const picked = chosen?.selected?.[0] ?? chosen?.custom ?? 'Finish task'
      if (picked !== 'Continue') {
        const done = await ego.run(valueScript(taskSpaceCall(surface, 'complete', `${space}, { keep: true }`)), { signal: exec.signal })
        return { resumed: false, answer: picked, note: done.ok ? 'task space closed out, page left open for the user' : done.error }
      }
      const back = await ego.run(valueScript(taskSpaceCall(surface, 'takeOver', space)), { signal: exec.signal })
      if (!back.ok) throw new Error(`the user chose Continue but control did not come back: ${back.error}`)
      return { resumed: true, answer: picked, note: 'control is back with the agent' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ego_doctor',
    description:
      'Report which ego lite is installed and what it can do: the command, the argv shape it accepts, which helper surface it exposes (the two generations use different names), where the learned store lives, and what is in it. '
      + 'Call this once before your first ego_run in a session — it is how you find out whether to write cliLog() or console.log().',
    parameters: {
      refresh: { type: 'boolean', description: 'Re-probe instead of reporting the cached answer.' },
    },
    output: {
      schema: { type: 'object', properties: { bin: { type: 'string' }, argv: { type: 'string' }, surface: { type: 'string' }, guide: { type: 'string' }, workspace: { type: 'string' }, sites: { type: 'array', items: { type: 'object', additionalProperties: true } }, problems: { type: 'array', items: { type: 'string' } } }, additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `command: ${value.bin}   invoked as: ${value.argv}`,
          value.surface,
          `store: ${value.workspace} (${value.sites.length} site${value.sites.length === 1 ? '' : 's'})`,
          ...value.sites.map(site => `  ${site.id} — ${site.domains.join(', ')} — ${site.tools.length} tool(s): ${site.tools.map(tool => `${tool.name} (${tool.runs}x)`).join(', ') || 'none'}`),
          value.problems.length === 0 ? '' : `problems:\n${value.problems.map(line => `  ${line}`).join('\n')}`,
          '',
          value.guide,
        ].filter(line => line !== '').join('\n'),
      }],
    },
    async execute(args, exec) {
      if (args.refresh) ego.reset()
      const argv = await ego.probeArgv({ signal: exec.signal })
      const surface = await ego.probeSurface({ signal: exec.signal })
      return {
        bin: config.bin,
        argv: [config.bin, ...argv, ...config.extraArgs].join(' ') + " <<'JS'",
        surface: surfaceLine(surface),
        globals: surface.globals,
        guide: guideFor(surface),
        workspace: memory.workspace,
        sites: await memory.list(),
        problems: await memory.validate(),
      }
    },
  }))
}
