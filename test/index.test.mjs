import test from 'node:test'
import assert from 'node:assert/strict'
import plugin from '../lib/index.js'

test('plugin: declares the host services it consumes', () => {
  assert.deepEqual(plugin.inject, ['webServer', 'tools'])
  assert.equal(typeof plugin.apply, 'function')
})

test('plugin: mounts two routes and one model tool', () => {
  const routes = []
  const tools = []
  const ctx = {
    effect(fn) { fn() },
    webServer: {
      port: 3080,
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
  }
  plugin.apply(ctx)

  assert.equal(routes.length, 2)
  const byPath = Object.fromEntries(routes.map((r) => [r.path, r]))
  assert.ok(byPath['/dsh-restart'])
  assert.equal(byPath['/dsh-restart'].kind, 'exact')
  assert.ok(byPath['/dsh-restart/health'])
  assert.equal(typeof byPath['/dsh-restart'].handler, 'function')
  assert.equal(typeof byPath['/dsh-restart/health'].handler, 'function')

  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, 'dsh_restart')
  assert.equal(typeof tools[0].execute, 'function')
  assert.ok(tools[0].description.includes('重启'))
})

test('plugin: restart route rejects non-POST requests with 405', async () => {
  // NOTE: the POST success path is intentionally NOT exercised here — it calls
  // the real restart controller (spawn + process.exit after a grace period),
  // which would kill the test process. The 202/409 behaviour is covered by
  // restart.test.mjs with injected fakes.
  const routes = []
  const ctx = {
    effect(fn) { fn() },
    webServer: {
      port: 3080,
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    tools: { register() {} },
  }
  plugin.apply(ctx)
  const handler = routes.find((r) => r.path === '/dsh-restart').handler

  let status
  let body
  await handler(
    { method: 'GET', url: '/dsh-restart' },
    {
      writeHead(s) { status = s },
      end(data) { body = JSON.parse(data) },
    },
  )
  assert.equal(status, 405)
  assert.equal(body.ok, false)
})
