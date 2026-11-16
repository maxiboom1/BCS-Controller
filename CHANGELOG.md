# Changelog

Each production change set gets a version bump and a dated release entry.

## 1.0.03 · 2026-11-16

- Simplified Admin navigation, combined source and destination aliases under Labels, and standardized compact tables.
- Added tabbed panel editing with bulk transfers, ordered assignments, and Admin-only salvo configuration.
- Added user and panel deletion, with session revocation and retained TAKE history.

## 1.0.02 · 2026-11-10

- Enabled HTTP access on the workstation's private LAN address. The console prints the LAN URL at startup.
- Kept TAKE action IDs compatible with browsers using plain LAN HTTP.

## 1.0.01 · 2026-11-10

- Added startup BCS connection, editable GVG endpoint and polling settings, and a disconnect banner for signed-in clients.
- The Operator highlights the selected destination's video source in red, including when audio is routed from another source.
- Added a saved web port with restart notice and optional idle logout. Added session presence, browser information, idle time, and targeted sign-out in Admin Status.
- Reduced new and reset password requirements to a six-character minimum.
- Replaced request chatter with timestamped startup, BCS, administration, and TAKE messages.
- Updated the production run guide and kept local references and test fixtures out of the current production source tree.

## 1.0.00 · 2026-11-10

- Established the live routing baseline with source and destination catalogues, panels, aliases, and operator assignments.
- Added GVG synchronization, verified all-level TAKES, and the Windows console launcher.
- Added the compact Operator view, mixed-level route inspection, and the approved I/O branding.
