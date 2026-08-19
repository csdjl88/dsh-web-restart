import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { oldAlive, portFree, waitForHandoff } from '../lib/guard.js'

test('oldAlive: invalid pids are treated as gone', () => {
  assert.equal(oldAlive(0), false)
  assert.equal(oldAlive(-1), false)
  assert.equal(oldAlive(Number.NaN), false)
})

test('oldAlive: the current process is alive', () => {
  assert.equal(oldAlive(process.pid), true)
})

test('oldAlive: a pid that never existed is gone', () => {
  // Pick a pid that is virtually guaranteed to be dead: reserve and release a
  // huge pid space probe — kill(0) returns ESRCH for non-existent pids.
  assert.equal(oldAlive(2147483647), false)
})

test('portFree: an occupied port reports not free', async () => {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    assert.equal(await portFree(port, '127.0.0.1'), false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('portFree: a released port reports free', async () => {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  assert.equal(await portFree(port, '127.0.0.1'), true)
})

test('portFree: invalid ports are treated as free (skipped check)', async () => {
  assert.equal(await portFree(0), true)
  assert.equal(await portFree(70000), true)
  assert.equal(await portFree(Number.NaN), true)
})

test('waitForHandoff: returns immediately when the probe passes', async () => {
  const result = await waitForHandoff({ oldPid: 0, port: 0, probe: async () => true, timeoutMs: 1000 })
  assert.equal(result.timedOut, false)
})

test('waitForHandoff: times out when the probe never passes', async () => {
  const started = Date.now()
  const result = await waitForHandoff({ oldPid: 0, port: 0, probe: async () => false, timeoutMs: 120, sleepMs: 20 })
  assert.equal(result.timedOut, true)
  assert.ok(result.elapsedMs >= 120)
  assert.ok(Date.now() - started >= 120)
})

test('waitForHandoff: keeps polling until the probe passes', async () => {
  let calls = 0
  const result = await waitForHandoff({
    oldPid: 0,
    port: 0,
    timeoutMs: 2000,
    sleepMs: 30,
    probe: async () => {
      calls += 1
      return calls >= 3
    },
  })
  assert.equal(result.timedOut, false)
  assert.equal(calls, 3)
})
