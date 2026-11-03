window.__ModuleLoader__.load({
  id: 'dsh-provider-show',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect } = React

    const NS = 'dsh-provider-show'
    const SLOT = 'conversation.input.right'
    const ENTRY_ID = 'dsh-provider-show-provider'

    /**
     * The Host half's read-only document.
     *
     * Every ownership decision is already made there — this half performs a
     * lookup, never a rule. That asymmetry is deliberate: the rule needs the
     * Host's LLM directory (`settingsNs`), which the browser cannot see, and
     * one authoritative copy cannot drift from itself.
     */
    const PROVIDERS_PATH = '/plugins/dsh-provider-show/providers'

    /** How long one document is reused, in milliseconds. */
    const CACHE_MS = 5000

    const zh = {
      'chip.aria': '当前供应商：{provider}',
      'meta.title': '供应商信息补全',
      'meta.description': '在输入框右下角补全当前模型所属的供应商；已被其他插件接管的供应商不再重复显示。',
    }
    const en = {
      'chip.aria': 'Current provider: {provider}',
      'meta.title': 'Provider Label',
      'meta.description': 'Shows which provider the selected model belongs to in the composer row, and stays silent for a provider another plugin already presents.',
    }

    /**
     * Scripts whose glyphs fill the em box and therefore sit high on a Latin
     * baseline.
     *
     * Han ideographs occupy roughly [-0.88em, +0.12em] around the baseline,
     * while Latin text with a descender occupies [-0.75em, +0.25em]. On one
     * shared baseline that puts the CJK ink centre about 1.6–2px higher at
     * 12px, which reads as "this label is not vertically centred" whenever it
     * sits next to Latin text — the composer's model name, in this case.
     *
     * Measured on this machine with the fonts the app actually falls back to
     * (`-apple-system` for Latin, the PingFang/Hiragino chain for Han):
     *
     *   "DeepSeek Account" / "opencode-go"  ink −9 → +3, centre −3.0
     *   "火山API"                            ink −11 → +1, centre −5.0
     */
    const CJK = /[\u2E80-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/

    /** The chip's own stylesheet; theme tokens only, so light/dark both work. */
    const CSS = [
      // The model trigger is `height:28px` with a `line-height:20px` box. Copying
      // BOTH metrics is what makes the two labels share one baseline; matching
      // only the centre line leaves a sub-pixel offset that reads as "the
      // provider text sits high".
      '.dpsp-root{display:inline-flex;align-items:center;box-sizing:border-box;',
      'height:28px;min-width:0;max-width:120px;padding:0;',
      // The row spaces its children 12px apart, and the model trigger carries
      // 8px of its own leading padding, so an unpadded chip would sit ~20px from
      // the model text. Pulling the pair together makes them read as one line.
      'margin-inline-end:-10px;',
      'font-size:12px;line-height:20px;',
      'color:var(--dsw-alias-label-tertiary);white-space:nowrap;user-select:none}',
      '.dpsp-name{min-width:0;overflow:hidden;text-overflow:ellipsis}',
      // Optical correction for scripts that sit high on a Latin baseline. The
      // shift moves the CJK ink box onto the Latin one instead of leaving the
      // shared baseline as the only alignment.
      '.dpsp-root[data-cjk="true"] .dpsp-name{transform:translateY(2px)}',
    ].join('')

    /**
     * Mount the stylesheet once.
     *
     * @returns {() => void} the disposer that removes it on unload.
     */
    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      const tagId = 'dsh-provider-show/chip.css'
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-provider-show'
      tag.dataset.pluginCss = tagId
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    /**
     * Last document read from the Host, shared by every mounted composer so a
     * session switch reuses one answer instead of re-asking.
     */
    const cache = { value: undefined, at: 0, inflight: undefined }

    /**
     * Read the Host's provider document, at most once per cache window.
     *
     * Any failure returns `undefined`, which the component renders as "draw
     * nothing": a missing label is a smaller fault than a wrong one, and this
     * path only runs when the Host is unreachable anyway.
     *
     * @returns {Promise<{ providers: Array<object>, enabled: boolean } | undefined>} the document.
     */
    async function readDocument() {
      const now = Date.now()
      if (cache.value !== undefined && now - cache.at < CACHE_MS) return cache.value
      if (cache.inflight !== undefined) return cache.inflight
      const operation = (async () => {
        try {
          const response = await fetch(PROVIDERS_PATH, {
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
          })
          if (!response.ok) return undefined
          const body = await response.json()
          if (body?.ok !== true) return undefined
          const value = body.value
          if (value === null || typeof value !== 'object' || !Array.isArray(value.providers)) return undefined
          cache.value = value
          cache.at = Date.now()
          return value
        } catch {
          return undefined
        }
      })()
      cache.inflight = operation
      try {
        return await operation
      } finally {
        if (cache.inflight === operation) cache.inflight = undefined
      }
    }

    /**
     * One provider's decided row, or undefined when the Host has no opinion.
     *
     * @param {{ providers: Array<object> } | undefined} document - Host document.
     * @param {string} providerId - the selected provider route.
     * @returns {{ label?: string, visible?: boolean } | undefined} the row.
     */
    function rowFor(document, providerId) {
      if (document === undefined || providerId === '') return undefined
      for (const row of document.providers) {
        if (row !== null && typeof row === 'object' && row.provider === providerId) return row
      }
      return undefined
    }

    /**
     * The provider label beside the model seat.
     *
     * Reads the session's durable `modelSelection` projection — the same value
     * the Host stamps on outgoing requests — so the label cannot disagree with
     * the model seat about which provider is selected. It renders nothing while
     * the document is in flight, because showing a label that is about to be
     * suppressed (the provider belongs to another plugin) would flash.
     *
     * @param {object} props - slot props; `useProjection` and `t` are supplied by the slot.
     * @returns {import('react').ReactElement | null} the label, or null.
     */
    function ProviderLabel(props) {
      const { useProjection, sessionId, t } = props
      const selection = useProjection('modelSelection')
      const providerId = selection?.next?.provider ?? selection?.lastUsed?.provider ?? ''
      const [document, setDocument] = useState(undefined)

      useEffect(() => {
        if (providerId === '') {
          setDocument(undefined)
          return undefined
        }
        let live = true
        readDocument().then((next) => {
          if (live) setDocument(next)
        })
        return () => {
          live = false
        }
      }, [providerId, sessionId])

      if (providerId === '') return null
      const row = rowFor(document, providerId)
      // `visible` is decided by the Host: it carries the plugin switch, the
      // user's overrides, and the third-party check in one boolean.
      if (row === undefined || row.visible !== true) return null
      const label = typeof row.label === 'string' ? row.label.trim() : ''
      if (label === '') return null

      return h(
        'span',
        {
          className: 'dpsp-root',
          // Han/Kana/Hangul glyphs fill the em box and sit high on a Latin
          // baseline, so those labels take an optical nudge the stylesheet keys
          // off. Doing it here rather than in CSS keeps the decision next to the
          // string it describes.
          'data-cjk': CJK.test(label) ? 'true' : 'false',
          title: t('chip.aria', { provider: label }),
          'aria-label': t('chip.aria', { provider: label }),
        },
        h('span', { className: 'dpsp-name' }, label),
      )
    }

    return {
      // Only what the component actually needs. `remote` is deliberately absent:
      // this half reads its own Host route, which works in every composition and
      // keeps the ownership rule on the side that can evaluate it.
      // Only what the component actually needs, spelled the way the cordis
      // Loader expects (a plain array of REQUIRED service keys — the Loader has
      // no "optional" inject form, and a key listed here parks the plugin until
      // that service exists). `remote` is deliberately absent: this half reads
      // its own Host route, which works in every composition and keeps the
      // ownership rule on the side that can evaluate it.
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-provider-show: dictionaries')
        ctx.effect(installStyles, 'dsh-provider-show: stylesheet')
        ctx.slots.inject(SLOT, () => ctx.slots.register({
          name: SLOT,
          id: ENTRY_ID,
          // `input.right` is a list slot rendered immediately before the model
          // seat. Order only matters if another plugin also occupies this slot;
          // a connector that draws its own supplier chip suppresses ours for its
          // providers, so in practice the two never render together.
          order: 6,
          locale: NS,
        }, ProviderLabel))
      },
    }
  },
})
