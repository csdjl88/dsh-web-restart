/**
 * dsh-web-restart — Client half (static bundle).
 *
 * A real browser script loaded through the client module system
 * (`window.__ModuleLoader__.load`), NOT a dynamic-plugin sandbox body: it
 * receives `require` (the module table) and runs with browser globals
 * (`fetch`, `document`, `location`) available.
 *
 * It injects one entry into `sidebar.footer.action` (the sidebar bottom
 * action row, beside the Cordis lifecycle panel):
 *   - a restart button. Clicking it POSTs `/dsh-restart` with no further
 *     confirmation (single-user, trusted-host model), then the button shows a
 *     "Restarting…" state and polls `GET /dsh-restart/health` until the
 *     responding pid differs from the pid recorded at click time — that is the
 *     fresh process — at which point the page reloads back into the current
 *     session. If no fresh process answers within 30s, an error is shown.
 *   - co-existence CSS: the footer action row is a flex row whose existing
 *     Cordis entry is `flex:none; width:100%` (it would squeeze any sibling to
 *     zero width), so the bundle injects one rule forcing every footer action
 *     child to flex evenly — collapsed (rail) mode is unaffected because the
 *     row container is width:auto there and children keep their content size;
 *     the restart button additionally snaps to a fixed 36px round icon.
 */

window.__ModuleLoader__.load({
  id: 'dsh-web-restart',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    var IconRefreshOutline16 = primitives.IconRefreshOutline16

    // ── CSS ─────────────────────────────────────────────────────────────
    var STYLE_TAG = 'dsh-web-restart/restart.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + STYLE_TAG + '"]') === null) {
      var tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-web-restart'
      tag.dataset.pluginCss = STYLE_TAG
      tag.textContent = [
        // 并排均分：footer 操作行所有子项均分宽度（避免 Cordis 面板独占整行把本按钮挤出）。
        // 收起态容器为 width:auto，子项按内容宽排布，不受影响。
        '[class$="_footerActions"] > * { flex: 1 1 0 !important; min-width: 0 !important; }',
        // 展开态按钮：与 Cordis 面板 badge 一致的 42px 圆角行按钮。
        '.dsh-restart-action { box-sizing: border-box; width: 100%; height: 42px; margin: 8px 0 0; border-radius: 12px; align-items: center; gap: 8px; padding: 0 10px 0 8px; font-family: inherit; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); background: transparent; border: none; cursor: pointer; display: inline-flex; overflow: hidden; }',
        '.dsh-restart-action:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger, rgba(229, 83, 75, 0.12)); }',
        '.dsh-restart-action:disabled { opacity: 0.6; cursor: default; }',
        '.dsh-restart-action:focus-visible { outline: 1px solid var(--dsw-alias-state-business-primary); outline-offset: -1px; }',
        '.dsh-restart-label { text-overflow: ellipsis; white-space: nowrap; min-width: 0; overflow: hidden; }',
        // 收起态：36px 圆形图标（与 Cordis 面板 rail 一致）。
        '.dsh-restart-action[data-collapsed] { flex: 0 0 36px !important; width: 36px; height: 36px; justify-content: center; gap: 0; margin: 0; padding: 0; border-radius: 50%; }',
        '.dsh-restart-spin { animation: dsh-restart-spin 1s linear infinite; }',
        '@keyframes dsh-restart-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }',
        '.dsh-restart-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; margin: 2px 0 0; }'
      ].join('\n')
      document.head.appendChild(tag)
    }

    // ── Locales ─────────────────────────────────────────────────────────
    var NS = 'dsh-web-restart'
    var zh = {
      'trigger': '重启 DSH',
      'trigger.aria': '重启 DSH：结束当前进程并以相同命令重新拉起',
      'restarting': '重启中…',
      'timeout': '重启超时（30 秒内未就绪），请查看运行 dsh 的终端日志。',
      'failed': '重启失败：'
    }
    var en = {
      'trigger': 'Restart DSH',
      'trigger.aria': 'Restart DSH: terminate the current process and relaunch the same command',
      'restarting': 'Restarting…',
      'timeout': 'Restart timed out (not ready within 30s). Check the terminal running dsh.',
      'failed': 'Restart failed: '
    }

    // ── Restart button ──────────────────────────────────────────────────
    var RESTART_URL = '/dsh-restart'
    var HEALTH_URL = '/dsh-restart/health'
    var POLL_MS = 1000
    var TIMEOUT_MS = 30000

    function RestartButton(props) {
      var t = props.t
      var wide = props.wide !== false
      var state = React.useState('idle')
      var phase = state[0]
      var setPhase = state[1]
      var msg = React.useState('')
      var message = msg[0]
      var setMessage = msg[1]
      var timers = React.useRef({ poll: null, deadline: 0 })
      var currentPid = React.useRef(null)

      React.useEffect(function () {
        return function cleanup() {
          if (timers.current.poll) clearInterval(timers.current.poll)
        }
      }, [])

      function stopPolling() {
        if (timers.current.poll) {
          clearInterval(timers.current.poll)
          timers.current.poll = null
        }
      }

      function pollHealth() {
        fetch(HEALTH_URL, { cache: 'no-store' })
          .then(function (res) {
            if (!res.ok) throw new Error('not-ready')
            return res.json()
          })
          .then(function (health) {
            if (Number.isInteger(health && health.pid) && health.pid !== currentPid.current) {
              // 应答的已是新进程 —— 就绪，自动刷新回到当前会话。
              location.reload()
              return
            }
            throw new Error('same-process')
          })
          .catch(function () {
            if (Date.now() >= timers.current.deadline) {
              stopPolling()
              setMessage(t('timeout'))
              setPhase('error')
            }
            // 否则继续轮询：连接拒绝 = 旧进程已退出，新进程尚未就绪。
          })
      }

      function beginRestarting() {
        setPhase('restarting')
        timers.current.deadline = Date.now() + TIMEOUT_MS
        // 记录当前会话 id，供重启刷新后切回原会话 tab（避免跳到新会话/新标签）。
        try {
          var cur = clientCtx && clientCtx.sessions && clientCtx.sessions.list.getSnapshot().current
          if (cur) sessionStorage.setItem(SESSION_KEY, String(cur))
        } catch (e) { /* 忽略：无会话或存储不可用时保持默认行为 */ }
        // 记录当前 pid：轮询到 pid 变化才视为新进程就绪（旧进程退出前仍会应答）。
        fetch(HEALTH_URL, { cache: 'no-store' })
          .then(function (res) { return res.ok ? res.json() : null })
          .then(function (health) { if (health && Number.isInteger(health.pid)) currentPid.current = health.pid })
          .catch(function () {})
        timers.current.poll = setInterval(pollHealth, POLL_MS)
        pollHealth()
      }

      function trigger() {
        if (phase !== 'idle') return
        fetch(RESTART_URL, { method: 'POST', cache: 'no-store' })
          .then(function (res) {
            if (res.status === 202 || res.status === 409) return res.json()
            throw new Error('HTTP ' + res.status)
          })
          .then(function (data) {
            if (data && data.ok === false && data.reason !== 'already-restarting') {
              throw new Error(data.reason || 'restart rejected')
            }
            beginRestarting()
          })
          .catch(function (err) {
            setMessage(t('failed') + (err && err.message ? err.message : String(err)))
            setPhase('error')
          })
      }

      var label = phase === 'restarting' ? t('restarting') : t('trigger')
      var icon = React.createElement(IconRefreshOutline16, {
        size: wide ? 16 : 18,
        className: phase === 'restarting' ? 'dsh-restart-spin' : undefined
      })
      var button = React.createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-restart-action',
          'data-collapsed': wide ? undefined : '',
          'aria-label': t('trigger.aria'),
          'aria-busy': phase === 'restarting' || undefined,
          disabled: phase !== 'idle',
          onClick: trigger
        },
        icon,
        wide ? React.createElement('span', { className: 'dsh-restart-label' }, label) : null
      )
      if (phase === 'error') {
        return React.createElement('div', null,
          button,
          React.createElement('div', { className: 'dsh-restart-error', role: 'alert' }, message)
        )
      }
      return button
    }

    // ── Restart-keeps-your-session-tab ───────────────────────────────────
    // 重启会导致整页刷新（location.reload），DSH 客户端重新 boot 后默认回到
    // 会话列表 / 最近工作区，而不是点击时所在的会话标签页。这里在重启前把
    // 当前会话 id 记入 sessionStorage，刷新后恢复逻辑把它切回原会话 tab。
    var SESSION_KEY = 'dsh-web-restart:session'
    var clientCtx = null
    var RESTORE_POLL_MS = 500
    var RESTORE_MAX_TRIES = 30 // 15s 兜底

    /** 刷新后把当前会话切回重启前所在的会话 tab（若会话仍存在）。 */
    function restoreSessionAfterRestart(ctx) {
      var savedId
      try { savedId = sessionStorage.getItem(SESSION_KEY) } catch (e) { savedId = null }
      if (!savedId) return
      var tries = 0
      var timer = setInterval(function () {
        tries += 1
        var done = false
        var snap = null
        try { snap = ctx.sessions.list.getSnapshot() } catch (e) { snap = null }
        if (snap && snap.phase === 'ready') {
          if (snap.current === savedId) {
            done = true // 已在该会话，无需切换
          } else if (snap.ids && snap.ids.indexOf(savedId) !== -1) {
            try { ctx.sessions.open(savedId) } catch (e) { /* 忽略 */ }
            done = true // 已切回原会话 tab
          } else {
            done = true // 会话已被删除，放弃恢复
          }
        }
        if (done || tries >= RESTORE_MAX_TRIES) {
          clearInterval(timer)
          try { sessionStorage.removeItem(SESSION_KEY) } catch (e) { /* 忽略 */ }
        }
      }, RESTORE_POLL_MS)
    }

    var inject = ['slots', 'locale', 'sessions']

    function apply(ctx) {
      clientCtx = ctx
      ctx.effect(function () {
        ctx.locale.register(NS, { zh: zh, en: en })
      }, 'dsh-web-restart: dictionaries')
      // 若本次加载是重启后的刷新，把会话切回重启前所在的标签页。
      restoreSessionAfterRestart(ctx)
      ctx.slots.inject('sidebar.footer.action', function () {
        return ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'dsh-web-restart-action',
          order: 1,
          locale: NS
        }, RestartButton)
      })
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  }
})
