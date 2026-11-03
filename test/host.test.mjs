/**
 * Behavioural test for the Host half.
 *
 * Runs `apply()` against a stub Cordis context and a stub HTTP server, then
 * asserts what the route answers. This is the closest verification available
 * without installing the bundle: it exercises the real module, the real
 * ownership rule, and the real request handling.
 */

import test from 'node:test'
import assert from 'node:assert'

import { apply, describeProviders, effectiveConfig } from '../lib/index.js'

/**
 * Build a stub context whose `llm` reports the given directory.
 *
 * @param {object} [options] - stub options.
 * @param {unknown} [options.rows] - `listConfigurableProviders()` reply.
 * @param {unknown} [options.providers] - `listProviders()` reply.
 * @param {boolean} [options.withWebServer] - whether the server service exists.
 * @param {boolean} [options.throwing] - make the directory calls throw.
 * @param {{ provider: string, model: string } | null} [options.defaultSelection] - `agentDefaultModel.currentSelection()` reply; OMIT to model a composition without the service.
 * @param {boolean} [options.throwingDefault] - make the default-model read throw.
 * @returns {{ ctx: object, routes: Map<string, object>, disposed: () => boolean }} the stub.
 */
function stubContext({
  rows,
  providers,
  withWebServer = true,
  throwing = false,
  defaultSelection,
  throwingDefault = false,
} = {}) {
  const routes = new Map()
  let disposed = false
  const llm = {
    listConfigurableProviders() {
      if (throwing) throw new Error('registry exploded')
      return rows
    },
    listProviders() {
      if (throwing) throw new Error('registry exploded')
      return providers
    },
  }
  // Absent when the caller names no selection: a deployment may have no
  // `agent-default-model` row at all, which the Host half must survive.
  const agentDefaultModel = defaultSelection === undefined ? undefined : {
    currentSelection() {
      if (throwingDefault) throw new Error('default model exploded')
      return defaultSelection
    },
  }
  const webServer = {
    register(route) {
      if (routes.has(route.path)) throw new Error(`duplicate route ${route.path}`)
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }
  const ctx = {
    get(name) {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') return agentDefaultModel
      if (name === 'webServer') return withWebServer ? webServer : undefined
      return undefined
    },
    // cordis's `ctx.inject(deps, callback)` starts a CHILD PLUGIN and returns a
    // fiber, not a disposer; the child's registrations are disposed with the
    // child. The stub mirrors that: it runs the callback when the dependency is
    // present, records the child's effects on a child scope, and exposes one
    // `disposeChild` so a test can prove unload removes the route.
    inject(names, callback) {
      const missing = names.filter((name) => ctx.get(name) === undefined)
      if (missing.length > 0) return { dispose() {} }
      const childEffects = []
      const scope = {
        get: (name) => ctx.get(name),
        effect: (fn) => {
          const dispose = fn()
          childEffects.push(dispose)
          return () => dispose?.()
        },
      }
      for (const name of names) scope[name] = ctx.get(name)
      callback(scope)
      return {
        dispose() {
          for (const dispose of childEffects) dispose?.()
        },
      }
    },
    effect(fn) {
      const dispose = fn()
      return () => {
        disposed = true
        dispose?.()
      }
    },
  }
  return { ctx, routes, disposed: () => disposed }
}

/**
 * Invoke one route handler and collect the reply.
 *
 * @param {object} route - registered route.
 * @param {object} [request] - request fields.
 * @returns {Promise<{ status: number, body: any }>} the reply.
 */
async function call(route, request = {}) {
  const { method = 'GET', host = '127.0.0.1:56604', origin = 'http://127.0.0.1:56604', local = '127.0.0.1' } = request
  const headers = {}
  if (host !== null) headers.host = host
  if (origin !== null) headers.origin = origin
  let status = 0
  let payload = ''
  const res = {
    writeHead(code) {
      status = code
    },
    end(chunk) {
      payload = String(chunk ?? '')
    },
  }
  await route.handler({ method, headers, socket: { localAddress: local } }, res)
  return { status, body: payload === '' ? undefined : JSON.parse(payload) }
}

/** Directory rows shaped like the live registry on this machine. */
const ROWS = [
  { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
  { provider: 'deepseek-account', displayName: 'DeepSeek', settingsNs: 'llm-deepseek-account', settingsPath: [] },
  { provider: 'volcano-api', displayName: '火山方舟', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'volcano-api'] },
  { provider: 'workbuddy', displayName: 'WorkBuddy', settingsNs: 'dsh-connect-workbuddy', settingsPath: [] },
]
const PROVIDERS = [
  { id: 'deepseek-official', name: 'DeepSeek' },
  { id: 'deepseek-account', name: 'DeepSeek' },
  { id: 'volcano-api', name: '火山方舟' },
  { id: 'workbuddy', name: 'WorkBuddy' },
]

const PATH = '/plugins/dsh-provider-show/providers'

/**
 * The deployment default on this machine, in the shape `agentDefaultModel`
 * reports: the profile's `agent-default-model` row names this provider and model.
 */
const DEFAULT_SELECTION = { provider: 'volcano-api', model: 'deepseek-v4.1-flash' }

test('the route is registered under the package namespace', () => {
  const { ctx, routes } = stubContext({ rows: ROWS, providers: PROVIDERS })
  apply(ctx)
  assert.deepEqual([...routes.keys()], [PATH])
})

test('a core provider yields a visible label and a third-party one does not', () => {
  const { ctx } = stubContext({ rows: ROWS, providers: PROVIDERS })
  const document = describeProviders(ctx, {
    enabled: true,
    shortNames: {},
    overrides: {},
    coreNamespaces: ['llm-pi-ai', 'llm-deepseek', 'llm-deepseek-account'],
  })
  const byId = new Map(document.providers.map((row) => [row.provider, row]))

  assert.equal(byId.get('volcano-api').visible, true)
  assert.equal(byId.get('volcano-api').label, '火山方舟')
  assert.equal(byId.get('volcano-api').owner, 'core')

  assert.equal(byId.get('workbuddy').visible, false)
  assert.equal(byId.get('workbuddy').owner, 'third-party')

  // Both official DeepSeek routes stay ours.
  for (const id of ['deepseek-official', 'deepseek-account']) {
    assert.equal(byId.get(id).visible, true, id)
  }
})

test('an override renames, hides, or yields one provider', () => {
  const { ctx } = stubContext({ rows: ROWS, providers: PROVIDERS })
  const document = describeProviders(ctx, {
    enabled: true,
    shortNames: { 'volcano-api': '火山' },
    overrides: { workbuddy: 'mine', 'deepseek-official': 'hide' },
    coreNamespaces: ['llm-pi-ai', 'llm-deepseek', 'llm-deepseek-account'],
  })
  const byId = new Map(document.providers.map((row) => [row.provider, row]))

  assert.equal(byId.get('volcano-api').label, '火山')
  assert.equal(byId.get('workbuddy').visible, true, 'an override can reclaim a provider from a plugin')
  assert.equal(byId.get('deepseek-official').visible, false, 'hide suppresses without reattributing')
  assert.equal(byId.get('deepseek-official').owner, 'core', 'hide must not claim third-party ownership')
})

test('the plugin switch suppresses every label', () => {
  const { ctx } = stubContext({ rows: ROWS, providers: PROVIDERS })
  const document = describeProviders(ctx, {
    enabled: false,
    shortNames: {},
    overrides: {},
    coreNamespaces: ['llm-pi-ai', 'llm-deepseek', 'llm-deepseek-account'],
  })
  assert.equal(document.providers.every((row) => row.visible === false), true)
})

test('a route with no directory row still renders, under its own id', () => {
  const { ctx } = stubContext({ rows: [], providers: [{ id: 'bare-route', name: 'Bare' }] })
  const document = describeProviders(ctx, {
    enabled: true,
    shortNames: {},
    overrides: {},
    coreNamespaces: ['llm-pi-ai'],
  })
  assert.deepEqual(document.providers, [
    {
      provider: 'bare-route',
      displayName: 'bare-route',
      label: 'bare-route',
      visible: true,
      owner: 'unknown',
      reason: 'no-directory-row',
    },
  ])
})

test('the GET route answers the document with the plugin switch included', async () => {
  const { ctx, routes } = stubContext({ rows: ROWS, providers: PROVIDERS })
  apply(ctx)
  const reply = await call(routes.get(PATH))
  assert.equal(reply.status, 200)
  assert.equal(reply.body.ok, true)
  assert.equal(reply.body.value.enabled, true)
  assert.equal(reply.body.value.providers.length, 4)
})

test('the document publishes the deployment default the model seat falls back to', async () => {
  const { ctx, routes } = stubContext({ rows: ROWS, providers: PROVIDERS, defaultSelection: DEFAULT_SELECTION })
  apply(ctx)
  const reply = await call(routes.get(PATH))
  assert.equal(reply.body.ok, true)
  // A brand-new Session has no `modelSelection` yet; without this value the
  // client half would show no provider while the seat already shows a model.
  assert.deepEqual(reply.body.value.default, DEFAULT_SELECTION)
})

test('a composition without a default-model service still answers, with no default', async () => {
  const { ctx, routes } = stubContext({ rows: ROWS, providers: PROVIDERS })
  apply(ctx)
  const reply = await call(routes.get(PATH))
  assert.equal(reply.status, 200)
  assert.equal(reply.body.value.default, null)
  assert.equal(reply.body.value.providers.length, 4, 'the directory must still be published')
})

test('a failing default-model read does not fail the route', async () => {
  const { ctx, routes } = stubContext({
    rows: ROWS,
    providers: PROVIDERS,
    defaultSelection: DEFAULT_SELECTION,
    throwingDefault: true,
  })
  apply(ctx)
  const reply = await call(routes.get(PATH))
  assert.equal(reply.status, 200)
  assert.equal(reply.body.ok, true)
  assert.equal(reply.body.value.default, null, 'an unreadable default degrades to "draw nothing"')
})

test('an unusable default selection is dropped instead of published', () => {
  const config = {
    enabled: true,
    shortNames: {},
    overrides: {},
    coreNamespaces: ['llm-pi-ai'],
  }
  for (const unusable of [null, { provider: '', model: 'm' }, { provider: 'p' }, { model: 'm' }, 'nonsense']) {
    const { ctx } = stubContext({ rows: ROWS, providers: PROVIDERS, defaultSelection: unusable })
    assert.equal(describeProviders(ctx, config).default, null, `published ${JSON.stringify(unusable)}`)
  }
})

test('the route refuses methods and foreign pages', async () => {
  const { ctx, routes } = stubContext({ rows: ROWS, providers: PROVIDERS })
  apply(ctx)
  const route = routes.get(PATH)

  assert.equal((await call(route, { method: 'POST' })).status, 405)
  assert.equal((await call(route, { host: 'example.com:443' })).body.error, 'not-this-page')
  assert.equal((await call(route, { origin: 'https://example.com' })).status, 403)
  // A same-origin request with no Origin (some fetch paths) is still served.
  assert.equal((await call(route, { origin: null })).status, 200)
})

test('an exploding registry degrades to an empty, non-fatal answer', async () => {
  const { ctx, routes } = stubContext({ throwing: true })
  apply(ctx)
  const reply = await call(routes.get(PATH))
  assert.equal(reply.status, 200)
  assert.deepEqual(reply.body.value.providers, [])
})

test('a composition without the web server simply registers nothing', () => {
  const { ctx, routes } = stubContext({ rows: ROWS, providers: PROVIDERS, withWebServer: false })
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(routes.size, 0)
})

test('unloading removes the route', () => {
  const { ctx, routes } = stubContext({ rows: ROWS, providers: PROVIDERS })
  // The route is registered by the child plugin `ctx.inject` starts, so that
  // child is what owns its disposal — exactly as in cordis. Disposing it must
  // leave no listener behind. This test is the bundle's only guarantee that an
  // uninstalled plugin stops answering on a path it no longer serves.
  const captured = []
  const tracking = {
    ...ctx,
    inject(names, callback) {
      const handle = ctx.inject(names, callback)
      captured.push(handle)
      return handle
    },
  }
  apply(tracking)
  assert.equal(routes.has(PATH), true)
  assert.equal(captured.length, 1, 'the plugin must start exactly one child for the route')
  for (const handle of captured) handle.dispose?.()
  assert.equal(routes.has(PATH), false)
})

test('a malformed config falls back to defaults instead of failing', () => {
  const { ctx, routes } = stubContext({ rows: ROWS, providers: PROVIDERS })
  assert.doesNotThrow(() => apply(ctx, { overrides: { 'x': 'nonsense' } }))
  assert.equal(routes.has(PATH), true)
})

test('effectiveConfig fills every default from a partial or malformed row', () => {
  const defaults = effectiveConfig(undefined)
  assert.equal(defaults.enabled, true)
  assert.deepEqual(defaults.shortNames, {})
  assert.deepEqual(defaults.overrides, {})
  assert.deepEqual(defaults.coreNamespaces, ['llm-pi-ai', 'llm-deepseek', 'llm-deepseek-account'])

  // Naming ONE key must not drop the other defaults: a patch replaces the
  // whole config object, so the rest has to survive on its own.
  const partial = effectiveConfig({ shortNames: { 'volcano-api': '火山' } })
  assert.equal(partial.enabled, true)
  assert.deepEqual(partial.coreNamespaces, defaults.coreNamespaces)

  // Unusable values are dropped, not thrown on.
  const junk = effectiveConfig({
    enabled: 'yes',
    shortNames: { a: 1, b: 'B', '': 'empty' },
    overrides: { a: 'nonsense', b: 'hide' },
    coreNamespaces: [null, '  ', 'llm-x'],
  })
  assert.equal(junk.enabled, true, 'only an explicit false disables')
  assert.deepEqual(junk.shortNames, { b: 'B' })
  assert.deepEqual(junk.overrides, { b: 'hide' })
  assert.deepEqual(junk.coreNamespaces, ['llm-x'])

  assert.equal(effectiveConfig({ enabled: false }).enabled, false)
})
