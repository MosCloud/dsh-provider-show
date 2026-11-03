/**
 * Ownership resolution for the composer's provider chip.
 *
 * The composer's model seat already renders "model name · reasoning effort"
 * itself. What it cannot show is WHICH PROVIDER the selection belongs to,
 * because the catalog name is the only provider-derived text it draws. A
 * third-party plugin may already own a provider's whole presentation (the
 * WorkBuddy connector draws its own supplier chip, credit readout, promotion
 * badge and effort marker in the same row), and duplicating that is worse than
 * staying silent.
 *
 * This module answers exactly one question, as a pure function of directory
 * rows and configuration:
 *
 *     Is this provider's presentation already owned elsewhere?
 *
 * It is deliberately free of DSH imports so it can be unit-tested with plain
 * Node: the Host and Client halves both consume this same function.
 *
 * @module dsh-provider-show/ownership
 */

/**
 * Provider routes the Harness itself registers, keyed by the settings namespace
 * that configures each one.
 *
 * These come from the shipped `dsh-base` bundle patch, where a Loader row's id
 * is also the settings namespace its provider directory entry names:
 * `llm-pi-ai` (user-configured API-key routes), and the two official DeepSeek
 * routes. A provider whose `settingsNs` is one of these is core; anything else
 * means some plugin registered the route under its own namespace.
 *
 * Kept as data rather than a switch so a deployment can extend it through the
 * plugin's Config when a future Harness release adds another built-in route.
 */
export const DEFAULT_CORE_NAMESPACES = Object.freeze([
  'llm-pi-ai',
  'llm-deepseek',
  'llm-deepseek-account',
])

/** The three answers {@link resolveOwnership} can give. */
export const OWNERSHIP = Object.freeze({
  /** Core Harness route: no third-party plugin presents it, so show our chip. */
  CORE: 'core',
  /** Another plugin registered this route and presents it; we stay silent. */
  THIRD_PARTY: 'third-party',
  /** No directory row for this route: treat it as ours (fail-open). */
  UNKNOWN: 'unknown',
})

/**
 * Normalise a configuration list of namespaces.
 *
 * Configuration arrives from YAML, so a missing field, `null`, a scalar, or a
 * list with non-string members must all degrade to the default rather than
 * throwing inside a render path. Duplicates and empty strings are dropped
 * because a namespace is compared by equality.
 *
 * @param {unknown} value - raw configured value.
 * @param {readonly string[]} fallback - list used when nothing usable was given.
 * @returns {string[]} a usable namespace list.
 */
export function normalizeNamespaces(value, fallback = DEFAULT_CORE_NAMESPACES) {
  if (!Array.isArray(value)) return [...fallback]
  const seen = new Set()
  const out = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const name = entry.trim()
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out.length === 0 ? [...fallback] : out
}

/**
 * Read one provider's directory row out of a `listConfigurableProviders()` reply.
 *
 * The remote reply is untrusted JSON (a Host generation may have changed shape),
 * so every field is checked before use.
 *
 * @param {unknown} rows - raw reply.
 * @param {string} providerId - provider route to find.
 * @returns {{ provider: string, displayName?: string, settingsNs?: string, settingsPath?: readonly string[] } | undefined}
 *          the matching row, or undefined when the reply is unusable.
 */
export function findProviderRow(rows, providerId) {
  if (!Array.isArray(rows) || typeof providerId !== 'string' || providerId === '') return undefined
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    if (row.provider !== providerId) continue
    return {
      provider: providerId,
      ...(typeof row.displayName === 'string' && row.displayName !== ''
        ? { displayName: row.displayName }
        : {}),
      ...(typeof row.settingsNs === 'string' && row.settingsNs !== ''
        ? { settingsNs: row.settingsNs }
        : {}),
      ...(Array.isArray(row.settingsPath) ? { settingsPath: row.settingsPath } : {}),
    }
  }
  return undefined
}

/**
 * Decide who presents one provider route.
 *
 * Order of authority, strongest first:
 *
 * 1. The user's explicit override. A person who has looked at the composer and
 *    said "this one is somebody else's" outranks every inference below, because
 *    it is the only signal that cannot be wrong about intent.
 * 2. The directory row's `settingsNs`. A namespace outside the core list means
 *    a plugin registered the route under its own Loader entry id.
 * 3. Fail-open. A route with no row — or a directory that could not be read —
 *    is treated as ours. The asymmetry is deliberate: showing a provider that
 *    was in fact owned elsewhere costs a duplicate label, while hiding one that
 *    was not owned costs the entire feature, silently, for every provider.
 *
 * @param {object} input - resolution input.
 * @param {string} input.providerId - selected provider route.
 * @param {unknown} [input.directoryRows] - `listConfigurableProviders()` reply.
 * @param {readonly string[]} [input.coreNamespaces] - namespaces the Harness owns.
 * @param {Record<string, string>} [input.overrides] - provider id → decision.
 * @returns {{ owner: string, reason: string, settingsNs?: string, displayName?: string }}
 *          the decision plus the evidence that produced it.
 */
export function resolveOwnership(input) {
  const providerId = input?.providerId
  if (typeof providerId !== 'string' || providerId === '') {
    return { owner: OWNERSHIP.UNKNOWN, reason: 'no-provider' }
  }

  const overrides = input.overrides
  const override = overrides !== null && typeof overrides === 'object' && !Array.isArray(overrides)
    ? overrides[providerId]
    : undefined
  if (override === 'third-party') return { owner: OWNERSHIP.THIRD_PARTY, reason: 'override' }
  if (override === 'mine') return { owner: OWNERSHIP.CORE, reason: 'override' }
  // `hide` is not an ownership claim: it says "draw nothing" without asserting
  // that somebody else owns the provider. It rides along on the decision so
  // there is still exactly ONE reader of the overrides table.
  if (override === 'hide') return { owner: OWNERSHIP.CORE, reason: 'override-hidden', hidden: true }

  const row = findProviderRow(input.directoryRows, providerId)
  if (row === undefined) return { owner: OWNERSHIP.UNKNOWN, reason: 'no-directory-row' }

  const core = normalizeNamespaces(input.coreNamespaces)
  const settingsNs = row.settingsNs
  const carries = {
    ...(settingsNs === undefined ? {} : { settingsNs }),
    ...(row.displayName === undefined ? {} : { displayName: row.displayName }),
  }
  if (settingsNs === undefined) {
    return { owner: OWNERSHIP.UNKNOWN, reason: 'no-settings-namespace', ...carries }
  }
  if (core.includes(settingsNs)) {
    return { owner: OWNERSHIP.CORE, reason: 'core-namespace', ...carries }
  }
  return { owner: OWNERSHIP.THIRD_PARTY, reason: 'plugin-namespace', ...carries }
}

/**
 * Whether our chip should render at all for one selection.
 *
 * Three things suppress it, and only three: the plugin switch, an explicit
 * `hide` override, and a confirmed third-party owner. `UNKNOWN` renders, for the
 * reason given on {@link resolveOwnership}: a duplicate label is a cosmetic
 * fault, a missing feature is the whole request.
 *
 * This function deliberately does NOT re-read `overrides`. Every decision that
 * needs that table is made once, inside {@link resolveOwnership}, and arrives
 * here on the decision object — two readers of one table could disagree after an
 * edit, and the disagreement would be invisible until a user saw it.
 *
 * @param {{ owner: string, hidden?: boolean }} decision - result of {@link resolveOwnership}.
 * @param {{ enabled?: boolean }} [config] - plugin configuration.
 * @returns {boolean} whether to draw the chip.
 */
export function shouldRender(decision, config = {}) {
  if (config?.enabled === false) return false
  if (decision?.hidden === true) return false
  return decision?.owner !== OWNERSHIP.THIRD_PARTY
}

/**
 * The text our chip shows for one provider.
 *
 * Model name and reasoning effort are already drawn by the composer's own model
 * seat, so repeating them here would print each fact twice in one row. The chip
 * therefore carries the one missing fact: the provider.
 *
 * @param {object} input - label input.
 * @param {string} input.providerId - selected provider route.
 * @param {string} [input.displayName] - provider name from the directory row.
 * @param {Record<string, string>} [input.shortNames] - configured short names.
 * @returns {string} the label, or an empty string when nothing usable exists.
 */
export function providerLabel(input) {
  const providerId = input?.providerId
  const shortNames = input?.shortNames
  if (shortNames !== null && typeof shortNames === 'object' && !Array.isArray(shortNames)) {
    const short = typeof providerId === 'string' ? shortNames[providerId] : undefined
    if (typeof short === 'string' && short.trim() !== '') return short.trim()
  }
  const displayName = input?.displayName
  if (typeof displayName === 'string' && displayName.trim() !== '') return displayName.trim()
  // A provider id is the last resort: it is always present and always accurate,
  // and showing `volcano-cn` beats showing an empty chip. Callers that would
  // rather show nothing pass fallbackToId: false.
  if (input?.fallbackToId === false) return ''
  return typeof providerId === 'string' ? providerId : ''
}
