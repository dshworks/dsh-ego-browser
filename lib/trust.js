/**
 * Request fence for the one route this plugin mounts.
 *
 * The route is read-only, but what it reads is the agent's own notes about the
 * user's sites, so it is fenced the same way a side-effectful route would be.
 * The threat a local HTTP API faces from a browser is DNS rebinding — a page on
 * the attacker's domain resolves to 127.0.0.1, so the socket reaches this server
 * while the Host header still names the attacker — plus ordinary cross-site
 * reads. Neither is an authentication problem; the fence answers "did this come
 * from the dsh UI on this machine", and reachability stays the webserver's bind
 * policy.
 *
 * Mirrors `@deepseek-ai/dsh-client-connection`'s own `/api` fence rather than
 * importing it, because that module ships as TypeScript source.
 */

/** Hostnames that mean "this machine" for a fence decision. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * Read one header in a case-insensitive, single-value way.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {string} name - lowercase header name.
 * @returns {string | undefined} the value when exactly one string is present.
 */
function header(req, name) {
  const value = req.headers[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * Normalize an authority to `host` or `host:port`, or undefined when it does not parse.
 * @param {string | undefined} authority - a Host or Origin authority.
 * @returns {string | undefined} the canonical form.
 */
export function canonical(authority) {
  if (authority === undefined || authority === '') return undefined
  try {
    const url = new URL(`http://${authority}`)
    return url.port === '' ? url.hostname : `${url.hostname}:${url.port}`
  } catch {
    return undefined
  }
}

/**
 * Assert a configured `trustedHosts` entry is a bare authority in canonical form.
 *
 * A value the URL parser would silently rewrite is a typo that must fail the
 * load rather than quietly authorize something else: `user@evil.example` would
 * otherwise grant `evil.example`.
 * @param {string} entry - the configured value, verbatim.
 */
export function assertTrustedAuthority(entry) {
  if (canonical(entry) !== entry.toLowerCase()) {
    throw new Error(`dsh-ego-browser: trustedHosts entry ${JSON.stringify(entry)} is not a bare host[:port] authority`)
  }
}

/**
 * Whether a read of the memory route may proceed.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {ReadonlyArray<string>} trustedHosts - extra authorities from config.
 * @returns {boolean} true when the request came from this deployment's own UI.
 */
export function checkReadRequest(req, trustedHosts) {
  const host = canonical(header(req, 'host'))
  if (host === undefined) return false
  const hostname = host.replace(/:\d+$/, '')
  const hostIsOurs = LOOPBACK.has(hostname)
    || trustedHosts.some(entry => entry.toLowerCase() === host || entry.toLowerCase() === hostname)
  if (!hostIsOurs) return false
  const site = header(req, 'sec-fetch-site')
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false
  const origin = header(req, 'origin')
  if (origin === undefined || origin === 'null') return true
  try {
    return canonical(new URL(origin).host) === host
  } catch {
    return false
  }
}
