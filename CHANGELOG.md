# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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