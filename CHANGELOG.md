# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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