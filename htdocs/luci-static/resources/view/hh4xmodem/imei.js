/*
 * imei.js - IMEI / NV 550 maintenance for HH4xModem
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
'require view';

if (!document.querySelector('link[href*="hh4xmodem.css"]')) {
	document.querySelector('head').appendChild(E('link', {
		'rel': 'stylesheet',
		'type': 'text/css',
		'href': L.resource('view/hh4xmodem/hh4xmodem.css') + '?_=' + Date.now()
	}));
}

const callGetImei = rpc.declare({
	object: 'hh4xmodem',
	method: 'get_imei'
});

const callSetImei = rpc.declare({
	object: 'hh4xmodem',
	method: 'set_imei',
	params: { imei: '' },
	reject: true
});

const callCancelImei = rpc.declare({
	object: 'hh4xmodem',
	method: 'cancel_imei_change',
	reject: true
});

/* Same check as the backend: 15 digits, valid Luhn check digit. */
function luhnOk(s) {
	if (!/^[0-9]{15}$/.test(s)) return false;
	var sum = 0;
	for (var i = 0; i < 14; i++) {
		var d = parseInt(s.charAt(13 - i), 10);
		if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
		sum += d;
	}
	return ((10 - (sum % 10)) % 10) === parseInt(s.charAt(14), 10);
}

function payloadHex(imei) {
	var nibbles = [0x0a];
	for (var i = 0; i < 15; i++) nibbles.push(parseInt(imei.charAt(i), 10));
	var out = ['08'];
	for (var j = 0; j < nibbles.length; j += 2) {
		var b = ((nibbles[j + 1] << 4) | nibbles[j]) & 0xff;
		out.push((b < 16 ? '0' : '') + b.toString(16));
	}
	return out.join(' ');
}

var pollTimer = null;
var pollStart = 0;
var polling = false;

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function() {
		return callGetImei().catch(function() { return null; });
	},

	render: function(info) {
		var self = this;

		var page = E('div', { 'class': 'cbi-map hh4x-page' }, [
			E('h2', { 'class': 'hh4x-page-title' }, [_('IMEI')]),
			E('div', { 'class': 'cbi-map-descr hh4x-page-desc' }, [
				_('Reads the modem IMEI from NV item 550 and restores it on this device.')
			]),

			/* ---- current value ---- */
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [_('Current IMEI')]),
				E('div', { 'class': 'cbi-section-node' }, [
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [_('IMEI')]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('span', {
								'id': 'imei-current',
								'style': 'font-family: monospace; font-size: 1.35em; letter-spacing: 1px;'
							}, [ info && info.imei ? info.imei : _('unavailable') ]),
							' ',
							E('button', {
								'class': 'cbi-button cbi-button-neutral',
								'click': function(ev) {
									ev.preventDefault();
									refresh();
								}
							}, [_('Refresh')])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [_('NV 550 payload')]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('code', { 'id': 'imei-payload' }, [
								info && info.imei ? payloadHex(info.imei) : '—'
							])
						])
					])
				])
			]),

			/* ---- pending state ---- */
			E('div', { 'id': 'imei-state' }, [ stateBlock(info) ]),

			/* ---- change form ---- */
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [_('Change IMEI')]),
				E('div', { 'class': 'hh4x-warning', 'style': 'margin-bottom:1em;' }, [
					E('span', { 'class': 'hh4x-warning-icon' }, ['⚠']),
					E('span', {}, [
						_('The new IMEI is written to the modem NV memory during a restart. ' +
						  'The modem and this router will reboot, the Web UI will be unreachable for ' +
						  'about two minutes, and the page reconnects by itself. Only restore the IMEI ' +
						  'of a device you own.')
					])
				]),
				E('div', { 'class': 'cbi-section-node' }, [
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [_('New IMEI')]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', {
								'id': 'imei-input',
								'type': 'text',
								'class': 'cbi-input-text',
								'style': 'width: 100%; direction: ltr; font-family: monospace; font-size: 1.1em;',
								'placeholder': '15 digits',
								'maxlength': 15,
								'inputmode': 'numeric',
								'autocomplete': 'off',
								'keydown': function(ev) {
									if (ev.keyCode === 13) {
										ev.preventDefault();
										submit();
									}
								}
							})
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, ['']),
						E('div', { 'class': 'cbi-value-field' }, [
							E('button', {
								'id': 'imei-submit',
								'class': 'cbi-button cbi-button-action important',
								'click': function(ev) { ev.preventDefault(); submit(); }
							}, [_('Change IMEI')]),
							' ',
							E('button', {
								'id': 'imei-cancel',
								'class': 'cbi-button cbi-button-neutral',
								'style': 'display:none;',
								'click': function(ev) {
									ev.preventDefault();
									cancelPending();
								}
							}, [_('Cancel pending change')])
						])
					])
				])
			])
		]);

		/* ---- actions ---- */

		function setBusy(busy, text) {
			var btn = document.getElementById('imei-submit');
			var inp = document.getElementById('imei-input');
			if (btn) { btn.disabled = busy; btn.textContent = text || (busy ? _('Applying…') : _('Change IMEI')); }
			if (inp) inp.disabled = busy;
		}

		function showState(html) {
			var box = document.getElementById('imei-state');
			if (box) box.innerHTML = '';
			if (box && html) box.appendChild(html);
		}

		function applyInfo(r) {
			if (!r) return;
			var cur = document.getElementById('imei-current');
			if (cur) cur.textContent = r.imei ? r.imei : _('unavailable');
			var pay = document.getElementById('imei-payload');
			if (pay) pay.textContent = r.imei ? payloadHex(r.imei) : '—';
			showState(stateBlock(r));
			var cancel = document.getElementById('imei-cancel');
			if (cancel) cancel.style.display = (r.state && r.state.phase === 'staged') ? '' : 'none';
		}

		function refresh() {
			return callGetImei().then(function(r) {
				applyInfo(r);
				return r;
			}).catch(function() { return null; });
		}

		function poll() {
			if (polling) return;
			polling = true;
			pollStart = Date.now();
			setBusy(true, _('Waiting for the modem…'));

			var tick = function() {
				callGetImei().then(function(r) {
					applyInfo(r);
					if (r && r.state && (r.state.phase === 'verified' || r.state.phase === 'not-applied')) {
						polling = false;
						setBusy(false);
						if (r.state.phase === 'verified') {
							ui.addNotification(null, E('p', {}, [
								_('IMEI changed to %s.').format(r.state.target)
							]), 'info');
						} else {
							ui.addNotification(null, E('p', {}, [
								_('The modem did not apply the new IMEI.')
							]), 'danger');
						}
						return;
					}
					schedule();
				}).catch(function() {
					/* The router is rebooting - keep waiting. */
					schedule();
				});
			};

			var schedule = function() {
				if (Date.now() - pollStart > 10 * 60 * 1000) {
					polling = false;
					setBusy(false);
					return;
				}
				pollTimer = window.setTimeout(tick, 5000);
			};

			tick();
		}

		function submit() {
			var inp = document.getElementById('imei-input');
			var imei = inp ? inp.value.replace(/\s+/g, '') : '';

			if (!/^[0-9]{15}$/.test(imei)) {
				ui.addNotification(null, E('p', {}, [_('Enter exactly 15 digits.')]), 'warning');
				return;
			}
			if (!luhnOk(imei)) {
				ui.addNotification(null, E('p', {}, [
					_('This IMEI has an invalid check digit (Luhn). Check the number you entered.')
				]), 'warning');
				return;
			}

			confirmChange(imei).then(function(ok) {
				if (!ok) return;
				setBusy(true, _('Staging…'));
				callSetImei({ imei: imei }).then(function(r) {
					if (!r || r.ok === false) {
						setBusy(false);
						ui.addNotification(null, E('p', {}, [
							(r && r.error) ? r.error : _('The modem did not accept the change.')
						]), 'danger');
						return;
					}
					if (r.already) {
						setBusy(false);
						ui.addNotification(null, E('p', {}, [
							_('The modem already uses this IMEI.')
						]), 'info');
						refresh();
						return;
					}
					if (inp) inp.value = '';
					showState(E('div', { 'class': 'hh4x-warning', 'style': 'margin-bottom:1em;' }, [
						E('span', { 'class': 'hh4x-warning-icon' }, ['⏳']),
						E('span', {}, [
							_('IMEI %s is staged. The modem is restarting now — this page will ' +
							  'reconnect and confirm the result automatically.').format(imei)
						])
					]));
					poll();
				}).catch(function() {
					/* The router went down before the reply arrived: the change is
					 * most likely staged, so verify instead of reporting failure. */
					poll();
				});
			});
		}

		function cancelPending() {
			callCancelImei().then(function() {
				ui.addNotification(null, E('p', {}, [_('Pending change cleared.')]), 'info');
				refresh();
			}).catch(function() {
				ui.addNotification(null, E('p', {}, [_('Could not clear the pending change.')]), 'danger');
			});
		}

		/* Start polling when the page is opened while a change is in flight,
		 * so a browser reload after the reboot shows the result. */
		if (info && info.state && info.state.phase === 'staged')
			window.setTimeout(function() { poll(); }, 500);

		return page;
	}
});

/* ---- pending-state panel ---- */

function stateBlock(info) {
	var st = info ? info.state : null;

	if (!st) return null;

	if (st.phase === 'staged') {
		return E('div', { 'class': 'hh4x-warning', 'style': 'margin-bottom:1em;' }, [
			E('span', { 'class': 'hh4x-warning-icon' }, ['⏳']),
			E('span', {}, [
				_('Changing IMEI %s to %s. The modem and router are restarting; the result is ' +
				  'confirmed automatically when they are back.').format(st.previous, st.target)
			])
		]);
	}

	if (st.phase === 'verified') {
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [_('Last change')]),
			E('div', { 'class': 'cbi-section-node' }, [
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, [_('Result')]),
					E('div', { 'class': 'cbi-value-field' }, [
						E('strong', { 'style': 'color: var(--success-color-medium);' }, [_('Verified')]),
						' — ',
						_('the modem reports the new IMEI.')
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, [_('Previous IMEI')]),
					E('div', { 'class': 'cbi-value-field' }, [
						E('code', {}, [ st.previous || '—' ])
					])
				])
			])
		]);
	}

	if (st.phase === 'not-applied') {
		return E('div', { 'class': 'hh4x-warning', 'style': 'margin-bottom:1em;' }, [
			E('span', { 'class': 'hh4x-warning-icon' }, ['⚠']),
			E('span', {}, [
				_('The modem still reports IMEI %s. The change was staged but not applied — ' +
				  'try again, and check the modem log if it keeps failing.').format(st.imei || st.previous || '?')
			])
		]);
	}

	return E('div', { 'class': 'hh4x-warning', 'style': 'margin-bottom:1em;' }, [
		E('span', { 'class': 'hh4x-warning-icon' }, ['⚠']),
		E('span', {}, [ _('Unknown change state: ') + String(st.phase) ])
	]);
}

/* ---- confirmation dialog ---- */

function confirmChange(imei) {
	return new Promise(function(resolve) {
		ui.showModal(_('Change IMEI?'), [
			E('p', {}, [
				_('The modem NV memory will be rewritten to IMEI %s.').format(imei)
			]),
			E('div', { 'class': 'hh4x-warning', 'style': 'margin: 1em 0;' }, [
				E('span', { 'class': 'hh4x-warning-icon' }, ['⚠']),
				E('span', {}, [
					_('The modem and this router restart. The Web UI is unreachable for about ' +
					  'two minutes. Do not power off the device during the restart.')
				])
			]),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn',
					'click': function(ev) {
						ev.preventDefault();
						ui.hideModal();
						resolve(false);
					}
				}, [_('Cancel')]),
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-negative',
					'click': function(ev) {
						ev.preventDefault();
						ui.hideModal();
						resolve(true);
					}
				}, [_('Change IMEI')])
			])
		]);
	});
}
