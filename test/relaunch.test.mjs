import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Process-level end-to-end test of the REAL relaunch pipeline:
 *
 *   fake-dsh (old process, listening on a random port)
 *     └─ POST /restart → lib/restart.js spawns scripts/relaunch.mjs
 *                          └─ guard waits for old pid + port free
 *                               └─ relaunches `node <argv[1]>` (fake-dsh)
 *                                    └─ new fake-dsh answers /health with a new pid
 *
 * The test asserts the health endpoint's pid changes to a fresh process
 * (identical command, different pid) — exactly what the browser half polls for.
 */

const FAKE_DSH = fileURLToPath(new URL('./fake-dsh.mjs', import.meta.url))
const HEALTH_TIMEOUT_MS = 15000
const RELAUNCH_TIMEOUT_MS = 20000

/**
 * Reserve a free TCP port. The relaunched fake must bind the SAME port as the
 * original (like a real `dsh web` with a fixed configured port), so the test
 * picks one free port up front and hands it to every fake instance.
 */
async function pickFreePort() {
  const net = await import('node:net')
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

function startFake(name, port) {
  const child = spawn(process.execPath, [FAKE_DSH], {
    env: { ...process.env, FAKE_DSH_NAME: name, FAKE_DSH_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return child
}

function readReady(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fake-dsh did not become ready')), 10000)
    let buffer = ''
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString()
      const match = buffer.match(/FAKE_DSH_READY (\d+)/)
      if (match) {
        clearTimeout(timer)
        resolve(Number(match[1]))
      }
    })
    child.once('exit', (code) => reject(new Error(`fake-dsh exited early (${code})`)))
  })
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' })
  const body = await res.json()
  return { status: res.status, body }
}

async function waitForNewPid(port, oldPid) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  for (;;) {
    try {
      const { status, body } = await fetchJson(`http://127.0.0.1:${port}/health`)
      if (status === 200 && Number.isInteger(body.pid) && body.pid !== oldPid) {
        return body
      }
    } catch {
      // connection refused → old process gone, fresh one not up yet
    }
    if (Date.now() > deadline) throw new Error('fresh process did not answer within timeout')
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

test('e2e: POST /restart replaces the process with an identical relaunch', { timeout: 60000 }, async () => {
  const port = await pickFreePort()
  const first = startFake('A', port)
  let freshPid = 0
  try {
    await readReady(first)
    const oldPid = first.pid

    // Sanity: old process answers health.
    const before = await fetchJson(`http://127.0.0.1:${port}/health`)
    assert.equal(before.body.pid, oldPid)

    // Trigger the REAL restart pipeline.
    const triggered = await fetch(`http://127.0.0.1:${port}/restart`, { method: 'POST' })
    assert.equal(triggered.status, 202)
    const triggerBody = await triggered.json()
    assert.equal(triggerBody.ok, true)
    assert.ok(typeof triggerBody.guardPid === 'number')

    // The old process exits within the grace period.
    const oldExit = new Promise((resolve) => first.once('exit', (code, signal) => resolve({ code, signal })))
    const oldExitResult = await oldExit
    assert.equal(oldExitResult.code, 0)

    // A fresh process (same command, new pid) answers health.
    const fresh = await waitForNewPid(port, oldPid)
    assert.notEqual(fresh.pid, oldPid)
    assert.equal(fresh.ok, true)

    // The fresh process must own its own process group (the guard spawns it
    // detached). The old harness was the terminal foreground process-group
    // leader; once it dies that group becomes orphaned and no longer receives
    // terminal signals, so the relaunched harness must not stay inside it —
    // detached gives it a deterministic, independent session (pgid == pid is
    // the portable marker; macOS `ps` has no `sid` keyword).
    const pgid = Number(execSync(`ps -o pgid= -p ${fresh.pid}`).toString().trim())
    assert.equal(pgid, fresh.pid, 'fresh process should be its own process-group leader')

    // Cleanup: stop the fresh instance.
    freshPid = fresh.pid
    try {
      process.kill(freshPid, 'SIGTERM')
    } catch {
      // already gone
    }
  } finally {
    // Clean up both instances (a failed assertion above must not leak the
    // fresh process — an unclosed stdio pipe would hang the test runner).
    for (const pid of [first.pid, freshPid]) {
      if (!pid) continue
      try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
    }
  }
})

test('client bundle: conforms to the ModuleLoader static-bundle shape', () => {
  const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')
  assert.match(source, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(source, /id: 'dsh-web-restart'/)
  assert.match(source, /factory: \(require\) => \{/)
  assert.match(source, /exports\.inject = inject/)
  assert.match(source, /exports\.apply = apply/)
  assert.match(source, /sidebar\.footer\.action/)
  // 重启后不再整页刷新（reload 会新建会话标签），改为保持页面、靠 DSH 自动重连恢复。
  assert.doesNotMatch(source, /location\.reload\(\)/)
  assert.match(source, /connection\/reset/)
  assert.match(source, /hostDescription/)
  assert.match(source, /waitForReconnect/)
  // 并排均分 CSS 规则必须存在（访谈确认的共存方案）。
  assert.match(source, /_footerActions/)
  assert.match(source, /flex: 1 1 0 !important/)
  // 重启后回到原会话 tab（不新开标签）：会话 id 存 sessionStorage，刷新后 sessions.open 切回。
  assert.match(source, /SESSION_KEY/)
  assert.match(source, /sessionStorage\.setItem/)
  assert.match(source, /sessionStorage\.getItem/)
  assert.match(source, /sessionStorage\.removeItem/)
  assert.match(source, /ctx\.sessions\.open\(savedId\)/)
  assert.match(source, /var inject = \['slots', 'locale', 'sessions', 'connection'\]/)
})
