/*
 * common.js - Shared UI & utility module for HH4xModem LuCI views
 * Copyright (C) 2026 HH4xModem
 * Licensed under the Apache License, Version 2.0.
 */

'use strict';
'require baseclass';
'require ui';

const ASSET_VERSION = '1.3.0';

const AVATAR_COLORS = [
	'#3b82f6', '#10b981', '#f59e0b', '#ef4444',
	'#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6'
];

return baseclass.extend({
	ensureCss: function () {
		if (!document.querySelector('link[href*="hh4xmodem.css"]')) {
			document.querySelector('head').appendChild(E('link', {
				'rel': 'stylesheet',
				'type': 'text/css',
				'href': L.resource('view/hh4xmodem/hh4xmodem.css') + '?v=' + ASSET_VERSION
			}));
		}
	},

	createCard: function (title, content, icon, id) {
		var headerChildren = [];
		if (icon) headerChildren.push(E('span', { 'class': 'hh4x-card-icon' }, [icon]));
		headerChildren.push(E('h3', { 'class': 'hh4x-card-title' }, [title]));
		return E('div', { 'class': 'cbi-section hh4x-card', 'id': id || undefined }, [
			E('div', { 'class': 'hh4x-card-header' }, headerChildren),
			E('div', { 'class': 'hh4x-card-body' }, content)
		]);
	},

	createInfoRow: function (label, value, className, id) {
		return E('div', { 'class': 'hh4x-info-row' + (className ? ' ' + className : ''), 'id': id || undefined }, [
			E('span', { 'class': 'hh4x-info-label' }, [label]),
			E('span', { 'class': 'hh4x-info-value' }, [value != null ? String(value) : '--'])
		]);
	},

	updateInfoValue: function (rowOrId, value) {
		var row = (typeof rowOrId === 'string') ? document.getElementById(rowOrId) : rowOrId;
		if (!row) return;
		var valEl = row.querySelector('.hh4x-info-value');
		if (valEl) valEl.textContent = value != null ? String(value) : '--';
	},

	formatBytes: function (bytes) {
		if (bytes == null || bytes == 0) return '0 B';
		var units = ['B', 'KB', 'MB', 'GB', 'TB'];
		var k = 1024;
		var i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
		return (bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
	},

	formatSpeed: function (bps) {
		if (bps == null || bps == 0) return '--';
		var bpsNum = parseInt(bps, 10);
		if (bpsNum >= 125000) return (bpsNum / 125000).toFixed(1) + ' Mbps';
		if (bpsNum >= 125) return (bpsNum / 125).toFixed(0) + ' Kbps';
		return bpsNum + ' Bps';
	},

	formatDuration: function (seconds) {
		if (seconds == null || seconds === 0) return '--';
		var h = Math.floor(seconds / 3600);
		var m = Math.floor((seconds % 3600) / 60);
		var s = Math.floor(seconds % 60);
		if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
		if (m > 0) return m + 'm ' + s + 's';
		return s + 's';
	},

	simBlockReason: function (sim, actionText) {
		var state = (sim && sim.SIMState != null) ? parseInt(sim.SIMState, 10) : null;
		if (state == null || state == 7) return null;
		var suffix = actionText ? (' ' + actionText) : '';
		if (state == 0) return _('No SIM is inserted. Insert a SIM%s.').format(suffix);
		if (state == 1) return _('The SIM is not ready yet. Wait a moment and try again.');
		if (state == 2) return _('The SIM is locked. Enter your PIN first.');
		if (state == 3) return _('The SIM is locked. Enter your PUK first.');
		if (state == 4) return _('The SIM is network-locked (NCK required).');
		if (state == 5) return _('The PUK is blocked.');
		if (state == 6) return _('The SIM is invalid.');
		if (state == 11) return _('The SIM is initialising. Wait a moment and try again.');
		return _('The modem did not report a usable SIM state.');
	},

	copyToClipboard: function (text, btn, idleLabel) {
		var done = function () {
			if (!btn) return;
			btn.textContent = _('✓ Copied');
			btn.classList.add('hh4x-otp-copied');
			setTimeout(function () {
				btn.textContent = idleLabel;
				btn.classList.remove('hh4x-otp-copied');
			}, 1500);
		};
		var fallback = function () {
			var ta = document.createElement('textarea');
			ta.value = text;
			ta.setAttribute('readonly', '');
			ta.style.position = 'fixed';
			ta.style.left = '-9999px';
			document.body.appendChild(ta);
			ta.select();
			try {
				document.execCommand('copy');
				done();
			} catch (e) {
				ui.addNotification(null, E('p', [_('Copy failed: ') + text]), 'info');
			}
			document.body.removeChild(ta);
		};
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).then(done).catch(fallback);
		} else {
			fallback();
		}
	},

	createModalOverlay: function (id) {
		var overlay = E('div', { 'class': 'hh4x-modal-overlay', 'id': id || undefined, 'style': 'display:none;' });
		var modal = E('div', { 'class': 'hh4x-modal' }, [
			E('div', { 'class': 'hh4x-modal-header' }, [
				E('span', { 'class': 'hh4x-modal-title' }),
				E('button', {
					'class': 'hh4x-modal-close cbi-button',
					'click': function () { overlay.style.display = 'none'; }
				}, [_('Close')])
			]),
			E('div', { 'class': 'hh4x-modal-body' })
		]);
		overlay.appendChild(modal);
		overlay.addEventListener('click', function (e) {
			if (e.target === overlay) overlay.style.display = 'none';
		});
		return overlay;
	},

	normalizePhone: function (num) {
		if (!num) return '';
		return String(num).replace(/[^0-9]/g, '');
	},

	buildContactMap: function (contacts) {
		var map = { exact: {}, suffix: {} };
		if (!Array.isArray(contacts)) return map;
		for (var i = 0; i < contacts.length; i++) {
			var c = contacts[i];
			if (!c || !c.number || !c.name) continue;
			var digits = this.normalizePhone(c.number);
			if (!digits) continue;
			map.exact[digits] = c;
			if (digits.length >= 8) {
				var tail = digits.slice(-9);
				if (!map.suffix[tail]) map.suffix[tail] = c;
			}
		}
		return map;
	},

	resolveContact: function (map, number) {
		if (!map || !number) return null;
		var digits = this.normalizePhone(number);
		if (!digits) return null;
		if (map.exact[digits]) return map.exact[digits];
		if (digits.length >= 8) {
			var tail = digits.slice(-9);
			if (map.suffix[tail]) return map.suffix[tail];
		}
		return null;
	},

	avatarInitials: function (name) {
		var s = String(name || '').trim();
		if (!s) return '?';
		var parts = s.split(/\s+/);
		if (parts.length >= 2)
			return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
		return s.slice(0, 2).toUpperCase();
	},

	avatarColor: function (name) {
		var s = String(name || '');
		var h = 0;
		for (var i = 0; i < s.length; i++)
			h = ((h << 5) - h) + s.charCodeAt(i);
		return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
	},

	createPagination: function (currentPage, totalPages, onPageChange) {
		if (!totalPages || totalPages <= 1) return null;
		return E('div', { 'class': 'hh4x-pagination' }, [
			E('button', {
				'class': 'cbi-button cbi-button-neutral',
				'disabled': currentPage <= 1 ? true : undefined,
				'click': function (e) {
					e.preventDefault();
					if (currentPage > 1) onPageChange(currentPage - 1);
				}
			}, [_('← Previous')]),
			E('span', { 'class': 'hh4x-page-indicator' }, [
				_('Page %d of %d').format(currentPage, totalPages)
			]),
			E('button', {
				'class': 'cbi-button cbi-button-neutral',
				'disabled': currentPage >= totalPages ? true : undefined,
				'click': function (e) {
					e.preventDefault();
					if (currentPage < totalPages) onPageChange(currentPage + 1);
				}
			}, [_('Next →')])
		]);
	}
});
