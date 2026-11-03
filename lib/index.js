/**
 * Host half of dsh-provider-show.
 *
 * The browser can see the model catalog, but it cannot see WHO registered a
 * provider route: the catalog group carries only `{ id, name, models }`, and the
 * registry strips adapter metadata before it reaches the page. That answer
 * lives in the Host's LLM directory, so this half reads it and publishes one
 * small, already-decided document:
 *
 *     GET /plugins/dsh-provider-show/providers
 *     { ok: true, value: { providers: [{ provider, displayName, label, owner, reason }] } }
 *
 * Each row is decided HERE by the shared pure resolver, so the ownership rule
 * has exactly one implementation and the client half stays a lookup. No Client
 * package, no `remote.llm` dependency, and no second copy of the rule that could
 * drift from this one.
 *
 * A Host-only bundle would need the route's consumer to exist; the Client half
 * is what consumes it, so the two ship together in one bundle.
 *
 * @module dsh-provider-show
 */

import {
  DEFAULT_CORE_NAMESPACES,
  providerLabel,
  resolveOwnership,
  shouldRender,
} from './ownership.js'

/** Route this plugin owns, namespaced under `/plugins/` like other bundles. */
const PROVIDERS_PATH = '/plugins/dsh-provider-show/providers'

/** How long one directory snapshot is reused, in milliseconds. */
const CACHE_MS = 5000

/**
 * The plugin's configuration shape, described once as plain data.
 *
 * Deliberately NOT a Schemastery schema. A bundle installed by linking this
 * directory resolves its imports through the profile's `node_modules`, and the
 * shipped Harness packages are NOT there for a bundle that declares no
 * dependency on them — so importing a schema library from the Harness tree
 * would make the whole Host half fail to load. The Loader treats a missing
 * `Config` export as "no schema" and passes the row's config through
 * (`resolveConfig` returns early when `runtime.Config` is absent), so the
 * defaults are applied here instead, in {@link effectiveConfig}, where they cost
 * no import.
 *
 * The shapes below are documented for the patch author and validated at use.
 */
export const CONFIG_KEYS = Object.freeze({
  enabled: 'boolean — draw the label (default true)',
  shortNames: 'Record<providerId, string> — a shorter label than the catalog name',
  overrides: 'Record<providerId, "mine" | "third-party" | "hide"> — force one decision',
  coreNamespaces: 'string[] — settings namespaces the Harness itself owns',
})

/** The ownership decision values `overrides` accepts. */
const OVERRIDE_VALUES = Object.freeze(['mine', 'third-party', 'hide'])

/**
 * Coerce one unknown value to a string record.
 *
 * Configuration arrives from YAML, so a value can be a number, a list, or
 * absent. Anything unusable is dropped rather than throwing inside a request.
 *
 * @param {unknown} value - raw configured value.
 * @returns {Record<string, string>} only the string-valued entries.
 */
function stringRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof key !== 'string' || key === '') continue
    if (typeof entry !== 'string') continue
    out[key] = entry
  }
  return out
}

/**
 * Resolve the row's configuration into the struct the rest of this file uses.
 *
 * Every field falls back to a defined behaviour, because `cordis.patch.yml`
 * replaces the WHOLE `config` object when it names one key: a user overriding
 * `shortNames` must not thereby disable the default core namespace list.
 *
 * @param {unknown} raw - the row's config as the Loader supplied it.
 * @returns {{ enabled: boolean, shortNames: Record<string,string>, overrides: Record<string,string>, coreNamespaces: string[] }}
 *          effective configuration.
 */
export function effectiveConfig(raw) {
  const base = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const shortNames = stringRecord(base.shortNames)
  const overrides = {}
  for (const [key, value] of Object.entries(stringRecord(base.overrides))) {
    // An unrecognised override would silently do nothing; dropping it keeps the
    // resolver's single authority intact and the behaviour predictable.
    if (OVERRIDE_VALUES.includes(value)) overrides[key] = value
  }
  const coreNamespaces = Array.isArray(base.coreNamespaces)
    ? base.coreNamespaces.filter((entry) => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim())
    : []
  return {
    enabled: base.enabled !== false,
    shortNames,
    overrides,
    coreNamespaces: coreNamespaces.length > 0 ? coreNamespaces : [...DEFAULT_CORE_NAMESPACES],
  }
}

/**
 * Read the live LLM registry into the raw rows the resolver consumes.
 *
 * Both calls are optional in a composition. A profile without an LLM service
 * simply produces no rows, which the resolver reports as `unknown` — ours.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @returns {{ rows: unknown[], providers: unknown[] }} directory rows and registered routes.
 */
function readDirectory(ctx) {
  const llm = ctx.get('llm')
  if (llm === undefined || llm === null) return { rows: [], providers: [] }
  const rows = read(() => llm.listConfigurableProviders?.())
  const providers = read(() => llm.listProviders?.())
  return {
    rows: Array.isArray(rows) ? rows : [],
    providers: Array.isArray(providers) ? providers : [],
  }
}

/**
 * Call one optional registry method, treating any failure as "not available".
 *
 * @param {() => unknown} read - the call.
 * @returns {unknown} its result, or undefined.
 */
function read(call) {
  try {
    return call()
  } catch {
    return undefined
  }
}

/**
 * Build the document the client half reads.
 *
 * Registered routes decide WHICH providers exist; the configurable directory
 * decides WHO registers each one. The two can legitimately differ — a route
 * may be registered without a directory entry and vice versa — so they are
 * unioned, and a route with no directory row resolves to `unknown`, which
 * renders our label.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {ReturnType<typeof effectiveConfig>} config - effective configuration.
 * @returns {{ providers: Array<{provider: string, displayName: string, label: string, owner: string, reason: string}>, coreNamespaces: string[] }}
 *          one decided row per provider route.
 */
export function describeProviders(ctx, config) {
  const { rows, providers } = readDirectory(ctx)
  const coreNamespaces = config.coreNamespaces

  const ids = []
  const seen = new Set()
  const claim = (id) => {
    if (typeof id !== 'string' || id === '' || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  }
  for (const provider of providers) claim(provider?.id)
  for (const row of rows) claim(row?.provider)

  const out = []
  for (const providerId of ids) {
    const decision = resolveOwnership({
      providerId,
      directoryRows: rows,
      coreNamespaces,
      overrides: config.overrides,
    })
    const label = providerLabel({
      providerId,
      displayName: decision.displayName,
      shortNames: config.shortNames,
    })
    out.push({
      provider: providerId,
      displayName: decision.displayName ?? providerId,
      label,
      // The client draws the label only when `visible`. Both decisions — who
      // owns the provider, and whether to draw anything — are made here so the
      // page never has to re-derive them.
      visible: label !== '' && shouldRender(decision, config),
      owner: decision.owner,
      reason: decision.reason,
    })
  }
  return { providers: out, coreNamespaces }
}

/**
 * Send one JSON reply that no cache should reuse.
 *
 * @param {import('node:http').ServerResponse} res - response to write.
 * @param {number} status - HTTP status code.
 * @param {unknown} body - JSON-serialisable payload.
 * @returns {void}
 */
function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/**
 * Accept only requests issued by the page this Host itself serves.
 *
 * The document exposes provider topology, so the route is held to the loopback
 * rule other plugin routes use: the Host header must name this listener, and a
 * present Origin must be loopback too. A same-origin `fetch` from the served
 * page satisfies both.
 *
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {boolean} whether the request may be served.
 */
function fromThisPage(req) {
  const local = req.socket?.localAddress
  const host = req.headers.host
  if (typeof host === 'string' && local !== undefined) {
    const address = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
    if (!(address === local || address === 'localhost' || address === '127.0.0.1' || address === '::1')) {
      return false
    }
  }
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '') {
    try {
      const { hostname } = new URL(origin)
      if (!(hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === local)) {
        return false
      }
    } catch {
      return false
    }
  }
  return true
}

/**
 * Host entry point: register the read-only provider directory route.
 *
 * The route is registered inside `ctx.effect`, so unloading the plugin removes
 * it and drops the snapshot with it.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {unknown} [rawConfig] - the row's configuration.
 * @returns {void}
 */
export function apply(ctx, rawConfig) {
  const config = effectiveConfig(rawConfig)
  let snapshot
  let snapshotAt = 0

  ctx.effect(() => {
    const webServer = ctx.get('webServer')
    if (webServer === undefined || typeof webServer.register !== 'function') return () => {}
    return webServer.register({
      kind: 'exact',
      path: PROVIDERS_PATH,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          json(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        if (!fromThisPage(req)) {
          json(res, 403, { ok: false, error: 'not-this-page' })
          return
        }
        const now = Date.now()
        if (snapshot === undefined || now - snapshotAt >= CACHE_MS) {
          try {
            snapshot = describeProviders(ctx, config)
            snapshotAt = now
          } catch (error) {
            // A failed read is not a failed route: the client treats an absent
            // answer as "draw nothing", and the reason is reported rather than
            // thrown into the request lifecycle.
            json(res, 200, {
              ok: false,
              error: 'directory-unavailable',
              message: error instanceof Error ? error.message : String(error),
            })
            return
          }
        }
        json(res, 200, {
          ok: true,
          value: { ...snapshot, enabled: config.enabled },
        })
      },
    })
  }, 'dsh-provider-show: provider directory route')
}
