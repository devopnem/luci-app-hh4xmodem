/*
 * ussd.js - USSD code sender with quick presets for HH4xModem
 * Copyright (C) 2026 HH4xModem
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';
'require rpc';
'require ui';
'require uci';
'require view';

// .ussd-output, .hh4x-warning, and .hh4x-ussd-presets live in this stylesheet.
if (!document.querySelector('link[href*="hh4xmodem.css"]')) {
	document.querySelector('head').appendChild(E('link', {
		'rel': 'stylesheet',
		'type': 'text/css',
		'href': L.resource('view/hh4xmodem/hh4xmodem.css') + '?_=' + Date.now()
	}));
}

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

// Load custom USSD presets from UCI (/etc/config/hh4xmodem):
//   list ussd_preset 'Carrier|Label|*123#'
//   list ussd_preset 'Label|*123#'
// Falls back to DEFAULT_PRESETS when no custom list is configured.
function loadUssdPresets() {
	var raw = uci.get('hh4xmodem', 'settings', 'ussd_preset');
	if (!raw) return DEFAULT_PRESETS;
	var entries = Array.isArray(raw) ? raw : [raw];
	var parsed = [];
	entries.forEach(function(item) {
		if (typeof item !== 'string') return;
		var parts = item.split('|').map(function(s) { return s.trim(); });
		if (parts.length >= 3 && parts[2]) {
			parsed.push({ group: parts[0] || _('Custom'), label: parts[1] || parts[2], code: parts[2] });
		} else if (parts.length === 2 && parts[1]) {
			parsed.push({ group: _('Custom'), label: parts[0] || parts[1], code: parts[1] });
		}
	});
	return parsed.length ? parsed : DEFAULT_PRESETS;
}

// USSD is a network service: without a usable SIM the modem never answers
// SendUSSD, so the request just hangs until the XHR times out. Check up front
// so the page can say why instead of showing a timeout.
// SIM state 7 = Ready. Returns a reason string, or null when the SIM is usable.
// An unknown state (null — SIM read failed) is also usable: the backend
// re-checks before sending, so a transport hiccup must not block the page.
function simBlockReason(sim) {
	var state = (sim && sim.SIMState != null) ? parseInt(sim.SIMState) : null;
	if (state == null || state == 7) return null;
	if (state == 0) return _('No SIM is inserted. Insert a SIM to use USSD codes.');
	if (state == 1) return _('The SIM is not ready yet. Wait a moment and try again.');
	if (state == 2) return _('The SIM is locked. Enter your PIN first, then use USSD codes.');
	if (state == 3) return _('The SIM is locked. Enter your PUK first, then use USSD codes.');
	if (state == 4) return _('The SIM is network-locked (NCK required).');
	if (state == 5) return _('The PUK is blocked.');
	if (state == 6) return _('The SIM is invalid.');
	if (state == 11) return _('The SIM is initialising. Wait a moment and try again.');
	return _('The modem did not report a usable SIM state.');
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function() {
		// A failed SIM read must not block the page; the backend re-checks
		// before it actually sends, and the Send button stays enabled so the
		// user is never stuck with a form that cannot be used.
		return Promise.all([
			callSimStatus().catch(function() { return null; }),
			uci.load('hh4xmodem').catch(function() { return null; })
		]).then(function(res) {
			return { sim: res[0], presets: loadUssdPresets() };
		});
	},

	render: function(data) {
		var sim = data ? data.sim : null;
		var presets = (data && data.presets) ? data.presets : DEFAULT_PRESETS;
		var blocked = simBlockReason(sim);
		var fieldStyle = 'width: 100%; direction: ltr; font-family: monospace; font-size: 1.1em;';

		// Group presets by carrier/category while preserving insertion order.
		var groups = [];
		var groupMap = {};
		presets.forEach(function(p) {
			var g = p.group || _('Presets');
			if (!groupMap[g]) {
				groupMap[g] = [];
				groups.push({ name: g, items: groupMap[g] });
			}
			groupMap[g].push(p);
		});

		var presetRows = groups.map(function(g) {
			return E('div', { 'class': 'hh4x-ussd-group' }, [
				E('span', { 'class': 'hh4x-ussd-group-label' }, [g.name]),
				E('div', { 'class': 'hh4x-ussd-group-btns' }, g.items.map(function(p) {
					return E('button', {
						'class': 'cbi-button cbi-button-neutral hh4x-ussd-preset-btn',
						'title': p.code,
						'disabled': blocked ? true : undefined,
						'click': function(ev) {
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

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [_('USSD Codes')]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Send USSD codes to your network operator (e.g., balance check, data plans).')
			]),
			blocked ? E('div', { 'class': 'hh4x-warning', 'style': 'margin-bottom:1em;' }, [
				E('span', { 'class': 'hh4x-warning-icon' }, ['⚠']),
				E('span', {}, [blocked])
			]) : null,
			E('hr'),
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'cbi-section-node' }, [
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [_('Quick Presets')]),
						E('div', { 'class': 'cbi-value-field hh4x-ussd-presets' }, presetRows)
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [_('USSD Code')]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', {
								'type': 'text',
								'id': 'ussd-code',
								'class': 'cbi-input-text',
								'style': fieldStyle,
								'placeholder': '*100#',
								'autofocus': null,
								'disabled': blocked ? true : undefined,
								'keydown': function(ev) {
									if (ev.keyCode === 13) {
										var btn = document.getElementById('ussd-send');
										if (btn) btn.click();
									}
								}
							})
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [_('Keypad')]),
						E('div', { 'class': 'cbi-value-field', 'style': 'display: flex; flex-wrap: wrap; gap: 4px;' },
							['1','2','3','4','5','6','7','8','9','*','0','#'].map(function(ch) {
								return E('button', {
									'class': 'btn cbi-button',
									'style': 'min-width: 2.8em; font-size: 1.2em; text-align: center;',
									'disabled': blocked ? true : undefined,
									'click': function() {
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
						)
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, ['']),
						E('div', { 'class': 'cbi-value-field' }, [
							E('button', {
								'id': 'ussd-send',
								'class': 'cbi-button cbi-button-action important',
								'disabled': blocked ? true : undefined,
								'click': function(ev) {
									ev.preventDefault();
									var code = document.getElementById('ussd-code');
									if (!code || !code.value.trim()) {
										ui.addNotification(null, E('p', [_('Please enter a USSD code.')]), 'info');
										return;
									}
									sendUssdCode(code.value.trim());
								}
							}, [_('Send')]),
							' ',
							E('button', {
								'class': 'cbi-button cbi-button-neutral',
								'click': function() {
									clearUssd();
								}
							}, [_('Clear')])
						])
					])
				])
			]),
			E('div', { 'id': 'ussd-output', 'class': 'ussd-output', 'style': 'display:none;' })
		]);
	}
});

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

	callSendUssd({ code: code }).then(function(r) {
		if (!r) { showOutput(_('No response from modem.')); return; }
		if (r.error == null && r.text) {
			showOutput(r.text);
		} else if (r.error) {
			showOutput(r.error);
		} else {
			showOutput(_('No response from modem.'));
		}
	}).catch(function(err) {
		showOutput(_('Error: ') + String(err));
	}).finally(function() {
		setButtonsEnabled(true);
		var send = document.getElementById('ussd-send');
		if (send) send.textContent = _('Send');
	});
}
