/*
 * ussd.js - USSD code sender with quick presets for HH4xModem
 * Copyright (C) 2026 HH4xModem
 * Licensed under the Apache License, Version 2.0.
 */

'use strict';
'require rpc';
'require ui';
'require uci';
'require view';
'require hh4xmodem.common as hh4x';

hh4x.ensureCss();

const callSendUssd = rpc.declare({
	object: 'hh4xmodem',
	method: 'send_ussd',
	params: { code: '' },
	reject: true
});

const callSimStatus = rpc.declare({
	object: 'hh4xmodem',
	method: 'get_sim_status'
});

const DEFAULT_PRESETS = [
	{ group: 'Djezzy',  label: _('Balance'),     code: '*710#' },
	{ group: 'Djezzy',  label: _('Offers/Data'), code: '*720#' },
	{ group: 'Mobilis', label: _('Balance'),     code: '*222#' },
	{ group: 'Ooredoo', label: _('Balance'),     code: '*200#' },
	{ group: 'Ooredoo', label: _('Internet'),    code: '*113#' }
];

function loadUssdPresets() {
	var raw = uci.get('hh4xmodem', 'settings', 'ussd_preset');
	if (!raw) return DEFAULT_PRESETS;
	var entries = Array.isArray(raw) ? raw : [raw];
	var parsed = [];
	entries.forEach(function (item) {
		if (typeof item !== 'string') return;
		var parts = item.split('|').map(function (s) { return s.trim(); });
		if (parts.length >= 3 && parts[2]) {
			parsed.push({ group: parts[0] || _('Custom'), label: parts[1] || parts[2], code: parts[2] });
		} else if (parts.length === 2 && parts[1]) {
			parsed.push({ group: _('Custom'), label: parts[0] || parts[1], code: parts[1] });
		}
	});
	return parsed.length ? parsed : DEFAULT_PRESETS;
}

function setButtonsEnabled(enabled) {
	var send = document.getElementById('ussd-send');
	var code = document.getElementById('ussd-code');
	if (send) send.disabled = !enabled;
	if (code) code.disabled = !enabled;
	var presets = document.querySelectorAll('.hh4x-ussd-preset-btn');
	for (var i = 0; i < presets.length; i++) presets[i].disabled = !enabled;
}

function showOutput(msg) {
	var out = document.getElementById('ussd-output');
	if (!out) return;
	out.style.display = 'block';
	out.textContent = msg;
}

function clearUssd() {
	var code = document.getElementById('ussd-code');
	var out = document.getElementById('ussd-output');
	if (code) code.value = '';
	if (out) { out.style.display = 'none'; out.textContent = ''; }
	if (code) code.focus();
}

function sendUssdCode(code) {
	showOutput(_('Sending...'));
	setButtonsEnabled(false);

	callSendUssd({ code: code }).then(function (r) {
		if (!r) { showOutput(_('No response from modem.')); return; }
		if (r.error == null && r.text) {
			showOutput(r.text);
		} else if (r.error) {
			showOutput(r.error);
		} else {
			showOutput(_('No response from modem.'));
		}
	}).catch(function (err) {
		showOutput(_('Error: ') + String(err));
	}).finally(function () {
		setButtonsEnabled(true);
		var send = document.getElementById('ussd-send');
		if (send) send.textContent = _('Send');
	});
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function () {
		return Promise.all([
			callSimStatus().catch(function () { return null; }),
			uci.load('hh4xmodem').catch(function () { return null; })
		]).then(function (res) {
			return { sim: res[0], presets: loadUssdPresets() };
		});
	},

	render: function (data) {
		var sim = data ? data.sim : null;
		var presets = (data && data.presets) ? data.presets : DEFAULT_PRESETS;
		var blocked = hh4x.simBlockReason(sim, _('to use USSD codes'));
		var fieldStyle = 'width: 100%; direction: ltr; font-family: monospace; font-size: 1.1em;';

		var groups = [];
		var groupMap = {};
		presets.forEach(function (p) {
			var g = p.group || _('Presets');
			if (!groupMap[g]) {
				groupMap[g] = [];
				groups.push({ name: g, items: groupMap[g] });
			}
			groupMap[g].push(p);
		});

		var presetRows = groups.map(function (g) {
			return E('div', { 'class': 'hh4x-ussd-group' }, [
				E('span', { 'class': 'hh4x-ussd-group-label' }, [g.name]),
				E('div', { 'class': 'hh4x-ussd-group-btns' }, g.items.map(function (p) {
					return E('button', {
						'class': 'cbi-button cbi-button-neutral hh4x-ussd-preset-btn',
						'title': p.code,
						'disabled': blocked ? true : undefined,
						'click': function (ev) {
							ev.preventDefault();
							var inp = document.getElementById('ussd-code');
							if (inp) inp.value = p.code;
							sendUssdCode(p.code);
						}
					}, [
						E('span', { 'class': 'hh4x-ussd-preset-name' }, [p.label]),
						' ',
						E('code', { 'class': 'hh4x-ussd-preset-code' }, [p.code])
					]);
				}))
			]);
		});

		return E('div', { 'class': 'hh4x-page' }, [
			E('div', { 'class': 'hh4x-page-header' }, [
				E('h2', { 'class': 'hh4x-page-title' }, [_('USSD Codes')]),
				E('p', { 'class': 'hh4x-page-desc' }, [
					_('Send USSD codes to your network operator (e.g., balance check, data plans).')
				])
			]),
			blocked ? E('div', { 'class': 'hh4x-warning', 'style': 'margin-bottom:1.2em;' }, [
				E('span', { 'class': 'hh4x-warning-icon' }, ['⚠']),
				E('span', {}, [blocked])
			]) : null,
			hh4x.createCard(_('Quick Presets'), [
				E('div', { 'class': 'hh4x-ussd-presets' }, presetRows)
			]),
			E('div', { 'style': 'height:1.2em;' }),
			hh4x.createCard(_('Dial USSD Code'), [
				E('div', { 'class': 'hh4x-form-group' }, [
					E('label', { 'class': 'hh4x-form-label' }, [_('USSD Code')]),
					E('input', {
						'type': 'text',
						'id': 'ussd-code',
						'class': 'cbi-input-text',
						'style': fieldStyle,
						'placeholder': '*100#',
						'disabled': blocked ? true : undefined,
						'keydown': function (ev) {
							if (ev.keyCode === 13) {
								var btn = document.getElementById('ussd-send');
								if (btn) btn.click();
							}
						}
					})
				]),
				E('div', { 'class': 'hh4x-form-group', 'style': 'display:flex;flex-wrap:wrap;gap:4px;margin-top:0.8em;' },
					['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(function (ch) {
						return E('button', {
							'class': 'btn cbi-button',
							'style': 'min-width: 2.8em; font-size: 1.15em; text-align: center;',
							'disabled': blocked ? true : undefined,
							'click': function () {
								var inp = document.getElementById('ussd-code');
								if (inp) {
									var start = inp.selectionStart || inp.value.length;
									inp.value = inp.value.slice(0, start) + ch + inp.value.slice(inp.selectionEnd || start);
									inp.focus();
									inp.selectionStart = inp.selectionEnd = start + 1;
								}
							}
						}, [ch]);
					})
				),
				E('div', { 'style': 'display:flex;gap:0.5em;margin-top:0.9em;' }, [
					E('button', {
						'id': 'ussd-send',
						'class': 'cbi-button cbi-button-action important',
						'disabled': blocked ? true : undefined,
						'click': function (ev) {
							ev.preventDefault();
							var code = document.getElementById('ussd-code');
							if (!code || !code.value.trim()) {
								ui.addNotification(null, E('p', [_('Please enter a USSD code.')]), 'info');
								return;
							}
							sendUssdCode(code.value.trim());
						}
					}, [_('Send')]),
					E('button', {
						'class': 'cbi-button cbi-button-neutral',
						'click': function () { clearUssd(); }
					}, [_('Clear')])
				]),
				E('div', { 'id': 'ussd-output', 'class': 'ussd-output', 'style': 'display:none;', 'dir': 'auto' })
			])
		].filter(Boolean));
	}
});
