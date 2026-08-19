/**
 * dsh-web-restart — Host half.
 *
 * Mounts the restart surface on the web profile:
 *   - `POST /dsh-restart`      — request a full process restart (self-relaunch)
 *   - `GET  /dsh-restart/health` — liveness + identity of the current process
 *                                  (the browser half polls this to detect the
 *                                  fresh process after a restart)
 *   - `dsh_restart` model tool  — same entry point, callable by the agent
 *
 * The web tree does NOT provide `ctx.appExit` (only the cmdline/headless
 * launchers do), so the controller exits via `process.exit` after spawning
 * the guard — see lib/restart.js and scripts/relaunch.mjs.
 */

import { restart } from './restart.js'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }

function json(res, status, data) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(data))
}

export default {
  inject: ['webServer', 'tools'],
  apply(ctx) {
    const webServer = ctx.webServer
    const tools = ctx.tools

    const restartHandler = async (req, res) => {
      if (req.method !== 'POST') {
        json(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      const result = restart.requestRestart({ port: webServer.port })
      json(res, result.ok ? 202 : 409, result)
    }

    const healthHandler = async (_req, res) => {
      json(res, 200, {
        ok: true,
        pid: process.pid,
        restartedBy: process.env.DSH_RESTARTED_BY ?? null,
        restarting: restart.isRestarting(),
        uptime: Math.round(process.uptime()),
      })
    }

    ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-restart', handler: restartHandler }), 'dsh-web-restart: restart route')
    ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-restart/health', handler: healthHandler }), 'dsh-web-restart: health route')

    const restartTool = {
      name: 'dsh_restart',
      description: '重启 DSH harness 进程：结束当前 `dsh web` 进程并以相同命令经启动守卫重新拉起。会中断所有正在运行的 agent 任务与后台作业，仅应在确认没有重要任务时使用。重启后浏览器页面会自动恢复。',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: '重启原因（写入本次响应的记录）。' },
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            reason: { type: 'string' },
            guardPid: { type: 'number' },
            exitAt: { type: 'string' },
          },
          additionalProperties: true,
        },
        render(_args, value) {
          const v = value
          if (v && v.ok === true) {
            return [{ type: 'text', text: `已发起 DSH 完整重启（启动守卫 pid=${v.guardPid ?? 'n/a'}，旧进程将于 ${v.exitAt ?? ''} 退出）。页面将自动恢复。` }]
          }
          return [{ type: 'text', text: `重启未发起：${(v && v.reason) || 'unknown'}` }]
        },
      },
      async execute(args) {
        const reason = typeof args?.reason === 'string' && args.reason.trim() ? args.reason.trim() : ''
        return restart.requestRestart({ port: webServer.port, reason })
      },
    }

    ctx.effect(() => tools.register(restartTool), 'dsh-web-restart: dsh_restart tool')
  },
}
