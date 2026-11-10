# Ultrix Controller

Ultrix Controller is a Windows-hosted routing panel for Ross Ultricore BCS. One GVG Native connection supplies the routing cache and live updates to all signed-in browsers.

## Start the live console on Windows

Install Node.js 24 LTS and pnpm. From a fresh checkout, run `pnpm install --frozen-lockfile` and `pnpm build`. The launcher uses Node.js 24 from `runtime\node.exe` or your PATH.

Double-click `Start Ultrix Controller.cmd` or run it from PowerShell.

```powershell
& '.\Start Ultrix Controller.cmd'
```

The console prints the release version, database status, and browser URL, then connects to BCS automatically. Open [Admin](http://localhost:8443/admin) on the workstation unless a different web port is configured. Press **Ctrl+C** to stop the console. Start one copy at a time.

The initial defaults are BCS `10.10.10.156:12345`, a `1000 ms` delta request interval, and web port `8443`. The local HTTP launcher binds to loopback. For LAN access, configure TLS and the exact HTTPS origin before starting the server.

## Accounts and settings

- The live database is `data\live\controller.sqlite`. To create the first admin in a fresh database, run `pnpm admin live-admin`. New and reset passwords require at least six characters.
- **Settings** controls the BCS address, GVG port, request interval, web port, and idle logout. A BCS endpoint change takes effect through a fresh connection. A web port change takes effect after restarting the console.
- If a saved port prevents startup, set `$env:WEB_PORT = '8443'` in PowerShell before running the launcher. The override lasts for that shell. After correcting the saved port, remove the override with `Remove-Item Env:WEB_PORT`.
- **Disconnect** stops the BCS connection for the current run. The app connects again at the next startup. Signed-in browsers show **Server Disconnected** until synchronization succeeds.
- **Status** lists online sign-in sessions and allows an admin to sign out a selected session. Idle logout starts off. The absolute session limit is 12 hours.

## Backup and releases

Run `pnpm backup <path-to-backup.sqlite>` to create a consistent database backup. Use the same `BCS_DATA_DIR` as the running app if it is customized. Stop the console before restoring a backup.

Every production change set bumps the version in `package.json` and adds release notes to [CHANGELOG.md](CHANGELOG.md). The console and Settings show the patch number with at least two digits. Tag each verified release locally with its displayed version, such as `v1.0.01`.
