# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0-r2] — 2026-11-24

### Fixed
- **IMEI reading via native pack protocol.** `hh4xmodem-nv` now reads the live
  modem IMEI directly via the native pack protocol (`GetSystemInfo` over TCP 2016)
  instead of executing `AT+GSN` via `sms_tool` over `/dev/ttyUSB2`. This removes
  the dependency on `sms-tool` and serial port access, eliminating the
  "unavailable" status on systems without `sms_tool`.
- Removed `sms-tool` dependency requirement from build scripts.

## [1.2.0-r1] — 2026-11-19

### Added
- **IMEI page (NV item 550).** Reads the live IMEI over `AT+GSN`, shows the
  encoded NV 550 payload and can download a JSON backup. A new IMEI is
  validated (15 digits + Luhn check), staged in the modem's EFS update path and
  applied by a modem/router restart; the page reconnects by itself and confirms
  whether the modem reports the new value. A staged change can be cancelled
  before the reboot.
- **Native ucode pack client (`/usr/share/ucode/hh4xmodem/pack.uc`).** The pack
  protocol lives in one importable module used by the rpcd backend and both
  CLI helpers, replacing the duplicated socket code and the helper-subprocess
  batch script. Batch reads open their connections up front and fetch replies
  in chunks, so the dashboard and Info tabs load faster.
- **Live signal trend.** The Status tab keeps the last 40 signal samples and
  draws sparklines for RSRP and the quality metric, with live min/max and a
  reset button — useful when positioning the router.
- **SMS OTP shortcut.** Verification codes are detected in message bodies and
  can be copied with one click from the inbox list or the message dialog, with
  a clipboard fallback for plain-HTTP LuCI.
- **USSD quick presets.** One-tap balance/data codes (Djezzy, Mobilis, Ooredoo)
  that send immediately. Extra presets can be defined with
  `uci add_list hh4xmodem.settings.ussd_preset='Carrier|Label|*code#'`.
- **`hh4xmodem-ready` service.** Answers the modem's 1 Hz "system start" poll
  over the pack protocol, which stops the endless `system start` /
  `get fd list fail!` lines in the kernel log on stock OpenWrt.

### Fixed
- **Signal readings are hidden when the SIM is not ready.** The Status tab now
  follows the SIM state for the whole signal card (as it already did for the
  bars) and filters per-metric out-of-range sentinels, instead of showing stale
  last-known values as live measurements.

### Changed
- `uci-defaults` enables and starts `hh4xmodem-ready` on first boot.
- The `IMEI` entry was added to the Modem menu (read/write access is covered by
  the existing `luci-app-hh4xmodem` ACL groups).

## [1.1.0-r2] — 2026-11-07

### Fixed
- **SMS Compose and USSD no longer blocked when the SIM read fails.** `sms.js`
  and `ussd.js` treated an unknown SIM state (`null`, e.g. a transient RPC
  failure) as "did not report a usable SIM state" and disabled Compose / the
  USSD input, keypad and Send button, contradicting the `load()` contract that
  a failed SIM read must not block sending (the backend re-checks before
  sending). An unknown state is now treated as usable; only known blocked
  states (no SIM, locked, blocked, invalid, initialising) still block the UI.

### Removed
- **Donation QR image (`docs/donate-qr.png`) and "Donate via RedotPay" badge**
  from the README, plus the sponsor badge. USDT/TRC20 address text is kept.

## [1.1.0-r1] — 2026-10-21

### Added
- **NAT tab with modem-side UPnP and DMZ controls.** UPnP can be enabled or
  disabled directly from LuCI, with the new state verified by reading it back
  from the modem. DMZ can be enabled for one host address and disabled again;
  the stored host address is preserved when DMZ is turned off. DMZ enables are
  confirmed and the host address is validated before it is sent, because DMZ
  forwards all otherwise-unforwarded inbound traffic to that host.
- The NAT tab is only shown as available when the modem firmware reports the
  corresponding setting; unsupported settings are labelled "Unavailable"
  instead of being presented as disabled.
- The read-only UPnP row was removed from Info -> LAN / Router; UPnP is now
  managed on the NAT tab.

## [1.0.0-r4] — 2026-10-20

### Removed
- **The "Network Band" row on the Network tab and the raw `Band` value on the
  Info tab.** The modem's `NetworkBand` is a stored "no restriction" sentinel
  (255), not a list of usable bands, and this OEM firmware refuses band changes
  (`Band settings not allowed`); `GetSystemInfo.band` is an unmapped internal
  value. The band actually in use is still shown on the Status tab.

## [1.0.0-r3] — 2026-10-20

### Fixed
- **The Network tab mislabelled the modem's operator-search setting as "Band
  Selection".** `NetselectionMode` selects automatic vs. manual *network (operator)
  search*; it is not a band setting. The row is now "Network Search Mode", and its
  polarity matches the modem firmware (`0 = Automatic`, `1 = Manual`) — the previous
  code had it inverted, so an automatic setting was shown as "Manual".

### Added
- **Modem hardware identification on the Info tab:** model
  (Qualcomm MDM9207), platform (`mdm9607`, Qualcomm 9x07 family), CPU
  (ARM Cortex-A7 / ARMv7l), modem OS (Linux 3.18.20), LTE category (Cat 4,
  150/50 Mbps) and host interface (USB RNDIS `1bbb:0196`, pack API on TCP 2016).

## [1.0.0-r2] — 2026-10-19

### Fixed
- **Signal Quality no longer shows fabricated readings.** Without a usable SIM
  the modem keeps returning its last measurements plus out-of-range sentinels
  (RSRP `-1 dBm`). The whole card is now blanked with an explanation instead of
  drawing live-looking bars, and out-of-3GPP-range values are filtered per metric.
- **Status page "Roaming" reported the wrong source.** It read
  `Domestic_Roaming` from `GetConnectionState`, which has no roaming field at
  all, so it always rendered "No" even while the modem was roaming. It now reads
  `GetNetworkInfo` and shows "Unknown" when the flag is absent.
- **Roaming settings are no longer ambiguously labelled.** "Roaming Connect"
  (connection module), "Allow Domestic Roaming" (network module) and "Roaming
  (active)" (live state) are three distinct modem settings that were all
  displayed as "Roaming".
- **APN profile state is reported honestly.** `getCurrentProfile` returns the
  literal string `"NULL"` for an unnamed profile, which was printed verbatim as
  if it were a profile name. Now shown as "Not set (auto)".
- **USSD no longer hangs without a SIM.** `SendUSSD` never replies when no SIM is
  present, so the request timed out; both the page and the backend now reject it
  up front with the real reason.
- **Sending an SMS without a SIM no longer reports "store space full" (060603).**
  The modem blames its SMS store; the actual cause is the missing SIM.
- **USSD page styling.** `ussd.js` never loaded `hh4xmodem.css`, so `.ussd-output`
  was unstyled.

### Changed
- `send_ussd` and `send_sms` check SIM state (7 = Ready) before contacting the
  modem. A failed SIM read deliberately does not block the action, so a transport
  hiccup cannot stop a legitimate send.

### Known issues
- The list of APN profiles grows by one entry per network-mode change. This is
  modem-side behaviour (`core_app` instantiates a carrier profile on each RAT
  change) and cannot be prevented from LuCI.

## [1.0.0-r1] — 2026-10-08

First standalone release, extracted from the `devopnem/luci` fork.

### Added
- Dashboard with Status, Network, Data Usage and Info tabs.
- Signal quality monitoring (RSRP, RSSI, RSRQ, SINR) with graded bars.
- Connect/disconnect control and preferred network mode selection.
- Data usage tracking with resettable counters.
- SMS inbox, sent, drafts and outbox with read, send and delete.
- USSD code execution with session handling.
- Call log with missed, received, dialled and combined views.
- SIM PIN/PUK management and modem reboot/reset.
- APN profile add, edit, delete and set-default.
- `rpcd` ACL so non-root access can be granted explicitly.
- `uci-defaults` script seeding `/etc/config/hh4xmodem`.

### Changed
- Package now builds standalone in any OpenWrt buildroot, without requiring a
  LuCI source checkout (`luci.mk` no longer used).

### Repository
- Split out of `devopnem/luci` into its own repository, containing only this package.