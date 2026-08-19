#!/usr/bin/env node
/**
 * dsh-web-restart — relaunch guard.
 *
 * Spawned by the departing harness process (lib/restart.js) with the same
 * node binary and the original dsh command line:
 *
 *   node <pkg>/scripts/relaunch.mjs <dsh-bin> [dsh args...]
 *
 * Environment contract (set by the old process before spawning):
 *   DSH_RESTART_OLD_PID  — pid of the departing harness process
 *   DSH_RESTART_PORT     — web port the fresh process must win
 *   DSH_RESTARTED_BY     — marker that this is a relaunched instance
 *
 * The guard waits for the handoff (old process gone + port free), then
 * launches the real `dsh web` with the identical command line, inherits
 * stdio, and forwards the child's exit code / signal. It stays in the old
 * process group (not detached), so Ctrl+C on the terminal keeps working as
 * it did before the restart.
 */

import { spawn } from 'node:child_process'
import { waitForHandoff } from '../lib/guard.js'

const [bin, ...args] = process.argv.slice(2)
const oldPid = Number.parseInt(process.env.DSH_RESTART_OLD_PID || '', 10)
const port = Number.parseInt(process.env.DSH_RESTART_PORT || '', 10)

if (!bin) {
  process.stderr.write('dsh-web-restart guard: missing dsh entry point argument\n')
  process.exit(1)
}

const { timedOut } = await waitForHandoff({ oldPid, port })
if (timedOut) {
  process.stderr.write(`dsh-web-restart guard: handoff wait timed out (old pid=${oldPid || 'n/a'} port=${port || 'n/a'}); relaunching anyway\n`)
}

// Relaunch the real harness with the exact original command line.
const child = spawn(process.execPath, [bin, ...args], { stdio: 'inherit' })

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
