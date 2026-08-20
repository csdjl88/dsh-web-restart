# dsh-web-restart

DSH web plugin: **one-click full restart of the harness from the sidebar** — terminates the current `dsh web` process and relaunches the identical command through a startup guard (no systemd/Docker supervisor required), with automatic page recovery and an agent-callable restart tool.

> The npm name `dsh-restart` is already taken by a same-purpose project, so this plugin ships as **`dsh-web-restart`**.

## Features

- 🔘 **Sidebar restart button** in the `sidebar.footer.action` row (beside the Cordis lifecycle panel). Click = restart, no confirmation dialog (single-user, trusted-host model).
- ♻️ **Full process restart**: terminates the current `dsh web` process and relaunches the **exact same command line** (preserving `--profile` / `--patch` and all inner flags).
- 🛡️ **Startup guard (no daemon needed)**: the fresh process is launched only after the old process has exited AND the web port is free, eliminating the port-races that would otherwise crash boot (DSH's webserver binds on startup and has no EADDRINUSE retry).
- 🔄 **Automatic page recovery**: while restarting, the button shows "Restarting…" and polls the health endpoint; once the fresh process answers, the page reloads back into the current session (the session survives via DSH persistence).
- 🧰 **Agent-callable tool** `dsh_restart` sharing the same restart core.
- 🌐 Bilingual (zh/en) UI copy and README.
- 🚫 Single-flight guard: duplicate clicks/tool calls while a restart is in flight are rejected.

## Install

```bash
dsh plugin --profile web add dsh-web-restart
```

Restart DSH for the button to appear in the sidebar footer.

## Usage

### Web button
Click "Restart DSH" at the bottom of the sidebar. The button shows "Restarting…" and polls automatically; the page reloads once the fresh process is ready. If it is not ready within 30 seconds, an error is shown (check the terminal running dsh).

### Agent tool
Just ask "restart DSH" in a conversation (tool `dsh_restart`, optional `reason` argument). Note: a restart **interrupts all running agent tasks and background jobs**.

## How it works

```
click / tool call
   └─ POST /dsh-restart (idempotent, single-flight)
        └─ spawn the relaunch guard (same node + original argv + env contract)
             └─ old process exits after ~1s
                  └─ guard polls: old pid gone & port free
                       └─ relaunch `dsh web` with the identical command
                            └─ GET /dsh-restart/health answers → page auto-reloads
```

- The guard stays in the original process group: Ctrl+C on the terminal keeps working as before.
- HTTP endpoints: `POST /dsh-restart` (trigger), `GET /dsh-restart/health` (liveness; returns `pid` so the front end can recognise the fresh process).
- Env contract: `DSH_RESTARTED_BY` / `DSH_RESTART_OLD_PID` / `DSH_RESTART_PORT`.

## Compatibility

- Designed for **running `dsh web` in a foreground terminal** (no supervisor); the relaunch pipeline is verified against a real `dsh web` instance.
- ⚠️ **Use with caution under a supervisor that has an auto-restart policy** (systemd / Docker / pm2): when the old process exits, BOTH the supervisor and this plugin's guard may relaunch it, producing two instances racing for the port (one crashes with EADDRINUSE). In a supervised environment, disable the supervisor's restart policy or remove this plugin.
- Requires DSH `0.1.0-rc.7` or newer.

## Development

```bash
npm run check   # syntax checks
npm test        # unit tests + process-level e2e (real restart pipeline)
```

## License

MIT
