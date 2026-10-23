# Develop on a VM or remote server

[Documentation home](../README.md#documentation) · [First-time setup](getting-started.md) · [Development](development.md)

Use the same Node, pnpm, PostgreSQL and source workflow as a laptop. The extra
step is making the browser reach the VM's **web and API** privately. A browser's
`127.0.0.1` is the browser's machine, not the server. PostgreSQL stays on server
loopback. These instructions do not deploy the production authentication stack.

## Choose private browser access

| Access method       | Web/API bind                        | Browser URLs                                 |
| ------------------- | ----------------------------------- | -------------------------------------------- |
| Direct Tailscale    | The server's Tailscale IPv4 address | The same private server IP, ports 3000/3001. |
| SSH port forwarding | Server loopback (`127.0.0.1`)       | Laptop loopback through two SSH forwards.    |

The development web app signs every visitor in as the synthetic user, and local
storage permits development uploads. Use access controls for your private
network/SSH account. Never bind this stack to `0.0.0.0`, open its ports to the
public Internet, or enable Tailscale Funnel. Do not reset another application's
Tailscale Serve configuration.

## Direct access over Tailscale

Install and authenticate Tailscale on the server and your browser's machine
using the [Tailscale quickstart](https://tailscale.com/docs/how-to/quickstart).
Inspect the server's address and ports before starting anything:

```bash
tailscale status
tailscale ip -4
ss -ltn
```

After installing dependencies, **before generating env files on a fresh clone**:

```bash
FLASH_EVALS_TAILSCALE_IP=$(tailscale ip -4)
pnpm run setup:local -- --host "$FLASH_EVALS_TAILSCALE_IP"
```

The generator accepts loopback or a Tailscale IPv4 address and writes consistent
bind hosts, browser URLs and CORS. PostgreSQL still uses `127.0.0.1:54322`.
Continue the [new-database initialization](getting-started.md#3-initialize-a-new-development-database-once)
only after confirming the database is disposable, then run `pnpm run dev`.
Open `http://YOUR_TAILSCALE_IP:3000` from a device allowed to reach that server.
HTTP travels inside the encrypted tailnet; this does not make the browser origin
an HTTPS secure context.

For **existing env files**, do not regenerate secrets. Update these values in
place, substituting the actual private server IP:

| File | Setting                      | Value                           |
| ---- | ---------------------------- | ------------------------------- |
| API  | `FLASH_EVALS_API_BIND_HOST`  | `YOUR_TAILSCALE_IP`             |
| API  | `FLASH_EVALS_API_PUBLIC_URL` | `http://YOUR_TAILSCALE_IP:3001` |
| API  | `CORS_ORIGINS`               | `http://YOUR_TAILSCALE_IP:3000` |
| Web  | `FLASH_EVALS_DEV_BIND_HOST`  | `YOUR_TAILSCALE_IP`             |
| Web  | `FLASH_EVALS_DEV_WEB_ORIGIN` | `http://YOUR_TAILSCALE_IP:3000` |
| Web  | `API_BASE_URL`               | `http://YOUR_TAILSCALE_IP:3001` |
| Web  | `NEXT_PUBLIC_API_BASE_URL`   | `http://YOUR_TAILSCALE_IP:3001` |

Keep internal API tokens equal, both database URLs on the same database, and
existing provider/encryption secrets unchanged. The API public URL is used for
browser uploads too; fixing only the web URL is insufficient. Restart the app.
Use the matching private API `/mcp` URL for a desktop MCP client.

## SSH port forwarding

This option needs no Tailscale integration in the application. Keep the generated
loopback configuration on the VM, and start `pnpm run dev` there. In a terminal
on your laptop, substituting your SSH destination:

```bash
ssh -N -o ExitOnForwardFailure=yes   -L 127.0.0.1:3000:127.0.0.1:3000   -L 127.0.0.1:3001:127.0.0.1:3001 user@your-vm
```

Open <http://127.0.0.1:3000> on the laptop; the browser API/upload URL remains
<http://127.0.0.1:3001>. Keep the tunnel open. Both laptop ports must be free.
Forward additional test ports if you want to inspect browser-test UIs from your
laptop. Run automated browser tests on the VM itself. Closing SSH also closes
these forwards; it does not delete data. A foreground app may stop with its SSH
session unless you use a terminal multiplexer or the optional service below.

## Optional Linux background service

Foreground `pnpm run dev` is sufficient for normal development. On a Linux host
with a systemd user manager, the standard Compose database and local storage,
you can opt into boot/crash recovery:

```bash
pnpm run dev:install
pnpm run dev:status
pnpm run dev:logs
```

This installs user units for the same root launcher and a daily backup timer,
restarts the application, and enables both units. It does not install system
packages, configure a firewall, start Docker/Tailscale, migrate or seed. The
installer pins the resolved installed Node executable and its bin directory;
a global runtime updater cannot silently move that service to another Node.
Rerun the installer after deliberately changing runtime or checkout location.

For boot without an interactive login, an administrator may need:

```bash
sudo loginctl enable-linger "$USER"
```

Also arrange for Docker, and Tailscale when used, to start at boot. The user
service waits for the configured interface and Compose PostgreSQL, then retries
failed starts every 10 seconds. A deliberately stopped database stays stopped;
start it with `docker compose up -d --wait postgres` before restarting the app.
These user-service commands are not a macOS/Windows service installer.

```bash
pnpm run dev:restart
pnpm run dev:stop
```

The restart command returns after the launcher starts; shared-package builds and
child startup can take a few more seconds. Wait for web/API health and the
worker's `worker.ready` log before running smoke checks.

Stop the service before launching manually. Restart after API, worker, shared
package or environment edits. Web edits use fast refresh. Shutdown allows the
worker's configured drain window plus cleanup time; queued work remains durable.
An interrupted provider call can still have been charged before its result was
saved, so recovery cannot promise exactly-once external billing.

## Backups

The optional service installation enables a daily backup at **04:00 host local time**.
Inspect its schedule and logs; change the schedule through a systemd timer
[override](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html)
if that time does not suit your environment.

```bash
pnpm run dev:backup
systemctl --user list-timers flash-evals-backup.timer
journalctl --user -u flash-evals-backup.service -n 20 --no-pager
```

A backup briefly pauses the managed app, copies PostgreSQL, `.uploads`, and both
private env files into one archive, then resumes it. It attempts to resume after
failure too. Stop any manually launched copies first. The helper refuses custom
database/storage targets; use their own paired backup procedure instead.

Archives are private and Git-ignored under `.dev.local/backups/`. The latest seven
completed snapshots are kept. Failed/partial snapshots are not published as
completed archives. Missed scheduled runs are skipped to avoid an unexpected
pause after boot. An archive records the Git revision/dirty-path count but does
not replace committing code.

Archives include credentials and encryption keys: keep them private, and copy
them to a protected encrypted location elsewhere if you need to survive disk or
server loss. No external backup account is configured. Restore into a separate
empty database first using `pg_restore --no-owner --no-privileges`, compare row
counts and the matching `uploads/` files, and preserve the archived encryption
key before switching the working application.

## Diagnose access and recovery

Check web/API health at your configured browser addresses, the worker's readiness
log, and `pnpm run worker:status`. For MCP, use the
[development smoke checks](development.md#mcp-development). If a VM comes back
but its UI does not, inspect the app service, Docker database health, private
interface, user lingering, and the browser-facing API URL. Do not reseed, remove
volumes, or reset Tailscale Serve to repair connectivity.

Host-specific addresses, tokens, backup paths and private operation notes belong
in ignored local files, not a shared contributor guide.
