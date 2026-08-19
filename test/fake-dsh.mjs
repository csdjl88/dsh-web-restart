/**
 * fake-dsh — a minimal stand-in for `dsh web`, used by relaunch.test.mjs to
 * exercise the REAL relaunch pipeline (spawn guard → wait for handoff →
 * relaunch identical command) without booting the actual harness.
 *
 * Behaviour mirrors what dsh-web-restart expects from its host:
 *   - GET  /health  → `{ ok, pid, name }` (identity used by the poller)
 *   - POST /restart → `restart.requestRestart({ port })` (the real controller)
 *
 * Prints `FAKE_DSH_READY <port>` on stdout once listening.
 */

import { createServer } from 'node:http'
import { restart } from '../lib/restart.js'

const name = process.env.FAKE_DSH_NAME || 'fake'
const port = Number(process.env.FAKE_DSH_PORT || 0)

const server = createServer(async (req, res) => {
  const json = (status, data) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(data))
  }
  const url = new URL(req.url || '/', 'http://localhost')
  if (url.pathname === '/health') {
    json(200, { ok: true, pid: process.pid, name })
    return
  }
  if (url.pathname === '/restart' && req.method === 'POST') {
    const result = restart.requestRestart({ port: server.address().port, reason: 'e2e' })
    json(result.ok ? 202 : 409, result)
    return
  }
  json(404, { ok: false })
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`FAKE_DSH_READY ${server.address().port}\n`)
})
