/**
 * The runtime guide handed to the model — assembled from what the installed ego
 * actually exposes, not from what the documentation says it should.
 *
 * ego ships two incompatible helper surfaces under one command name. The older
 * one installs flat globals and `cliLog`; the newer one installs Playwright-
 * shaped facades and drops `cliLog` for `console.log`. Writing for the wrong one
 * costs a whole round trip to a ReferenceError, and no amount of documentation
 * fixes it because both documents are true somewhere. So the surface is probed
 * and the guide is generated from the answer.
 */

/** Written for the flat-global generation (`cliLog`, `snapshotText`, ...). */
const FLAT = `Output goes through \`cliLog(value)\`; nothing else reaches you.

  const task = await useOrCreateTaskSpace('collect release notes')
  await openOrReuseTab('https://example.com', { wait: true, timeout: 20 })
  cliLog(await snapshotText())

Observe: snapshotText() (semantic tree with [ref=N, loc=...] handles), pageInfo(),
captureScreenshot(path), drainEvents().
Act: click(target), doubleClick, hover, dragMouse, fillInput(target, text),
typeText, pressKey, scrollBy, scroll.
Wait: wait(seconds), waitForLoad, waitForElement, waitForNetworkIdle.
Evaluate: js(sourceString) in the page, cdp(method, params) for raw protocol.
Task spaces: listTaskSpaces, useOrCreateTaskSpace, claimTaskSpace, handOffTaskSpace,
takeOverTaskSpace, completeTaskSpace(nameOrId, { keep }).
Learned skills: site.learnContext(url), site.runTool(id, name, args),
site.runBrowserTool(id, name, args).`

/** Written for the facade generation (`page`, `browser`, `taskSpaces`, ...). */
const FACADE = `Output goes through \`console.log(value)\`; nothing else reaches you.

  const task = await taskSpaces.useOrCreate('collect release notes')
  await browser.openOrReuseTab('https://example.com', { wait: true, timeout: 20000 })
  await page.waitForLoadState('load')
  console.log(await page.snapshot())

Observe: page.snapshot(), page.info(), page.screenshot(options), page.url().
Act: page.locator(sel) then .click() / .fill(v) / .press(k) / .innerText() /
.evaluateAll(fn, arg); page.getByRole / getByText / getByLabel / getByTestId;
page.keyboard.press(key), page.mouse.click(x, y).
Wait: page.waitForLoadState, page.waitForSelector, page.waitForURL,
page.waitForResponse, locator.waitFor().
Evaluate: page.evaluate(expressionString), cdp(method, params).
Tabs: browser.listTabs, browser.openOrReuseTab, browser.switchTab, browser.closeTab.
Task spaces: taskSpaces.useOrCreate, taskSpaces.claim, taskSpaces.handOff,
taskSpaces.takeOver, taskSpaces.complete(nameOrId, { keep }).
Learned skills: site.learnContext(url), site.runTool(id, name, args),
site.runBrowserTool(id, name, args).`

/** True regardless of generation. */
const RULES = `Rules that hold either way:
- One script per browser task. The runtime exits between calls and keeps no
  variables, so navigate, wait, extract, verify and branch inside ONE script.
  That is ego's whole design: writing code beats a call-look-call-look loop.
- Name a task space once and reuse it for every follow-up on the same goal.
  \`{ keep: false }\` on completion unless the user needs the page left open.
- Snapshot refs (\`@21\`, \`ref=21\`) are valid only for the snapshot that
  produced them. Use \`loc=...\` values or CSS selectors for anything you intend
  to reuse — and only those can be promoted with ego_learn.
- If a run reports the user has taken control, that is a hard stop. Do not retry
  and do not take control back. Ask, and resume through ego_handoff.`

/**
 * The API sketch for a probed surface.
 * @param {{generation: string, globals: string[]}} surface - the probe result.
 * @returns {string} a guide the model can write against.
 */
export function guideFor(surface) {
  const body = surface.generation === 'facade' ? FACADE
    : surface.generation === 'flat' ? FLAT
      : surface.generation === 'both' ? `${FLAT}\n\nThis build also exposes the facade form:\n\n${FACADE}`
        : `This build exposed neither known helper surface. Names it does have: ${surface.globals.join(', ') || '(none)'}.`
  return `${body}\n\n${RULES}`
}

/**
 * A one-line statement of which surface is installed.
 * @param {{generation: string, globals: string[]}} surface - the probe result.
 * @returns {string} the summary line.
 */
export function surfaceLine(surface) {
  const label = {
    flat: 'flat globals (cliLog / snapshotText / useOrCreateTaskSpace)',
    facade: 'facades (console.log / page / browser / taskSpaces)',
    both: 'both flat globals and facades',
    unknown: 'an unrecognised helper surface',
  }[surface.generation]
  return `ego runtime surface: ${label}; ${surface.globals.length} helper names visible.`
}
