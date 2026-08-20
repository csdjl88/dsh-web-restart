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
 * launches the real `dsh web` with the identical command line and inherits
 * stdio (logs still reach the terminal). The fresh harness is spawned
 * detached: it runs in its own session/process group, independent of the
 * departed process group — the old `dsh web` was the terminal's foreground
 * process-group leader, and once it dies the group becomes an orphaned
 * process group that no longer receives terminal signals (Ctrl+C cannot stop
 * a relaunched harness — a Unix process-model constraint, not fixable in the
 * plugin). Instead the guard offers a terminal-close stop path: it watches
 * stdin for EOF (terminal window closed / Ctrl+D) and terminates the fresh
 * harness so the port is released. SIGINT/SIGTERM sent directly to the guard
 * are forwarded to the harness.
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

let child = null
let exited = false

function forward(signal) {
  if (exited) return
  if (child && !child.killed) {
    child.kill(signal)
  } else {
    // No relaunched child yet — a signal now means "don't restart", cancel.
    process.exit(128)
  }
}
process.on('SIGINT', () => forward('SIGINT'))
process.on('SIGTERM', () => forward('SIGTERM'))

// Terminal closed (window closed / Ctrl+D): stop the harness and release the
// port. Only meaningful with a real terminal on stdin — a non-TTY stdin
// (piped / /dev/null / tests) would EOF immediately and would wrongly kill a
// just-spawned harness, so it is skipped there. Watched only while the child
// runs; the wait phase is short and a closed terminal then should not abort a
// restart that already departed.
function watchTerminalClose() {
  if (!process.stdin.isTTY) return
  try {
    process.stdin.on('end', () => stopHarness())
    process.stdin.on('error', () => stopHarness())
    process.stdin.resume() // 消费 stdin 以触发 end/error（dsh web 不读 stdin）
  } catch (e) {
    /* 无 stdin 时跳过 */
  }
}

function stopHarness() {
  if (exited) return
  if (child && !child.killed) child.kill('SIGTERM')
  // child 退出后由 exit 回调收尾；若 child 迟迟不退，SIGTERM 后仍由 exit 兜底。
}

const { timedOut } = await waitForHandoff({ oldPid, port })
if (timedOut) {
  process.stderr.write(`dsh-web-restart guard: handoff wait timed out (old pid=${oldPid || 'n/a'} port=${port || 'n/a'}); relaunching anyway\n`)
}

// Relaunch the real harness with the original command line. detached: the
// fresh process owns its session/process group (see header note).
child = spawn(process.execPath, [bin, ...args], { detached: true, stdio: 'inherit' })
watchTerminalClose()

child.on('exit', (code, signal) => {
  exited = true
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
