/**
 * Tests for the ownership resolver.
 *
 * Run with `node --test test/`. No DSH runtime is involved: the resolver is a
 * pure function of directory rows and configuration, which is exactly what
 * makes the ownership rule testable without a browser.
 */

import test from 'node:test'
import assert from 'node:assert'

import {
  DEFAULT_CORE_NAMESPACES,
  OWNERSHIP,
  findProviderRow,
  normalizeNamespaces,
  providerLabel,
  resolveOwnership,
  shouldRender,
} from '../lib/ownership.js'

/** Directory rows shaped like `llm.listConfigurableProviders()`. */
const PNPM_ROWS = [
  { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
  { provider: 'deepseek-account', displayName: 'DeepSeek Account', settingsNs: 'llm-deepseek-account', settingsPath: [] },
  { provider: 'volcano-api', displayName: '火山方舟', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'volcano-api'] },
  { provider: 'workbuddy', displayName: 'WorkBuddy', settingsNs: 'dsh-connect-workbuddy', settingsPath: [] },
  { provider: 'workbuddy-global', displayName: 'WorkBuddy Global', settingsNs: 'dsh-connect-workbuddy', settingsPath: [] },
]

test('core namespaces cover the shipped Harness routes', () => {
  assert.deepEqual([...DEFAULT_CORE_NAMESPACES].sort(), ['llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai'])
})

test('a user-configured pi-ai route is core, so we show the provider', () => {
  const decision = resolveOwnership({ providerId: 'volcano-api', directoryRows: PNPM_ROWS })
  assert.equal(decision.owner, OWNERSHIP.CORE)
  assert.equal(decision.reason, 'core-namespace')
  assert.equal(decision.displayName, '火山方舟')
})

test('a plugin-registered route yields to the plugin', () => {
  const decision = resolveOwnership({ providerId: 'workbuddy', directoryRows: PNPM_ROWS })
  assert.equal(decision.owner, OWNERSHIP.THIRD_PARTY)
  assert.equal(decision.reason, 'plugin-namespace')
  assert.equal(decision.settingsNs, 'dsh-connect-workbuddy')
})

test('both regions of a two-route connector are recognised', () => {
  for (const providerId of ['workbuddy', 'workbuddy-global']) {
    assert.equal(resolveOwnership({ providerId, directoryRows: PNPM_ROWS }).owner, OWNERSHIP.THIRD_PARTY)
  }
})

test('the official DeepSeek routes stay ours', () => {
  for (const providerId of ['deepseek-official', 'deepseek-account']) {
    assert.equal(resolveOwnership({ providerId, directoryRows: PNPM_ROWS }).owner, OWNERSHIP.CORE)
  }
})

test('a provider absent from the directory fails open to ours', () => {
  const decision = resolveOwnership({ providerId: 'not-yet-loaded', directoryRows: PNPM_ROWS })
  assert.equal(decision.owner, OWNERSHIP.UNKNOWN)
  assert.equal(decision.reason, 'no-directory-row')
  assert.equal(shouldRender(decision, {}), true)
})

test('an unreadable directory fails open to ours', () => {
  for (const rows of [undefined, null, 'nope', [], {}, [null, 42]]) {
    const decision = resolveOwnership({ providerId: 'volcano-api', directoryRows: rows })
    assert.equal(decision.owner, OWNERSHIP.UNKNOWN, `rows=${JSON.stringify(rows)}`)
    assert.equal(shouldRender(decision, {}), true)
  }
})

test('a row without a settings namespace fails open to ours', () => {
  const rows = [{ provider: 'mystery', displayName: 'Mystery' }]
  const decision = resolveOwnership({ providerId: 'mystery', directoryRows: rows })
  assert.equal(decision.owner, OWNERSHIP.UNKNOWN)
  assert.equal(decision.reason, 'no-settings-namespace')
})

test('a configured override outranks the directory evidence', () => {
  const suppressed = resolveOwnership({
    providerId: 'volcano-api',
    directoryRows: PNPM_ROWS,
    overrides: { 'volcano-api': 'third-party' },
  })
  assert.equal(suppressed.owner, OWNERSHIP.THIRD_PARTY)
  assert.equal(suppressed.reason, 'override')

  const forced = resolveOwnership({
    providerId: 'workbuddy',
    directoryRows: PNPM_ROWS,
    overrides: { workbuddy: 'mine' },
  })
  assert.equal(forced.owner, OWNERSHIP.CORE)
  assert.equal(forced.reason, 'override')
})

test('an extended core-namespace list rescues a built-in route we did not know', () => {
  const rows = [{ provider: 'future-official', displayName: 'Future', settingsNs: 'llm-future', settingsPath: [] }]
  assert.equal(resolveOwnership({ providerId: 'future-official', directoryRows: rows }).owner, OWNERSHIP.THIRD_PARTY)
  assert.equal(
    resolveOwnership({ providerId: 'future-official', directoryRows: rows, coreNamespaces: ['llm-future'] }).owner,
    OWNERSHIP.CORE,
  )
})

test('a hide override suppresses without claiming another owner', () => {
  const decision = resolveOwnership({
    providerId: 'volcano-api',
    directoryRows: PNPM_ROWS,
    overrides: { 'volcano-api': 'hide' },
  })
  assert.equal(decision.owner, OWNERSHIP.CORE, 'hide must not reattribute the provider')
  assert.equal(decision.reason, 'override-hidden')
  assert.equal(shouldRender(decision, {}), false)
})

test('shouldRender hides only a confirmed third-party owner', () => {
  const core = { providerId: 'volcano-api', directoryRows: PNPM_ROWS }
  const third = { providerId: 'workbuddy', directoryRows: PNPM_ROWS }
  const unknown = { providerId: 'ghost', directoryRows: PNPM_ROWS }

  assert.equal(shouldRender(resolveOwnership(core), {}), true)
  assert.equal(shouldRender(resolveOwnership(third), {}), false)
  assert.equal(shouldRender(resolveOwnership(unknown), {}), true)

  // `enabled` is a plugin switch, not an ownership decision.
  assert.equal(shouldRender(resolveOwnership(core), { enabled: false }), false)

  // `overrides` is read by resolveOwnership alone; shouldRender must not
  // second-guess it, or the two could disagree about the same table.
  const forced = resolveOwnership({ ...third, overrides: { workbuddy: 'mine' } })
  assert.equal(shouldRender(forced, {}), true)
  const promisedElsewhere = resolveOwnership({ ...core, overrides: { 'volcano-api': 'third-party' } })
  assert.equal(shouldRender(promisedElsewhere, {}), false)
})

test('normalizeNamespaces tolerates every shape configuration can take', () => {
  assert.deepEqual(normalizeNamespaces(undefined), [...DEFAULT_CORE_NAMESPACES])
  assert.deepEqual(normalizeNamespaces('llm-pi-ai'), [...DEFAULT_CORE_NAMESPACES])
  assert.deepEqual(normalizeNamespaces([]), [...DEFAULT_CORE_NAMESPACES])
  assert.deepEqual(normalizeNamespaces([1, null, '  ', true]), [...DEFAULT_CORE_NAMESPACES])
  assert.deepEqual(normalizeNamespaces([' a ', 'a', 'b', '']), ['a', 'b'])
})

test('findProviderRow ignores malformed rows instead of throwing', () => {
  assert.equal(findProviderRow(undefined, 'x'), undefined)
  assert.equal(findProviderRow([{ provider: 'x', settingsNs: 42 }], 'x').settingsNs, undefined)
  assert.equal(findProviderRow([{ provider: 'x' }], 'y'), undefined)
})

test('providerLabel prefers short names, then the catalog name, then the id', () => {
  const base = { providerId: 'volcano-api', displayName: '火山方舟' }
  assert.equal(providerLabel(base), '火山方舟')
  assert.equal(providerLabel({ ...base, shortNames: { 'volcano-api': '火山' } }), '火山')
  assert.equal(providerLabel({ ...base, shortNames: { 'volcano-api': '   ' } }), '火山方舟')
  assert.equal(providerLabel({ providerId: 'bare' }), 'bare')
  assert.equal(providerLabel({ providerId: 'bare', fallbackToId: false }), '')
  assert.equal(providerLabel({}), '')
})
