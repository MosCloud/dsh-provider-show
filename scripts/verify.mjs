#!/usr/bin/env node
/**
 * Static verification for the dsh-provider-show bundle.
 *
 * Run with `node scripts/verify.mjs`. Exits non-zero on the first failed check.
 * Every check restates a rule that would otherwise only be visible as a broken
 * plugin at runtime, so a green run is the strongest evidence available without
 * installing the bundle.
 */

import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const passes = []

/**
 * Record one assertion.
 *
 * @param {string} name - what is being checked.
 * @param {() => void} check - throws when the rule is broken.
 * @returns {void}
 */
function check(name, check_) {
  try {
    check_()
    passes.push(name)
  } catch (error) {
    failures.push(`${name}\n    ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Assert a condition with a message that names the rule.
 *
 * @param {unknown} condition - truthy when satisfied.
 * @param {string} message - what went wrong.
 * @returns {void}
 */
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/**
 * Read and parse one JSON file.
 *
 * @param {string} relative - path relative to the package root.
 * @returns {any} parsed JSON.
 */
function json(relative) {
  return JSON.parse(readFileSync(join(ROOT, relative), 'utf8'))
}

/**
 * Read one text file.
 *
 * @param {string} relative - path relative to the package root.
 * @returns {string} file contents.
 */
function text(relative) {
  return readFileSync(join(ROOT, relative), 'utf8')
}

const pkg = json('package.json')

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

check('package.json declares the bundle patch', () => {
  assert(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch must point at ./cordis.patch.yml')
  assert(existsSync(join(ROOT, pkg.dsh.bundle.patch)), 'the declared patch file does not exist')
})

check('package.json declares a web client half', () => {
  assert(pkg.dsh?.client?.platform === 'web', 'dsh.client.platform must be "web"')
  assert(existsSync(join(ROOT, 'lib/client.js')), 'lib/client.js is missing')
  assert(pkg.exports['./client'] === './lib/client.js', 'exports["./client"] must point at lib/client.js')
})

check('every runtime file appears in `files`', () => {
  const listed = new Set(pkg.files)
  for (const required of ['lib', 'locale', 'icon.svg', 'cordis.patch.yml', 'README.md']) {
    assert(listed.has(required), `files[] is missing ${required}`)
  }
})

check('exports cover the locale and icon subpaths the loader reads', () => {
  assert(pkg.exports['./locale/*.json'] === './locale/*.json', 'locale subpath is not exported')
  assert(typeof pkg.icon === 'string' && existsSync(join(ROOT, pkg.icon)), 'a package-root icon must exist')
})

// ---------------------------------------------------------------------------
// Display metadata (Plugin Manager reads these without activating the plugin)
// ---------------------------------------------------------------------------

check('locale files carry a non-placeholder title and description', () => {
  for (const locale of ['en', 'zh']) {
    const dict = json(`locale/${locale}.json`)
    const title = dict.meta?.title
    const description = dict.meta?.description
    assert(typeof title === 'string' && title.trim().length > 0, `${locale}: meta.title is empty`)
    assert(typeof description === 'string' && description.length > 20, `${locale}: meta.description is too short`)
    assert(!/my-|template|example|placeholder/i.test(title), `${locale}: meta.title still holds template copy`)
  }
})

check('the icon is a valid, small SVG inside the package', () => {
  const raw = text('icon.svg')
  assert(raw.trimStart().startsWith('<svg'), 'icon.svg does not start with <svg')
  assert(raw.includes('</svg>'), 'icon.svg does not close')
  assert(raw.includes('viewBox'), 'icon.svg has no viewBox, so it cannot scale')
  const bytes = statSync(join(ROOT, 'icon.svg')).size
  assert(bytes > 200, 'icon.svg looks empty')
  assert(bytes < 256 * 1024, 'icon.svg exceeds the 256 KiB icon limit')
})

// ---------------------------------------------------------------------------
// Patch
// ---------------------------------------------------------------------------

check('the patch inserts exactly one row named after the package', () => {
  const patch = text('cordis.patch.yml')
  const inserts = patch.split('\n').filter((line) => /^\s*-\s*insert:/.test(line))
  assert(inserts.length === 1, `expected one insert block, found ${inserts.length}`)
  assert(patch.includes(`name: ${pkg.name}`), 'the inserted row does not name this package')
  assert(patch.includes(`id: ${pkg.name}`), 'the inserted row id does not match the package name')
})

// ---------------------------------------------------------------------------
// Client bundle: the module-loader contract
// ---------------------------------------------------------------------------

check('the client bundle registers through __ModuleLoader__ with the package id', () => {
  const source = text('lib/client.js')
  assert(source.includes('window.__ModuleLoader__.load('), 'client.js does not call __ModuleLoader__.load')
  assert(source.includes(`id: '${pkg.name}'`), 'the registered module id does not match the package name')
})

check('the client bundle requires no DSH Client package', () => {
  const source = text('lib/client.js')
  const requires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1])
  for (const specifier of requires) {
    assert(
      !specifier.startsWith('@deepseek-ai/'),
      `client.js requires "${specifier}"; a plain-JS plugin must not load Harness Client packages`,
    )
  }
  assert(requires.includes('react'), 'client.js never requires react, so it cannot render')
})

check('the client half registers into conversation.input.right with its own id', () => {
  const source = text('lib/client.js')
  assert(source.includes(`'conversation.input.right'`), 'the slot key is not spelled conversation.input.right')
  assert(!source.includes(`'conversation.input.model.label'`), 'this plugin must not claim the single model-label cell')
  assert(/id:\s*ENTRY_ID/.test(source), 'the registration uses no stable entry id')
})

check('the client half declares only services it can obtain', () => {
  const source = text('lib/client.js')
  const match = source.match(/inject:\s*(\[[^\]]*\])/)
  assert(match !== null, 'the client plugin declares no inject list')
  const declared = JSON.parse(match[1].replace(/'/g, '"'))
  for (const service of declared) {
    assert(['slots', 'locale'].includes(service), `client declares "${service}", which this design does not use`)
  }
})

// ---------------------------------------------------------------------------
// Styles: theme tokens only
// ---------------------------------------------------------------------------

check('the client stylesheet uses theme tokens and no literal colours', () => {
  const source = text('lib/client.js')
  const cssStart = source.indexOf('const CSS = [')
  const cssEnd = source.indexOf('].join', cssStart)
  assert(cssStart !== -1 && cssEnd !== -1, 'the CSS block is not recognisable')
  const css = source.slice(cssStart, cssEnd)
  assert(css.includes('var(--dsw-alias-'), 'the stylesheet references no theme token')
  const literals = css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)
  assert(literals === null, `the stylesheet hard-codes a colour: ${literals?.join(', ')}`)
})

check('the client stylesheet bounds its width', () => {
  const source = text('lib/client.js')
  assert(/max-width:\s*\d+px/.test(source), 'the chip has no max-width, so it can starve the model seat')
  assert(source.includes('text-overflow:ellipsis'), 'the chip does not ellipsise a long provider name')
})

/**
 * The chip's `const CSS = [...]` block, joined the way the bundle joins it.
 *
 * Comments are stripped first. They legitimately quote CSS property text (for
 * example explaining which size the trigger uses), and a naive string scan would
 * let a COMMENT satisfy an assertion about the stylesheet — the check would pass
 * while the rule was wrong.
 */
function chipCss() {
  const source = text('lib/client.js')
  const start = source.indexOf('const CSS = [')
  const end = source.indexOf('].join', start)
  assert(start !== -1 && end !== -1, 'the CSS block is not recognisable')
  const withoutComments = source.slice(start, end).replace(/\/\/[^\n]*/g, '')
  return [...withoutComments.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((match) => match[1]).join('')
}

check('the chip copies the model trigger typography and line box', () => {
  const css = chipCss()
  // The trigger (`ModelSelect.module.css`) is 13px / weight 400 / line-height
  // 20px / height 28px / align-items:center, and declares no font-family (it
  // inherits). The chip reproduces all of it, so the two labels share one
  // baseline and one type scale; matching only the centre line leaves a
  // sub-pixel offset that reads as "the text sits high".
  assert(css.includes('height:28px'), 'the chip does not take the trigger height')
  assert(css.includes('line-height:20px'), 'the chip does not take the trigger line box')
  assert(css.includes('align-items:center'), 'the chip does not centre its text')
  assert(css.includes('font-size:13px'), 'the chip invents a different type size than the trigger')
  assert(css.includes('font-weight:400'), 'the chip invents a different weight than the trigger')
  assert(!css.includes('font-family'), 'the chip must inherit the font family, not pick one')
})

check('the chip aligns by matched metrics, not by a vertical shift', () => {
  const css = chipCss()
  const source = text('lib/client.js')
  // A 2x screenshot measured the Han ink centroid 1.85 CSS px LOW once nudged,
  // and level with the Latin centroid at zero. Any translateY here would be a
  // regression dressed up as a fix, so the rule is: no shift at all.
  // Match the CALL, not the word: the surrounding comments explain why the
  // shift was removed and legitimately name it.
  assert(!css.includes('translateY('), 'the stylesheet shifts the label vertically')
  assert(!source.includes('translateY('), 'the client applies a vertical shift')
  assert(!source.includes('actualBoundingBox'), 'a per-script measurement is back; it was measured wrong')
})

check('the composed provider-to-model gap is tight', () => {
  const css = chipCss()
  // The arithmetic this plugin is compensating for, from the host stylesheets:
  //   .standardControls { gap: 12px }        (ui-conversation InputBar.module.css)
  //   .trigger          { padding-left: 8px } (ui-model-selection ModelSelect.module.css)
  // so an unpadded chip sits ~20px from the model text. Our own padding must be
  // zero and a negative margin must remove most of the host gap.
  assert(!/padding:0 2px/.test(css), 'the chip adds its own horizontal padding on top of the host gap')
  const margin = /margin-inline-end:\s*(-?\d+(?:\.\d+)?)px/.exec(css)
  assert(margin !== null, 'the chip does not offset the host row gap')
  const shift = Math.abs(Number(margin[1]))
  assert(margin[1].startsWith('-'), 'the gap offset must be a negative margin')
  const effective = 12 + 8 + 0 - shift
  assert(effective >= 6 && effective <= 12, `the provider/model gap would be ${effective}px; keep it between 6 and 12px`)
})

// ---------------------------------------------------------------------------
// Host half
// ---------------------------------------------------------------------------

check('the host half registers a read-only GET route under /plugins/', () => {
  const source = text('lib/index.js')
  assert(source.includes(`const PROVIDERS_PATH = '/plugins/`), 'the route is not namespaced under /plugins/')
  assert(source.includes("kind: 'exact'"), 'the route is not registered as an exact path')
  assert(source.includes("req.method !== 'GET'"), 'the route does not reject non-GET methods')
})

check('the host half registers the route inside a disposer scope', () => {
  const source = text('lib/index.js')
  // A plugin's RETURN VALUE is discarded by the Loader; only an effect disposer
  // runs on unload. Returning `webServer.register(...)` would register the route
  // and then leak it forever, so the registration must sit inside an effect.
  assert(
    /scope\.effect\(\(\) => webServer\.register\(/.test(source),
    'the route is not owned by scope.effect, so unload would leak it',
  )
  assert(
    !/\n\s*return webServer\.register\(/.test(source),
    'index.js returns the route disposer from the inject callback; the Loader discards it',
  )
})

check('the host half waits for the web server instead of probing once', () => {
  const source = text('lib/index.js')
  assert(/ctx\.inject\(\['webServer'\]/.test(source), 'apply() does not await the webServer service')
})

check('the host half publishes the deployment default the seat falls back to', () => {
  const source = text('lib/index.js')
  // Which provider is in effect is `pending → last request header → deployment
  // default`. The projection carries the first two; only the Host can read the
  // third, so the document has to carry it or a brand-new Session shows nothing.
  assert(source.includes("ctx.get('agentDefaultModel')"), 'index.js never reads the agentDefaultModel service')
  assert(source.includes('currentSelection'), 'index.js never asks that service for its selection')
  assert(/default:\s*readDefaultSelection\(ctx\)/.test(source), 'describeProviders does not publish the default')
  assert(!source.includes("from '@deepseek-ai/dsh-agent-default-model'"), 'the service must be read through ctx, not imported')
})

check('the client half takes the default from the document, never from its own copy', () => {
  // Comments are stripped first: the component DOCUMENTS which Host service the
  // default comes from, and a naive scan would read that explanation as code.
  const source = text('lib/client.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert(
    /selection\?\.next\?\.provider\s*\?\?\s*document\?\.default\?\.provider/.test(source),
    'the client does not fall back to the document default, so a new Session shows no provider',
  )
  assert(
    !/document\?\.default\?\.provider\s*\?\?\s*selection/.test(source),
    'the default must not outrank an explicit selection',
  )
  assert(!source.includes('agentDefaultModel'), 'client.js reaches for a Host service it cannot see')
})

check('the host half resolves its own config without importing a schema library', () => {
  const source = text('lib/index.js')
  // A bundle installed by linking this directory resolves imports through the
  // profile's node_modules, which does NOT contain the shipped Harness packages.
  // A hard `import Schema from '@deepseek-ai/schemastery'` therefore fails the
  // whole Host half, so the defaults are applied here instead.
  assert(!source.includes("from '@deepseek-ai/schemastery'"), 'index.js imports schemastery, which a linked install cannot resolve')
  assert(source.includes('export function effectiveConfig'), 'no effectiveConfig export')
  assert(source.includes('export const CONFIG_KEYS'), 'the config shape is not documented for patch authors')
  const ownership = text('lib/ownership.js')
  for (const key of ['enabled', 'shortNames', 'overrides', 'coreNamespaces']) {
    assert(source.includes(`${key}`), `effectiveConfig ignores ${key}`)
  }
  void ownership
})

// ---------------------------------------------------------------------------
// Ownership rule: one implementation
// ---------------------------------------------------------------------------

check('the ownership rule lives in exactly one module', () => {
  const ownership = text('lib/ownership.js')
  for (const fn of ['resolveOwnership', 'shouldRender', 'providerLabel', 'normalizeNamespaces']) {
    assert(ownership.includes(`export function ${fn}`), `lib/ownership.js does not export ${fn}`)
  }
  const client = text('lib/client.js')
  assert(!client.includes('function resolveOwnership'), 'client.js re-implements the ownership rule')
  const host = text('lib/index.js')
  assert(host.includes("from './ownership.js'"), 'index.js does not import the shared rule')
})

check('ownership.js imports nothing, so both halves can load it', () => {
  const source = text('lib/ownership.js')
  assert(!/^\s*import\s/m.test(source), 'ownership.js must stay dependency-free')
})

check('the core namespace default matches the shipped provider rows', () => {
  const source = text('lib/ownership.js')
  for (const ns of ['llm-pi-ai', 'llm-deepseek', 'llm-deepseek-account']) {
    assert(source.includes(`'${ns}'`), `the default core namespaces are missing ${ns}`)
  }
})

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

for (const name of passes) console.log(`  ok   ${name}`)
if (failures.length > 0) {
  console.error('')
  for (const failure of failures) console.error(`  FAIL ${failure}`)
  console.error(`\n${failures.length} check(s) failed, ${passes.length} passed.`)
  process.exit(1)
}
console.log(`\nAll ${passes.length} checks passed.`)
