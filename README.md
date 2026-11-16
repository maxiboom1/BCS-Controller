# Ultrix Controller

Ultrix Controller is a Windows-hosted routing panel for Ross Ultricore BCS. One GVG Native connection supplies the routing cache and live updates to all signed-in browsers.

## Start the live console on Windows

Install Node.js 24 LTS and pnpm. From a fresh checkout, run `pnpm install --frozen-lockfile` and `pnpm build`. The launcher uses Node.js 24 from `runtime\node.exe` or your PATH.

Double-click `Start Ultrix Controller.cmd` or run it from PowerShell.

```powershell
& '.\Start Ultrix Controller.cmd'
```

The console prints the release version, database status, and browser URL, then connects to BCS automatically. Open [Admin](http://192.168.10.25:8443/admin) from the workstation or another LAN PC. Use the URL printed in the console if the address or port has changed. Press **Ctrl+C** to stop the console. Start one copy at a time.

The initial defaults are BCS `10.10.10.156:12345`, a `1000 ms` delta request interval, and web port `8443`. The launcher enables plain HTTP on the specific private LAN address `192.168.10.25`. Set `WEB_HOST` before starting the launcher to use a different private IPv4 address. If Windows Firewall is enabled, allow inbound TCP on the web port from the intended LAN clients.

## Accounts and settings

- The live database is `data\live\controller.sqlite`. To create the first admin in a fresh database, run `pnpm admin live-admin`. New and reset passwords require at least six characters.
- **Settings** controls the BCS address, GVG port, request interval, web port, and idle logout. A BCS endpoint change takes effect through a fresh connection. A web port change takes effect after restarting the console.
- If a saved port prevents startup, set `$env:WEB_PORT = '8443'` in PowerShell before running the launcher. The override lasts for that shell. After correcting the saved port, remove the override with `Remove-Item Env:WEB_PORT`.
- After a detected BCS connection failure, the console retries in five seconds and synchronizes before enabling routing. Operator shows **Server Disconnected** until synchronization succeeds. The Admin footer shows the active BCS address, uptime while synchronized, and the app version.
- **Clients** lists online sign-in sessions and allows an admin to sign out a selected session. Idle logout starts off. The absolute session limit is 12 hours.

## Admin catalogues and panels

- **Labels** contains the Sources, Destinations, and Salvos catalogues. Aliases appear in the panel editor and, for sources and destinations, in Operator.
- In **Panels**, use the **Sources**, **Destinations**, and **Salvos** tabs to assign catalogue entries. Use Ctrl or Cmd to select individual rows and Shift to select a range. Use the arrows to transfer or reorder the selection. **Database order** follows BCS catalogue order. **A–Z** uses the displayed label. Salvo assignments are managed in Admin.
- Deleting a panel clears its user assignments. Deleting a user signs them out of all sessions and frees their username. TAKE records keep the user ID and username. The 1.0.03 migration fills in usernames for older records from the accounts in the database.

## Routing in Operator

Select a destination to show its cached status and highlight the routed video source. BCS changes update the display as they arrive. At the default one-second request interval, an external switch can take about two seconds to appear, including the GVG response window.

TAKE verifies the current route at BCS before sending a switch and checks the requested levels afterward. If another switch changed the route, review the updated status and try again. After an uncertain result, select the destination again to verify it. A successful BCS resync also restores routing.

## Backup and releases

Run `pnpm backup <path-to-backup.sqlite>` to create a consistent database backup. Use the same `BCS_DATA_DIR` as the running app if it is customized. Stop the console before restoring a backup.

Every production change set bumps the version in `package.json`, updates affected documentation, and adds release notes to [CHANGELOG.md](CHANGELOG.md). The console and Admin footer show the patch number with at least two digits. Tag each verified release locally with its displayed version, such as `v1.0.04`.
