#
# Copyright (C) 2026 HH4xModem
#
# This is free software, licensed under the Apache License, Version 2.0.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-hh4xmodem
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=Devon Openheim <devopenm@proton.me>
PKG_URL:=https://github.com/devopnem/luci-app-hh4xmodem

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-hh4xmodem
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=MDM9207 Modem Manager for HH40V/HH41V
  URL:=https://github.com/devopnem/luci-app-hh4xmodem
  DEPENDS:=+luci-base +ucode-mod-socket
  PKGARCH:=all
endef

define Package/luci-app-hh4xmodem/description
  LuCI interface to monitor and control the MDM9207 modem in HH40V and HH41V
  routers. Provides signal quality monitoring, network mode selection, data
  usage tracking, SMS management, USSD codes, call logs and device
  information.
endef

define Package/luci-app-hh4xmodem/conffiles
/etc/config/hh4xmodem
endef

# The LuCI sources and the install tree are shipped as-is, so there is
# nothing to compile or stage.
define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/luci-app-hh4xmodem/install
	$(INSTALL_DIR) $(1)/www
	$(CP) ./htdocs/* $(1)/www/
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./root/etc/uci-defaults/80_hh4xmodem $(1)/etc/uci-defaults/
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./root/usr/bin/hh4xmodem-pack $(1)/usr/bin/
	$(INSTALL_BIN) ./root/usr/bin/hh4xmodem-get-all $(1)/usr/bin/
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-hh4xmodem.json \
		$(1)/usr/share/luci/menu.d/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-hh4xmodem.json \
		$(1)/usr/share/rpcd/acl.d/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/ucode
	$(INSTALL_DATA) ./root/usr/share/rpcd/ucode/hh4xmodem.uc \
		$(1)/usr/share/rpcd/ucode/
endef

# /etc/config/hh4xmodem is populated by the shipped uci-defaults script,
# which runs on first boot after installation.
$(eval $(call BuildPackage,luci-app-hh4xmodem))