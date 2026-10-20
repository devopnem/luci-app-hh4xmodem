#!/bin/sh
# build-apk.sh -- build luci-app-hh4xmodem as a pure-files .apk using the
# imagebuilder's apk tool, then stage it into the imagebuilder so it can be
# baked into a firmware image. No SDK or compiler is needed: the package is
# only scripts and static assets.
#
# Usage:  ./build-apk.sh
#         SRC=/path/to/src IB=/path/to/imagebuilder PKGVER=1.0.0-r4 ./build-apk.sh
#
# Notes for anyone editing this script:
#  * The output filename must be <name>-<version>.apk -- no arch, no underscore
#    before the version.
#  * ALL dependencies must be in ONE space-separated --info value. Repeating
#    --info depends:X --info depends:Y silently keeps only the LAST one.

set -e

# Build source. The standalone repo and the luci feed copy are kept in sync;
# override with SRC=... if building from elsewhere.
SRC="${SRC:-$HOME/Downloads/openwrt/luci-app-hh4xmodem}"
IB="${IB:-$HOME/Downloads/openwrt/openwrt-imagebuilder-25.12.6-ath79-generic.Linux-x86_64}"
APK="$IB/staging_dir/host/bin/apk"

PKGNAME="luci-app-hh4xmodem"
# Keep in step with PKG_RELEASE in the Makefile.
PKGVER="${PKGVER:-1.0.0-r4}"

# 1) Build the package root from the source tree (htdocs -> /www, root -> /)
WORK="$(mktemp -d)"
PKGROOT="$WORK/pkgroot"
mkdir -p "$PKGROOT/www"
# htdocs/ holds the LuCI static tree WITHOUT the "www/" prefix; the Makefile
# adds it via "$(CP) ./htdocs/* $(1)/www/". Copying htdocs/. straight into the
# package root produces paths like luci-static/... instead of
# www/luci-static/..., so the files never reach the web root. Copy under www/.
cp -a "$SRC/htdocs/." "$PKGROOT/www/"
cp -a "$SRC/root/."   "$PKGROOT/"

# 2) Make the .apk directly (no SDK / no compiler needed -- pure script files)
OUT="$WORK/$PKGNAME-$PKGVER.apk"   # <-- NO arch, NO underscore before version
"$APK" mkpkg \
  --output "$OUT" \
  --files "$PKGROOT" \
  --info name:"$PKGNAME" \
  --info version:"$PKGVER" \
  --info arch:noarch \
  --info license:Apache-2.0 \
  --info "depends:luci-base ucode-mod-socket sms-tool"

# NOTE: all dependencies go in ONE space-separated --info value. Repeating
# --info depends:X --info depends:Y silently keeps only the LAST one, which
# drops ucode-mod-socket and breaks the modem RPC helper on a fresh install
# ("Unable to resolve path for module 'socket'").

# 3) Stage into the imagebuilder's local package dir and drop the stale index
cp "$OUT" "$IB/packages/$PKGNAME-$PKGVER.apk"
rm -f "$IB/packages/packages.adb"
rm -rf "$IB/build_dir"

# 4) Leave a copy next to the source so the built package is easy to find
cp "$OUT" "$SRC/"

echo "Built:   $OUT"
echo "Staged:  $IB/packages/$PKGNAME-$PKGVER.apk"
echo "Source:  $SRC"
