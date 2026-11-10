# Ultrix Controller

Ultrix Controller is a Windows-hosted routing panel for Ross Ultricore BCS. The server owns one GVG Native connection. Browser panels share its cache and receive live updates through Server-Sent Events.

## Start the live console on Windows

Double-click `Start Ultrix Controller.cmd` or run it from PowerShell.

```powershell
& '.\Start Ultrix Controller.cmd'
```

The launcher uses Node.js 24 from `runtime\node.exe` or your PATH. On a fresh checkout, run `pnpm install --frozen-lockfile` and `pnpm build` first. Keep the console open for backend logs and press **Ctrl+C** to stop.

Open [live Admin](http://localhost:8443/admin) and select **Router → Connect**. The launcher uses BCS at `10.10.10.156:12345` and stores accounts, panels, and aliases in `data\live\controller.sqlite`. Start one copy at a time. To create an initial admin in a fresh live data directory, set `BCS_MODE=live` before running `pnpm admin live-admin`.

## Run the simulator

Install Node.js 24 LTS and pnpm. From the project directory:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm admin studio-admin
pnpm start
```

Open [the local simulator](http://127.0.0.1:8088). The admin command prompts for a password and creates the first account. The simulator starts disconnected and uses its own local database. Sign in, open **Router**, then select **Connect**. Create a panel with the simulated catalogue entries, assign it to your account or an operator, and open **Operator**.

During development, run `pnpm dev:api` and `pnpm dev` in separate terminals. Open the Vite URL at `http://127.0.0.1:5173`. The simulator includes mixed and unrouted examples on **STUDIO MON** and **SPARE**.

## Windows service

Build the app on a Windows x64 machine with the same Node major version as the host. The staging script builds the app and installs its production dependencies in a separate directory. Supply an official WinSW executable to include it as `BCSController.exe`. The [service template](deployment/BCSController.xml) starts a local simulator.

```powershell
.\deployment\stage.ps1 -OutputDirectory 'C:\Apps\BCSController' -WinSWPath 'C:\Installers\WinSW-x64.exe'
```

Create the data and log directories under `%ProgramData%\BCSController`. Give the service account read access to the staged application, read access to the TLS key if configured, and write access to the data and log directories. Bootstrap the admin from a terminal with the same `BCS_MODE` and `BCS_DATA_DIR` as the service. Install and start WinSW from an elevated terminal.

```powershell
.\BCSController.exe install
.\BCSController.exe start
```

| Environment variable | Purpose |
| --- | --- |
| `BCS_MODE` | `simulator` by default. Use `live-readonly` for the first live pilot and `live` for an authorized routing test. |
| `BCS_DATA_DIR` | Persistent directory containing `controller.sqlite`. Keep simulator and live data separate. |
| `BCS_HOST` and `BCS_PORT` | Live endpoint. Defaults to `10.10.10.156:12345`. |
| `WEB_HOST` and `WEB_PORT` | Bind address and port. Defaults to `127.0.0.1:8088`. |
| `WEB_ORIGIN` | Exact browser origin including scheme and port where applicable. Required for HTTPS. |
| `WEB_TLS_CERT` and `WEB_TLS_KEY` | Paths to the trusted PEM certificate chain and private key. Required for LAN access and by default in live mode. |
| `WEB_ALLOW_LOCAL_HTTP` | Set to `yes` for a workstation-only HTTP pilot. Requires `WEB_HOST=127.0.0.1` and an exact HTTP `WEB_ORIGIN` on `localhost` or `127.0.0.1` with the configured port. LAN access requires TLS. |
| `BCS_ENABLE_SELECTED_LEVELS` | Set to `yes` in live mode only after the separately authorized selected-level validation. |

The server starts disconnected in every mode. The adapter checks that L4 Echo is off before accepting the snapshot. For the live read-only pilot, connect from **Router** and verify catalogue coverage and live status. After a test destination is separately approved, switch to live mode for the all-level smoke test. Keep selected-level app writes gated until an approved masked TAKE and readback verify that all other levels retain their routes. [GVG protocol reference](Docs/gvg-native-protocol.md) · [WinSW installation](https://github.com/winsw/winsw)

Use `pnpm backup <path-to-backup.sqlite>` with the service's database settings to make a consistent SQLite backup. For recovery, stop the service, preserve the old data directory, and point `BCS_DATA_DIR` at a new directory containing the backup as `controller.sqlite`. Restart and confirm the account and panel configuration before connecting.

## Verification

```powershell
pnpm test
pnpm build
pnpm test:browser
```

The browser test uses installed Chrome by default. Set `BCS_BROWSER_CHANNEL=msedge` to use Edge. Both test suites use the loopback simulator. Live read-only and route smoke tests are separate rollout steps.

