/**
 * dsh-web-restart — relaunch guard logic.
 *
 * The guard's job: after the old harness process requested a restart and
 * spawned this guard, wait until the old process is gone AND its web port is
 * actually free, then hand off. Only then may the real `dsh web` be relaunched
 * — the DSH webserver binds its port during boot and fails hard on
 * EADDRINUSE (no retry inside DSH), so launching too early would crash the
 * fresh process and leave the harness fully down.
 *
 * All functions are pure / injectable so the polling behaviour can be unit
 * tested without real processes or sockets.
 */

import net from 'node:net'

/** Whether a process with the given pid is still alive (ESRCH => gone). */
export function oldAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Probe whether `port` on `host` is currently bindable (free).
 * Uses a raw net server so the check works regardless of what protocol the
 * webserver speaks; the OS enforces one listener per (host, port), so a
 * successful bind means the DSH port is released.
 * @returns a promise resolving to true when the port is free.
 */
export function portFree(port, host = '127.0.0.1') {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return Promise.resolve(true)
  return new Promise((resolve) => {
    const probe = net.createServer()
    const done = (free) => {
      probe.removeAllListeners()
      probe.close(() => resolve(free))
    }
    probe.once('error', () => done(false))
    probe.once('listening', () => done(true))
    probe.listen(port, host)
  })
}

/**
 * Wait until the old process has exited and the web port is free, or until the
 * timeout elapses. When the timeout elapses we proceed anyway — a stale
 * listener or a wedged old process must not block the relaunch forever.
 *
 * @param options.oldPid - pid of the departing harness process (0/NaN => skip).
 * @param options.port - the web port the fresh process must win (0 => skip).
 * @param options.timeoutMs - hard ceiling for the whole wait.
 * @param options.sleepMs - poll interval.
 * @param options.probe - injectable `(oldPid, port) => Promise<boolean>` that
 *   resolves true when it is safe to relaunch; defaults to the real checks.
 * @returns `{ elapsedMs, timedOut }`.
 */
export async function waitForHandoff({ oldPid, port, timeoutMs = 30000, sleepMs = 500, probe } = {}) {
  const started = Date.now()
  const check = probe ?? (async () => !oldAlive(oldPid) && await portFree(port))
  for (;;) {
    const elapsedMs = Date.now() - started
    if (elapsedMs >= timeoutMs) return { elapsedMs, timedOut: true }
    if (await check()) return { elapsedMs, timedOut: false }
    await new Promise((resolve) => setTimeout(resolve, sleepMs))
  }
}
