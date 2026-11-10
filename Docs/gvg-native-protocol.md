# GVG Native protocol for Ultricore BCS

The routing application uses Grass Valley Series 7000 Native over TCP. The server connects to the Ultricore BCS, loads the active database catalogues and crosspoints, and shares one route cache with every browser panel. The BCS controls the Ultrix FR12. The application uses the BCS for route commands and readback.

| Site item | Value |
| --- | --- |
| BCS endpoint and firmware | `10.10.10.156:12345` · `7.3.0` |
| Ultrix FR12 | `10.10.10.151` |
| Test station | `192.168.10.25` |
| GVG options observed | L4 Echo `OFF`, continuation flag `9` |
| Live verification | 9 November 2026 |

## Startup and live updates

1. Open one persistent TCP connection to the BCS. Serialize commands on that connection so replies can be matched to the request that produced them.
2. Fetch `QN,IS`, `QN,ID`, and `QN,L` in order. Build source and destination maps by logical index and exact name, plus a level map. Wait for each catalogue sequence to finish before sending the next request.
3. Send one bare `QD`. On a fresh connection at this site, it returns the full destination snapshot. Reassemble each destination's `DQ` sequence and check the snapshot against the destination catalogue before publishing the cache. If the snapshot is incomplete, keep the cache stale and resynchronize. Ross documents `BK,D` to force the next bare `QD` to report all destinations.
4. Send bare `QD` about once per second on the same connection. Each reply describes a changed destination across all its reported levels. Replace that destination's cached state as a unit. Leave other cached destinations as they are. Fan out changes from the shared cache to the browser panels.
5. Use a targeted `Qj` when an operator selects a destination or after an app TAKE. If the connection drops or the catalogue no longer matches the active database, mark the cache stale and repeat startup before accepting more TAKES.

The startup sequence above returned **1,176 `DQ` frames for all 1,174 catalogue destinations**. The next bare `QD` returned zero bytes. In a separate one-second polling run, 86 of 88 polls returned zero frames. The other two each returned only `DST 206` as it changed `A-CAM-3 → A-CAM-2 → A-CAM-3`. An idle GVG socket received zero unsolicited frames during a verified route change. Treat one second as the tested starting interval. Capacity under sustained load still needs measurement.

With L4 Echo off, a quiet `QD` can return zero bytes. Use a bounded response window, keep one poll in flight, and avoid starting a new poll while a response sequence is incomplete. Check connection health with an occasional serialized `QT`, which returned `ST,<device-time>` during the probe. A quiet poll alone gives no positive liveness signal. After a timeout on a query that requires a reply, a broken connection, or an incomplete sequence, reconnect and refresh the snapshot. [Grass Valley Native Protocol, section 3](https://www.grassvalley.jp/pdf/RoutingProductsProtocolManual.pdf) · [Ross BCS command table](https://documentation.rossvideo.com/files/Manuals/Routers/Ultrix/Ultracore%20BCS%20User%20Guide%20%282201DR-106%29.pdf)

## TCP framing

```text
SOH  N  sequence  command  [HT field ...]  checksum  EOT
01   4E                                   ASCII     04
```

- `SOH` is `0x01`, `EOT` is `0x04`, and `HT` is `0x09`. The sequence is one ASCII character. Send `0` for a standalone request. The BCS used `9` for continuation and `0` for the last or only frame of a sequence.
- The command is two case-sensitive ASCII characters. The checksum is the negative sum of the bytes from `N` through the end of the body, modulo 256, encoded as two ASCII hex digits. Exclude `SOH`, the checksum digits, and `EOT` from the sum. Include every tab that is present.
- TCP reads can contain part of a frame or several frames. Buffer until `EOT`, validate the checksum, and preserve sequence boundaries. A catalogue's final `0` closes the catalogue. In a bulk `QD`, each destination has its own final `0`.
- The examples use commas to show field boundaries. On the wire, split only on tabs and preserve empty fields. Live catalogue names contained spaces, commas, and names longer than eight bytes. Keep names exactly as received.

| Request | Exact bytes in hex |
| --- | --- |
| `QN,IS` | `01 4E 30 51 4E 09 49 53 33 45 04` |
| `QN,ID` | `01 4E 30 51 4E 09 49 44 34 44 04` |
| `QN,L` | `01 4E 30 51 4E 09 4C 38 45 04` |
| `QD` | `01 4E 30 51 44 45 44 04` |
| `Qj,00CD` | `01 4E 30 51 6A 09 30 30 43 44 44 37 04` |
| `QT` | `01 4E 30 51 54 44 44 04` |

## Routing catalogues

| Request | Reply and entry format | Live result |
| --- | --- | --- |
| `QN,IS` | `NQ,S,count` followed by `name,index,tie-line-flag,level-bitmap` entries | 13,762 source IDs in 3,022 frames. 4,498 named and 9,264 blank. |
| `QN,ID` | `NQ,D,count` followed by `name,index,tie-line-flag,level-bitmap` entries | 1,174 named destination IDs in 347 frames. |
| `QN,L` | `NQ,L,count` followed by `name,index,restriction-flag` entries | 17 levels in two frames. `VID` is `00`, and `AUD 1` through `AUD 16` are `01` through `10` in hex. |

In these replies, `count` is the number of entries in that frame. Examples below show individual entries from the capture.

```text
QN,IS  →  A-CAM-2,0001,N,FFFFFFFF
QN,ID  →  DST 206,00CD,N,FFFFFFFF
QN,L   →  VID,00,N
```

Indices in these replies are zero-based hex. At this site DashBoard destination `206` corresponds to GVG `00CD`, which is decimal `205`. Source `A-CAM-2` is `0001`. Use the catalogue mapping as the authority. The catalogue's `FFFFFFFF` bitmap appeared on every source and destination, even though this database reported only levels `0–16`. Use the level catalogue and destination crosspoint readback to interpret the levels in a route.

Keep the catalogue separate from crosspoint state. A named source can be unused or lose its signal while retaining its configured name. An empty catalogue name is an unnamed ID slot. Preserve the ID and omit the blank entry from named operator choices. Refresh the catalogues at reconnect and on a slower schedule than the one-second status poll so label-only edits are picked up. If a `DQ` name is unknown or ambiguous, refresh and reconcile before applying it. These queries provide the names advertised by GVG. Ross soft-panel alias sets are separate. [Ross database guide](https://documentation.rossvideo.com/files/Manuals/Routers/Ultrix/User%20Guides/Ultrix%20and%20Ultricore%20Database%20Guide.pdf)

## Crosspoint status and mixed routes

```text
DQ,<destination-name>,<group-count>,<group>...
group = protect,chop,source-name,level-bitmap,protecting-device,chop-source
```

`N` means unprotected or not chopping in the respective flag position. `P` indicates protection and `C` indicates chopping. The last two fields can be empty. Group all continuation frames for a destination before applying the result. A source group's bitmap is hexadecimal. Bit 0 is GVG level 0. `0001FFFF` covers levels `0–16`.

```text
DQ,STB MON-4,3,N,N,MV8 (FREE),00000007,,,N,N,OFF-AIR CH11,000000F8,,,N,N,AUX2,0001FF00,,
```

This destination uses `MV8 (FREE)` on levels `0–2`, `OFF-AIR CH11` on `3–7`, and `AUX2` on `8–16`. Keep the source by level and show **MIXED**. Distinguish a single routed source outside the panel, unmatched levels, and stale or unknown state. Route status identifies the selected input. Signal presence is separate.

| Request | Reply | Use |
| --- | --- | --- |
| `QD` | `DQ` | Full startup report and subsequent deltas. Unmatched levels can be absent from the report. |
| `QD,DST 18` | `DQ` | One destination by exact name. The live reply reported `A-CAM-1` on video only. |
| `Qd,DST 18` | `dQ` | One destination by name with explicit `NO_XPT`. The live reply used `00000001` for `A-CAM-1` and `0001FFFE` for `NO_XPT`. |
| `Qj,0011` | `jQ` | One destination by logical index. The live reply reported `0000` on video and `FFFE` on levels `1–16`. Use `Qj` for per-destination TAKE verification. |
| `QI,0011,0000` | `IQ` | Read a single level. This example returned source `0000`. |
| `Qi,0011,0001` | `iQ` | Read a single level with an explicit error sentinel. This example returned `fffe`. Parse numeric hex without regard to case. |

Use `NO_XPT` and `FFFE` as status values, never as routable sources. A changed destination's new `DQ` entry replaces the old groups. Levels missing from the new entry must lose their old source in the cache. A targeted `Qd` or `Qj` can resolve unmatched levels explicitly. The delta feed reports current destination state at poll time. It can collapse several switches between polls. [Grass Valley Native Protocol, section 3](https://www.grassvalley.jp/pdf/RoutingProductsProtocolManual.pdf) · [Ross BCS command table](https://documentation.rossvideo.com/files/Manuals/Routers/Ultrix/Ultricore%20BCS%20User%20Guide%20%282201DR-106%29.pdf)

## All-level TAKE and verification

Use the source and destination names from the current catalogue. The operator stages a source and explicitly presses **TAKE**. Preflight the selected destination with `Qj` and check its expected levels and protection. Send `TD` with the destination and source. Omitting the bitmap selects all destination levels. [Ross BCS command table](https://documentation.rossvideo.com/files/Manuals/Routers/Ultrix/Ultricore%20BCS%20User%20Guide%20%282201DR-106%29.pdf)

```text
TX  TD,DST 206,A-CAM-2
    01 4E 30 54 44 09 44 53 54 20 32 30 36 09 41 2D 43 41 4D 2D 32 39 37 04
TX  Qj,00CD
RX  jQ,00CD,1,N,N,0001,0001FFFF,,
TX  Qd,DST 206
RX  dQ,DST 206,1,N,N,A-CAM-2,0001FFFF,,
```

In the live test, the indexed readback changed from source `0002` to `0001` on all 17 levels. The named readback independently confirmed `A-CAM-2`. Mark a TAKE successful only when readback matches the expected source on every applicable level. On mismatch, return the actual per-level status. If the connection drops after a TAKE may have been sent, report an uncertain outcome and read back after reconnecting. Never replay the TAKE automatically.

## Health and resynchronization commands

| Request | Behavior | Evidence at this site |
| --- | --- | --- |
| `QT` | Query device time. Expect `ST,yyyymmddhhmmss`. | Verified. The reply carries no timezone. |
| `BK,E` | Query this connection's L4 Echo setting. | Verified `KB,E,OFF`. |
| `BK,D` then `QD` | Force the next bare `QD` to report every destination. | Documented by Ross. Fresh connections already returned the full report in the live tests. |
| `BK,E,ON` | Enable L4 Echo for that session. | Documented by Ross. Grass Valley describes `ER,00` as an optional end marker for bulk replies. Verify the BCS behavior before relying on it. |

An acknowledgement can confirm command handling. Route verification comes from crosspoint readback. Keep startup catalogue downloads and health checks serialized with the poll loop. Full catalogue reads are separate from the one-second status poll. [Ross BCS command table](https://documentation.rossvideo.com/files/Manuals/Routers/Ultrix/Ultricore%20BCS%20User%20Guide%20%282201DR-106%29.pdf) · [Grass Valley Native Protocol, section 3](https://www.grassvalley.jp/pdf/RoutingProductsProtocolManual.pdf)

## Salvos

| Request | Purpose | Evidence at this site |
| --- | --- | --- |
| `QN,V` | List salvo names. | Verified `NQ,V,2,STUDIO-A,STUDIO-B`. |
| `QV,<salvo-name>` | Query the salvo's destination, source, and level entries. | Both named queries returned zero bytes. A subsequent `QT` succeeded after the first detail query. Detail retrieval remains unverified. |
| `TS,<salvo-name>` | Execute a named salvo. | Documented by Ross. Execution remains untested on this BCS. |
| RossTalk `GPI <salvo-number>` | Execute a numbered BCS salvo on TCP `7788`, terminated by CRLF. | Documented fallback. Execution remains untested. |

Before enabling salvo execution, map each approved salvo to its expected crosspoints and verify the affected destinations after a separately authorized test. With `QV` silent, use the approved BCS salvo definition as the source for that mapping. [Ross BCS User Guide](<../Ross BCS Docs/Ultricore BCS and Ultricore-SVR User Guide (2201DR-106).pdf>) · [Grass Valley Native Protocol, section 3](https://www.grassvalley.jp/pdf/RoutingProductsProtocolManual.pdf)
