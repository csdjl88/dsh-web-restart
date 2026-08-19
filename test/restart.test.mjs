import test from 'node:test'
import assert from 'node:assert/strict'
import { createRestarter, DEFAULT_GRACE_MS } from '../lib/restart.js'

function fakeSpawn(record) {
  return (cmd, args, options) => {
    record.called = true
    record.cmd = cmd
    record.args = args
    record.options = options
    return { pid: 4242, unref() {} }
  }
}

test('requestRestart: spawns the guard with the identical command line', () => {
  const record = {}
  const exits = []
  const restarter = createRestarter({
    spawnImpl: fakeSpawn(record),
    exitImpl: (code) => exits.push(code),
  })
  const result = restarter.requestRestart({ port: 3080, reason: 'test' })

  assert.equal(result.ok, true)
  assert.equal(result.guardPid, 4242)
  assert.equal(result.reason, 'test')
  assert.ok(result.exitAt)
  // 与当前进程相同的 node、dsh 入口与全部参数（args[0] = 启动守卫脚本）。
  assert.equal(record.cmd, process.execPath)
  assert.ok(record.args[0].endsWith('scripts/relaunch.mjs'))
  assert.equal(record.args[1], process.argv[1])
  assert.deepEqual(record.args.slice(2), process.argv.slice(2))
  assert.ok(record.args.length >= 2) // relaunch + dsh 入口（其余参数按运行环境而定）
  // 环境契约。
  assert.equal(record.options.env.DSH_RESTARTED_BY, 'dsh-web-restart')
  assert.equal(record.options.env.DSH_RESTART_OLD_PID, String(process.pid))
  assert.equal(record.options.env.DSH_RESTART_PORT, '3080')
  // stdio 继承、不脱离进程组（保持 Ctrl+C 心智）。
  assert.deepEqual(record.options.stdio, 'inherit')
  // 旧进程在宽限期后退出。
  assert.equal(exits.length, 0)
  assert.ok(DEFAULT_GRACE_MS > 0)
})

test('requestRestart: is single-flight (second call rejected)', () => {
  const record = {}
  const restarter = createRestarter({ spawnImpl: fakeSpawn(record), exitImpl: () => {} })
  const first = restarter.requestRestart({ port: 3080 })
  const second = restarter.requestRestart({ port: 3080 })
  assert.equal(first.ok, true)
  assert.equal(second.ok, false)
  assert.equal(second.reason, 'already-restarting')
  assert.equal(record.called, true)
  // 只 spawn 一次。
  const spawnCalls = []
  const restarter2 = createRestarter({
    spawnImpl: (cmd, args, options) => { spawnCalls.push(args); return { pid: 1, unref() {} } },
    exitImpl: () => {},
  })
  restarter2.requestRestart({})
  restarter2.requestRestart({})
  assert.equal(spawnCalls.length, 1)
})

test('requestRestart: omits DSH_RESTART_PORT when the port is unknown', () => {
  const record = {}
  const restarter = createRestarter({ spawnImpl: fakeSpawn(record), exitImpl: () => {} })
  const result = restarter.requestRestart({})
  assert.equal(result.ok, true)
  assert.equal(record.options.env.DSH_RESTART_PORT, undefined)
  assert.equal(record.options.env.DSH_RESTART_OLD_PID, String(process.pid))
})

test('requestRestart: spawn failure resets the single-flight flag', () => {
  const restarter = createRestarter({
    spawnImpl: () => { throw new Error('boom') },
    exitImpl: () => {},
  })
  const first = restarter.requestRestart({})
  assert.equal(first.ok, false)
  assert.match(first.reason, /boom/)
  // 失败后可再次尝试。
  const second = restarter.requestRestart({})
  assert.equal(second.ok, false) // 仍失败，但不再是 already-restarting
  assert.equal(second.reason, 'boom')
})

test('isRestarting: reports the in-flight state', () => {
  const restarter = createRestarter({ spawnImpl: fakeSpawn({}), exitImpl: () => {} })
  assert.equal(restarter.isRestarting(), false)
  restarter.requestRestart({})
  assert.equal(restarter.isRestarting(), true)
})
