/**
 * Behavioural test for the Client half.
 *
 * Runs the real `lib/client.js` bundle in plain Node against a stubbed React and
 * a stubbed Host reply, then asserts what the component returns. This is the
 * closest thing to rendering the composer without a browser: the module-loader
 * contract, the slot registration, the projection read, the fetch, and the
 * decision lookup all execute for real.
 */

import test from 'node:test'
import assert from 'node:assert'

/** A Host reply shaped exactly like the route's document. */
const DOCUMENT = {
  ok: true,
  value: {
    enabled: true,
    coreNamespaces: ['llm-pi-ai', 'llm-deepseek', 'llm-deepseek-account'],
    providers: [
      // A user-configured pi-ai route: ours to label.
      { provider: 'huoshan', displayName: '火山API', label: '火山API', visible: true, owner: 'core', reason: 'core-namespace' },
      // A plugin-owned provider: suppressed.
      { provider: 'workbuddy', displayName: 'WorkBuddy', label: 'WorkBuddy', visible: false, owner: 'third-party', reason: 'plugin-namespace' },
      // An override that renames the label.
      { provider: 'short-name', displayName: 'A Very Long Provider Name', label: '短名', visible: true, owner: 'core', reason: 'core-namespace' },
      // A Han label next to Latin ones, which is where the baseline mismatch shows.
      { provider: 'volcano-han', displayName: '火山API', label: '火山API', visible: true, owner: 'core', reason: 'core-namespace' },
      // The Latin control case for the same check.
      { provider: 'deepseek-official', displayName: 'DeepSeek Account', label: 'DeepSeek Account', visible: true, owner: 'core', reason: 'core-namespace' },
    ],
  },
}

/**
 * Build the browser globals the bundle expects, install a stub React, and load
 * `lib/client.js`. Returns the registered component and slot options.
 *
 * @param {object} [options] - stub options.
 * @param {unknown} [options.document] - the Host reply to serve.
 * @param {boolean} [options.fetchFails] - make the fetch reject.
 * @returns {Promise<{ opts: object, component: Function, styles: object[], reset: () => void, runEffects: () => void }>}
 *          the registered surface plus test controls.
 */
async function loadClient({ document = DOCUMENT, fetchFails = false, inkBoxes = null } = {}) {
  const styles = []
  // A canvas stub whose `measureText` reports the ink box for a string. Passing
  // `inkBoxes` opts a test into the measured-offset path; omitting it simulates a
  // client without Canvas, which must fall back to the stylesheet constant.
  const canvas = inkBoxes === null ? { getContext: () => null } : {
    getContext: () => ({
      font: '',
      measureText(text) {
        const box = inkBoxes(text)
        return {
          actualBoundingBoxAscent: box.ascent,
          actualBoundingBoxDescent: box.descent,
        }
      },
    }),
  }
  globalThis.document = {
    querySelector: () => null,
    createElement: (tag) => (tag === 'canvas' ? canvas : { dataset: {}, textContent: '' }),
    head: { appendChild: (tag) => styles.push(tag) },
  }
  globalThis.window = { __ModuleLoader__: { load(registration) { globalThis.window.__registration = registration } } }
  globalThis.fetch = async () => {
    if (fetchFails) throw new Error('network down')
    return { ok: true, json: async () => document }
  }

  // A React stub with real useState/useEffect semantics, so the effect → state
  // → re-render loop behaves like the real thing rather than being elided.
  const cells = []
  const effectQueue = []
  let cursor = 0
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState(initial) {
      const index = cursor++
      if (cells[index] === undefined) cells[index] = initial
      return [cells[index], (next) => {
        cells[index] = typeof next === 'function' ? next(cells[index]) : next
      }]
    },
    useEffect(fn) {
      effectQueue.push(fn)
    },
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }

  const modulePath = new URL('../lib/client.js', import.meta.url).pathname
  // Cache-bust so each test starts from a fresh module instance (the bundle
  // keeps a module-level directory cache).
  await import(`${modulePath}?t=${Math.random()}`)
  const registration = globalThis.window.__registration
  const exports = registration.factory((specifier) => {
    if (specifier === 'react') return React
    throw new Error(`client bundle required an unexpected module: ${specifier}`)
  })

  let registered
  exports.apply({
    effect: (fn) => {
      fn()
      return () => {}
    },
    locale: { register: () => () => {} },
    slots: {
      inject: (_name, callback) => {
        callback()
        return () => {}
      },
      register: (options, component) => {
        registered = { opts: options, component }
        return () => {}
      },
    },
  })

  return {
    ...registered,
    styles,
    /**
     * Begin a FRESH mount. A real React mount starts with empty state; the stub
     * has to clear its cells explicitly, or a previous mount's loaded document
     * leaks into the next one and the "must not render before the document
     * arrives" assertion becomes meaningless.
     */
    startMount() {
      cells.length = 0
      cursor = 0
      effectQueue.length = 0
    },
    /** Reset hook cursors between two renders of the SAME mount. */
    reset() {
      cursor = 0
      effectQueue.length = 0
    },
    runEffects() {
      for (const fn of effectQueue) fn()
    },
  }
}

/** The `t` the slot provides, resolving keys the way the locale service would. */
const t = (key, params) => `${key}|${params.provider}`

/**
 * Render the component once, run its effects, then render again — the shape of a
 * mount followed by the state update its fetch causes.
 *
 * @param {object} client - the loaded client surface.
 * @param {string} providerId - provider the projection reports.
 * @returns {Promise<object | null>} the final element.
 */
async function mount(client, providerId) {
  const props = () => ({
    useProjection: () => ({ next: { provider: providerId, model: 'a-model' } }),
    sessionId: 'session-1',
    t,
  })
  client.startMount()
  const first = client.component(props())
  assert.equal(first, null, 'nothing may render before the document arrives')
  client.runEffects()
  await new Promise((resolve) => setTimeout(resolve, 30))
  client.reset()
  return client.component(props())
}

test('the bundle registers the chip into the right slot with its own id', async () => {
  const client = await loadClient()
  assert.equal(client.opts.name, 'conversation.input.right')
  assert.equal(client.opts.id, 'dsh-provider-show-provider')
  assert.equal(client.opts.locale, 'dsh-provider-show')
})

test('a core provider renders its label', async () => {
  const client = await loadClient()
  const element = await mount(client, 'huoshan')
  assert.notEqual(element, null, 'a core provider must render')
  assert.equal(element.props.className, 'dpsp-root')
  assert.equal(element.children[0].children[0], '火山API')
})

test('a plugin-owned provider renders nothing at all', async () => {
  const client = await loadClient()
  assert.equal(await mount(client, 'workbuddy'), null)
})

test('a configured short name is what the chip shows', async () => {
  const client = await loadClient()
  const element = await mount(client, 'short-name')
  assert.equal(element.children[0].children[0], '短名')
})

test('no selection renders nothing', async () => {
  const client = await loadClient()
  client.startMount()
  const element = client.component({
    useProjection: () => ({ lastUsed: null, next: null }),
    sessionId: 'session-1',
    t,
  })
  assert.equal(element, null)
})

test('an unknown provider renders nothing', async () => {
  const client = await loadClient()
  assert.equal(await mount(client, 'not-in-directory'), null)
})

test('an unreachable Host degrades to rendering nothing', async () => {
  const client = await loadClient({ fetchFails: true })
  assert.equal(await mount(client, 'huoshan'), null)
})

test('the stylesheet is installed once and uses theme tokens', async () => {
  const client = await loadClient()
  await mount(client, 'huoshan')
  assert.equal(client.styles.length, 1, 'exactly one style tag')
  const css = client.styles[0].textContent
  assert.ok(css.includes('var(--dsw-alias-'), 'the chip must colour itself with theme tokens')
  assert.ok(css.includes('max-width'), 'the chip must bound its width')
})

test('the chip copies the model trigger line box so the labels share a baseline', async () => {
  const client = await loadClient()
  await mount(client, 'huoshan')
  const css = client.styles[0].textContent
  // The model trigger is 28px tall with a 20px line box and centres its content.
  // A chip that matches only the centre line still renders a fraction of a pixel
  // high, because a 12px glyph in an 18px box sits differently from a 13px glyph
  // in a 20px box. Copying the full box is what removes that.
  assert.ok(css.includes('height:28px'), 'the chip must take the trigger height')
  assert.ok(css.includes('line-height:20px'), 'the chip must take the trigger line box')
  assert.ok(css.includes('align-items:center'), 'the chip must centre its text in that box')
})

test('the chip offsets the host row gap so the pair reads as one line', async () => {
  const client = await loadClient()
  await mount(client, 'huoshan')
  const css = client.styles[0].textContent
  // .standardControls spaces children 12px apart and the model trigger adds 8px
  // of leading padding; without a negative margin the two labels sit ~20px apart.
  const margin = /margin-inline-end:\s*(-\d+(?:\.\d+)?)px/.exec(css)
  assert.notEqual(margin, null, 'the chip must pull itself toward the model trigger')
  const shift = Math.abs(Number(margin[1]))
  assert.ok(shift >= 6 && shift <= 12, `the offset must be between 6px and 12px, got ${shift}px`)
  assert.ok(!css.includes('padding:0 2px'), 'the chip must not add its own horizontal padding')
})

test('a Han label is marked for the optical nudge, a Latin one is not', async () => {
  const client = await loadClient()
  // Han ideographs fill the em box and sit high on a Latin baseline: measured
  // ink centre is about 2px higher than Latin text at 12px, so a Han label
  // beside the Latin model name looks off-centre unless it is nudged.
  const han = await mount(client, 'volcano-han')
  assert.equal(han.props['data-cjk'], 'true')

  const huoshan = await mount(client, 'huoshan')
  assert.equal(huoshan.props['data-cjk'], 'true', '火山API is Han, so it is nudged')

  const latin = await mount(client, 'deepseek-official')
  assert.equal(latin.props['data-cjk'], 'false', 'a Latin label must not be nudged')

  const fullwidth = await mount(client, 'short-name')
  assert.equal(fullwidth.props['data-cjk'], 'true', 'the short name is Han too')
})

test('a Han label is shifted by the MEASURED ink difference', async () => {
  // Latin reference "Hp" spans [-9, +3] around the baseline; Han text spans
  // [-11, +1]. Their ink centres are 2px apart, so the label must move down 2px.
  const client = await loadClient({
    inkBoxes: (text) => (text === 'Hp' ? { ascent: 9, descent: 3 } : { ascent: 11, descent: 1 }),
  })
  const han = await mount(client, 'volcano-han')
  assert.equal(han.props['data-cjk'], 'true')
  assert.equal(han.children[0].props.style.transform, 'translateY(2px)')
})

test('a Latin label is never shifted, even when a canvas is available', async () => {
  const client = await loadClient({
    inkBoxes: (text) => (text === 'Hp' ? { ascent: 9, descent: 3 } : { ascent: 11, descent: 1 }),
  })
  const latin = await mount(client, 'deepseek-official')
  assert.equal(latin.props['data-cjk'], 'false')
  assert.equal(latin.children[0].props.style, undefined, 'Latin labels keep the model baseline')
})

test('without Canvas the stylesheet fallback still applies', async () => {
  const client = await loadClient({ inkBoxes: null })
  const han = await mount(client, 'volcano-han')
  // No inline transform: the `[data-cjk="true"]` rule carries the constant, so
  // the label is still corrected rather than left visibly high.
  assert.equal(han.props['data-cjk'], 'true')
  assert.equal(han.children[0].props.style, undefined)
})

test('absurd measurements are clamped instead of moving the label off-row', async () => {
  const client = await loadClient({
    inkBoxes: (text) => (text === 'Hp' ? { ascent: 4, descent: 4 } : { ascent: 60, descent: 0 }),
  })
  const han = await mount(client, 'volcano-han')
  const value = Number(/translateY\((-?[\d.]+)px\)/.exec(han.children[0].props.style.transform)[1])
  assert.ok(Math.abs(value) <= 2, `the shift must stay within ±2px, got ${value}px`)
})

test('the nudge is a sub-3px downward shift, not a re-layout', async () => {
  const client = await loadClient()
  await mount(client, 'volcano-han')
  const css = client.styles[0].textContent
  const rule = /\.dpsp-root\[data-cjk="true"\]\s*\.dpsp-name\{([^}]*)\}/.exec(css)
  assert.notEqual(rule, null, 'the stylesheet has no CJK rule')
  const shift = /translateY\(([\d.]+)px\)/.exec(rule[1])
  assert.notEqual(shift, null, 'the CJK rule does not shift the text')
  const px = Number(shift[1])
  // Calibrated empirically on the desktop build: 0px reads high, 2px reads low,
  // so the usable range is narrow. Anything outside it overshoots one way or the
  // other and the label stops looking level with the Latin model name.
  assert.ok(px >= 0.5 && px <= 2.5, `the nudge must stay between 0.5px and 2.5px, got ${px}px`)
})
