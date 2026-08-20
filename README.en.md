# dsh-web-restart

DSH web plugin: **one-click full restart of the harness from the sidebar** — terminates the current `dsh web` process and relaunches the identical command through a startup guard (no systemd/Docker supervisor required), with automatic page recovery and an agent-callable restart tool.

> The npm name `dsh-restart` is already taken by a same-purpose project, so this plugin ships as **`dsh-web-restart`**.

## Features

- 🔘 **Sidebar restart button** in the `sidebar.footer.action` row (beside the Cordis lifecycle panel). Click = restart, no confirmation dialog (single-user, trusted-host model).
- ♻️ **Full process restart**: terminates the current `dsh web` process and relaunches the same command line (preserving `--profile` / `--patch` and all inner flags, always ensuring `--no-open` so no browser window is popped).
- 🛡️ **Startup guard (no daemon needed)**: the fresh process is launched only after the old process has exited AND the web port is free, eliminating the port-races that would otherwise crash boot (DSH's webserver binds on startup and has no EADDRINUSE retry).
- 🔄 **No page reload, no new tab**: while restarting, the button shows "Restarting…" and polls the health endpoint; the page stays put and DSH's WebSocket auto-reconnect (`connection/reset`) restores the UI **in the same session tab** (the session survives via DSH persistence).
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
Click "Restart DSH" at the bottom of the sidebar. The button shows "Restarting…" and polls automatically; the page does **not** reload — DSH's WebSocket auto-reconnect restores the UI in the same session tab (no new tab). If the fresh process is not ready within 30 seconds, an error is shown (check the terminal running dsh).

### Agent tool
Just ask "restart DSH" in a conversation (tool `dsh_restart`, optional `reason` argument). Note: a restart **interrupts all running agent tasks and background jobs**.

## How it works

```
click / tool call
   └─ POST /dsh-restart (idempotent, single-flight)
        └─ spawn the relaunch guard (same node + original argv + auto `--no-open`)
             └─ old process exits after ~1s
                  └─ guard polls: old pid gone & port free
                       └─ relaunch `dsh web` (with `--no-open`) in its own session
                            └─ no reload, no new tab — DSH auto-reconnects to the same session tab
```

- **The relaunch command always carries `--no-open`** (appended when the original command lacks it): the browser is already in front of the user, so no new window is popped.
- **No full-page reload**: DSH's WebSocket auto-reconnect (`connection/reset`) restores the UI in the original session tab.
- HTTP endpoints: `POST /dsh-restart` (trigger), `GET /dsh-restart/health` (liveness; returns `pid` so the front end can recognise the fresh process).
- Env contract: `DSH_RESTARTED_BY` / `DSH_RESTART_OLD_PID` / `DSH_RESTART_PORT`.

### Stopping a restarted DSH (important)

After a restart the fresh `dsh web` runs in its **own session (process group)**. The original dsh was the terminal's foreground process-group leader; once it dies the old group becomes orphaned and **no longer receives the terminal's Ctrl+C** — this is inherent to the Unix process model and cannot be fixed by the plugin. Stop the restarted harness with any of:

- **Close the terminal window running dsh** (the guard detects the terminal closing and terminates the harness; the port is released) — recommended.
- Press **Ctrl+D** in the terminal (also a terminal-close signal).
- Or, in a new terminal: `pkill -f "dsh web"` / `kill <pid>` (`lsof -iTCP:3080` to find the pid).

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
