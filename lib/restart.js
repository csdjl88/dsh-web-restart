/**
 * dsh-web-restart — restart controller.
 *
 * requestRestart() implements the self-relaunch scheme for a harness running
 * in the foreground with no external supervisor:
 *
 *   1. spawn the relaunch guard (`scripts/relaunch.mjs`) with the SAME node
 *      binary, the same dsh entry and the same arguments as the current
 *      process — so the relaunched harness is byte-for-byte the same command,
 *      including `--profile` / `--patch` overlays and inner app flags;
 *   2. hand the guard the old pid and the web port through the environment;
 *   3. exit this (old) process after a short grace period. The guard waits
 *      until the old process is gone AND the port is free, then launches the
 *      real `dsh web`. DSH's webserver binds during boot and has no
 *      EADDRINUSE retry, so the guard's handoff is what makes the restart
 *      race-free.
 *
 * The controller is a factory so tests can inject spawn/exit fakes.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** How long the old process keeps running after spawning the guard (ms). */
export const DEFAULT_GRACE_MS = 1000

const RELAUNCH_SCRIPT = fileURLToPath(new URL('../scripts/relaunch.mjs', import.meta.url))

export function createRestarter({ spawnImpl = spawn, exitImpl = (code) => process.exit(code), relaunchScript = RELAUNCH_SCRIPT } = {}) {
  /** Single-flight: the second click/tool call while a restart is in flight is rejected, never duplicated. */
  let restarting = false

  /**
   * Request a full process restart.
   * @param options.port - the web port the guard should wait to become free.
   * @param options.reason - optional human-readable reason, echoed in the result.
   * @returns `{ ok: true, guardPid, exitAt, reason? }` or `{ ok: false, reason }`.
   */
  function requestRestart({ port, reason } = {}) {
    if (restarting) return { ok: false, reason: 'already-restarting' }
    restarting = true
    try {
      const child = spawnImpl(
        process.execPath,
        [relaunchScript, process.argv[1], ...process.argv.slice(2)],
        {
          stdio: 'inherit',
          env: {
            ...process.env,
            DSH_RESTARTED_BY: 'dsh-web-restart',
            DSH_RESTART_OLD_PID: String(process.pid),
            ...(Number.isInteger(port) && port > 0 ? { DSH_RESTART_PORT: String(port) } : {}),
          },
        },
      )
      child?.unref?.()
      const exitAt = Date.now() + DEFAULT_GRACE_MS
      setTimeout(() => exitImpl(0), DEFAULT_GRACE_MS)
      return {
        ok: true,
        guardPid: typeof child?.pid === 'number' ? child.pid : null,
        exitAt: new Date(exitAt).toISOString(),
        ...(reason ? { reason } : {}),
      }
    } catch (error) {
      restarting = false
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }

  return {
    requestRestart,
    isRestarting: () => restarting,
  }
}

/** Default singleton bound to the real process. */
export const restart = createRestarter()
