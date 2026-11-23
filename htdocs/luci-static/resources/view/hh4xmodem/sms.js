/*
 * sms.js - SMS inbox/sent viewer + compose for HH4xModem
 * Copyright (C) 2026 HH4xModem
 * Licensed under the Apache License, Version 2.0.
 */

'use strict';
'require rpc';
'require view';
'require ui';
'require hh4xmodem.common as hh4x';

hh4x.ensureCss();

const callSMSData = rpc.declare({
	object: 'hh4xmodem',
	method: 'get_sms_data',
	params: { key: 'inbox', page: 1 }
});

const callContactsCached = rpc.declare({
	object: 'hh4xmodem',
	method: 'get_contacts_cached'
});

const callSendSMS = rpc.declare({
	object: 'hh4xmodem',
	method: 'send_sms',
	params: { phone: '', content: '' },
	reject: true
});

const callDeleteSMS = rpc.declare({
	object: 'hh4xmodem',
	method: 'delete_sms',
	params: { id: null },
	reject: true
});

const callDeleteSMSBulk = rpc.declare({
	object: 'hh4xmodem',
	method: 'delete_sms_bulk',
	params: { ids: [] },
	reject: true
});

// Extract a likely 4-8 digit OTP / verification code from an SMS body.
// Prioritizes codes near OTP keywords (EN/FR/AR) and skips phone numbers or dates.
function extractOtp(text) {
	if (!text || typeof text !== 'string') return null;
	var kwRe = /(?:code|otp|pin|passcode|token|verification|v[eé]rification|confirmation|validation|mot de passe|رمز|كود|تحقق|تأكيد)[^0-9]{0,20}(\d{4,8})\b/i;
	var m = text.match(kwRe);
	if (m) return m[1];
	var cleaned = text
		.replace(/\+?\d{1,3}[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{2,4}/g, ' ')
		.replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, ' ')
		.replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, ' ')
		.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ');
	var matches = cleaned.match(/\b(\d{4,8})\b/g);
	if (!matches) return null;
	for (var i = 0; i < matches.length; i++) {
		var cand = matches[i];
		if (/^(19|20)\d{2}$/.test(cand)) continue;
		return cand;
	}
	return null;
}

function smsSegmentStats(text) {
	var s = text || '';
	var len = s.length;
	var isGsm7 = /^[\x0A\x0D\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà]*$/.test(s);
	var singleMax = isGsm7 ? 160 : 70;
	var multiMax = isGsm7 ? 153 : 67;
	var segments = len === 0 ? 0 : (len <= singleMax ? 1 : Math.ceil(len / multiMax));
	var limit = segments <= 1 ? singleMax : segments * multiMax;
	return {
		len: len,
		segments: segments,
		limit: limit,
		encoding: isGsm7 ? 'GSM-7' : 'UCS-2'
	};
}

function truncate(str, len) {
	if (!str) return '';
	if (str.length <= len) return str;
	return str.substring(0, len) + '...';
}

var currentView = null;
var smsViewState = { key: 'inbox', page: 1 };
var currentSim = null;
var contactList = [];
var contactMap = { exact: {}, suffix: {} };

var smsTabs = [
	{ key: 'inbox', label: _('Inbox') },
	{ key: 'send', label: _('Sent') }
];

function reloadSMSList() {
	if (!currentView) return;
	currentView.load().then(function (newData) {
		var newBody = currentView.render(newData);
		var container = document.querySelector('.hh4x-page');
		if (container && container.parentNode) {
			container.parentNode.replaceChild(newBody, container);
		}
	}).catch(function (err) {
		ui.addNotification(null, E('p', [_('Error loading SMS list: ') + String(err)]), 'error');
	});
}

function showSMSModal(sms) {
	var overlay = document.getElementById('hh4x-sms-modal');
	if (!overlay) {
		overlay = hh4x.createModalOverlay('hh4x-sms-modal');
		document.body.appendChild(overlay);
	}

	var sender = Array.isArray(sms.PhoneNumber) ? sms.PhoneNumber[0] : (sms.PhoneNumber || '--');
	var matched = hh4x.resolveContact(contactMap, sender);
	var displayTitle = matched ? (matched.name + ' (' + sender + ')') : sender;
	var content = sms.SMSContent || _('(No content)');

	overlay.querySelector('.hh4x-modal-title').textContent = displayTitle;
	var body = overlay.querySelector('.hh4x-modal-body');
	body.innerHTML = '';

	body.appendChild(E('div', { 'class': 'hh4x-modal-meta' }, [
		matched ? E('div', { 'class': 'hh4x-modal-info' }, [
			E('span', { 'class': 'hh4x-modal-label' }, [_('Contact: ')]),
			E('span', { 'class': 'hh4x-modal-value', 'dir': 'auto' }, [matched.name])
		]) : null,
		E('div', { 'class': 'hh4x-modal-info' }, [
			E('span', { 'class': 'hh4x-modal-label' }, [_('Number: ')]),
			E('span', { 'class': 'hh4x-modal-value', 'style': 'font-family:monospace;' }, [sender])
		]),
		E('div', { 'class': 'hh4x-modal-info' }, [
			E('span', { 'class': 'hh4x-modal-label' }, [_('Date: ')]),
			E('span', { 'class': 'hh4x-modal-value' }, [sms.SMSTime || '--'])
		]),
		E('div', { 'class': 'hh4x-modal-info' }, [
			E('span', { 'class': 'hh4x-modal-label' }, [_('ID: ')]),
			E('span', { 'class': 'hh4x-modal-value' }, [String(sms.SMSId)])
		])
	].filter(Boolean)));
	body.appendChild(E('div', { 'class': 'hh4x-modal-content', 'dir': 'auto' }, [content]));

	var deleteBtn = E('button', {
		'class': 'cbi-button cbi-button-negative hh4x-delete-btn',
		'click': function (e) {
			e.stopPropagation();
			if (!confirm(_('Delete this message?'))) return;
			deleteBtn.disabled = true;
			deleteBtn.textContent = _('Deleting...');
			callDeleteSMS({ id: sms.SMSId }).then(function (result) {
				if (result && typeof result === 'object' && result.error == null) {
					overlay.style.display = 'none';
					reloadSMSList();
				} else {
					ui.addNotification(null, E('p', [_('Delete failed: ') + (result?.error || _('Unknown error'))]), 'error');
					deleteBtn.disabled = false;
					deleteBtn.textContent = _('Delete');
				}
			}).catch(function (err) {
				ui.addNotification(null, E('p', [_('Error: ') + String(err)]), 'error');
				deleteBtn.disabled = false;
				deleteBtn.textContent = _('Delete');
			});
		}
	}, [_('Delete')]);

	var modalActions = [];
	var modalOtp = extractOtp(sms.SMSContent || '');
	if (modalOtp) {
		var otpLabel = _('Copy OTP: ') + modalOtp;
		var copyBtn = E('button', {
			'class': 'cbi-button cbi-button-action hh4x-otp-btn',
			'click': function (e) {
				e.stopPropagation();
				hh4x.copyToClipboard(modalOtp, copyBtn, otpLabel);
			}
		}, [otpLabel]);
		modalActions.push(copyBtn);
	}
	if (sender && sender !== '--' && /[0-9+]/.test(sender)) {
		modalActions.push(E('button', {
			'class': 'cbi-button cbi-button-action',
			'click': function (e) {
				e.stopPropagation();
				overlay.style.display = 'none';
				showComposeModal(sender);
			}
		}, [_('Reply')]));
		if (!matched) {
			modalActions.push(E('a', {
				'class': 'cbi-button cbi-button-neutral',
				'href': L.url('admin', 'hh4xmodem', 'contacts') + '#add=' + encodeURIComponent(sender)
			}, [_('Save Contact')]));
		}
	}
	modalActions.push(deleteBtn);

	body.appendChild(E('div', { 'class': 'hh4x-modal-actions' }, modalActions));
	overlay.style.display = 'flex';
}

function showComposeModal(prefillPhone) {
	var overlay = document.getElementById('hh4x-compose-modal');
	if (!overlay) {
		overlay = hh4x.createModalOverlay('hh4x-compose-modal');
		document.body.appendChild(overlay);
	}

	overlay.querySelector('.hh4x-modal-title').textContent = _('Compose SMS');
	var body = overlay.querySelector('.hh4x-modal-body');
	body.innerHTML = '';

	var phoneInput = E('input', {
		'type': 'tel',
		'class': 'cbi-input-text',
		'placeholder': _('Phone number'),
		'value': prefillPhone || '',
		'style': 'width:100%;box-sizing:border-box;margin-bottom:8px;font-family:monospace;',
		'id': 'compose-phone'
	});

	if (contactList.length > 0) {
		var picker = E('select', {
			'class': 'cbi-input-select',
			'style': 'width:100%;box-sizing:border-box;margin-bottom:8px;',
			'change': function (e) {
				if (e.target.value) phoneInput.value = e.target.value;
			}
		}, [E('option', { 'value': '' }, [_('— Pick from SIM Contacts —')])].concat(
			contactList.map(function (c) {
				return E('option', { 'value': c.number }, [c.name + ' (' + c.number + ')']);
			})
		));
		body.appendChild(picker);
	}

	var counterEl = E('div', { 'class': 'hh4x-field-hint', 'style': 'margin-bottom:8px;' }, [
		'0 / 160 (GSM-7 · 0 SMS)'
	]);

	var msgInput = E('textarea', {
		'class': 'cbi-input-text',
		'placeholder': _('Message'),
		'dir': 'auto',
		'style': 'width:100%;box-sizing:border-box;min-height:110px;resize:vertical;',
		'id': 'compose-msg',
		'input': function (e) {
			var st = smsSegmentStats(e.target.value);
			counterEl.textContent = _('%d / %d (%s · %d SMS)').format(
				st.len, st.limit, st.encoding, st.segments
			);
		}
	});

	var sendBtn = E('button', {
		'class': 'cbi-button cbi-button-action',
		'id': 'compose-send-btn',
		'style': 'width:100%;',
		'click': function () {
			var blocked = hh4x.simBlockReason(currentSim, _('to send messages'));
			if (blocked) {
				ui.addNotification(null, E('p', [blocked]), 'error');
				return;
			}
			var phone = phoneInput.value.trim();
			var msg = msgInput.value.trim();
			if (!phone) { ui.addNotification(null, E('p', [_('Enter a phone number.')]), 'info'); phoneInput.focus(); return; }
			if (!msg) { ui.addNotification(null, E('p', [_('Enter a message.')]), 'info'); msgInput.focus(); return; }
			sendBtn.disabled = true;
			sendBtn.textContent = _('Sending...');
			callSendSMS({ phone: phone, content: msg }).then(function (result) {
				if (result && typeof result === 'object' && result.error == null) {
					overlay.style.display = 'none';
					ui.addNotification(null, E('p', [_('SMS sent to %s.').format(phone)]), 'info');
					reloadSMSList();
				} else {
					ui.addNotification(null, E('p', [_('Send failed: ') + (result?.error || _('Unknown error'))]), 'error');
					sendBtn.disabled = false;
					sendBtn.textContent = _('Send');
				}
			}).catch(function (err) {
				ui.addNotification(null, E('p', [_('Send error: ') + String(err)]), 'error');
				sendBtn.disabled = false;
				sendBtn.textContent = _('Send');
			});
		}
	}, [_('Send')]);

	body.appendChild(phoneInput);
	body.appendChild(msgInput);
	body.appendChild(counterEl);
	body.appendChild(sendBtn);

	overlay.style.display = 'flex';
	(prefillPhone ? msgInput : phoneInput).focus();
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function () {
		return Promise.all([
			callSMSData({ key: smsViewState.key, page: smsViewState.page }),
			callContactsCached().catch(function () { return null; })
		]).then(function (res) {
			var smsBundle = res[0] || {};
			var cData = res[1] || {};
			currentSim = smsBundle.GetSimStatus || null;
			contactList = Array.isArray(cData.contacts) ? cData.contacts : [];
			contactMap = hh4x.buildContactMap(contactList);
			return smsBundle;
		});
	},

	render: function (bundle) {
		currentView = this;
		var smsResult = (bundle && bundle.GetSMSListByContactNum) || {};
		var storage = (bundle && bundle.GetSMSStorageState) || {};
		var smsList = smsResult.SMSList || [];
		var totalPages = parseInt(smsResult.TotalPageCount, 10) || 1;

		var currentKey = smsViewState.key;
		var currentTab = smsTabs.find(function (t) { return t.key === currentKey; }) || smsTabs[0];
		var tabTitle = currentTab ? currentTab.label : _('SMS');

		var tabBar = E('div', { 'class': 'hh4x-sms-tabs' },
			smsTabs.map(function (t) {
				return E('button', {
					'class': 'hh4x-sms-tab cbi-button' + (t.key === currentKey ? ' hh4x-sms-tab-active cbi-button-action' : ' cbi-button-neutral'),
					'click': function () {
						if (smsViewState.key !== t.key) {
							smsViewState.key = t.key;
							smsViewState.page = 1;
							reloadSMSList();
						}
					}
				}, [t.label]);
			})
		);

		var storageText = '';
		if (storage.TUseCount != null && storage.MaxCount != null) {
			storageText = _('Storage: %d / %d').format(storage.TUseCount, storage.MaxCount);
		} else if (storage.SimUsed != null && storage.SimMax != null) {
			storageText = _('SIM: %d / %d').format(storage.SimUsed, storage.SimMax);
		}

		var simBlocked = hh4x.simBlockReason(currentSim, _('to send messages'));

		var body = E('div', { 'class': 'hh4x-page' }, [
			E('div', { 'class': 'hh4x-page-header hh4x-header-flex' }, [
				E('div', {}, [
					tabBar,
					E('h2', { 'class': 'hh4x-page-title' }, [_('SMS - ' + tabTitle)]),
					E('p', { 'class': 'hh4x-page-desc' }, [
						currentKey === 'inbox' ? _('View received SMS messages.') : _('View sent SMS messages.')
					])
				]),
				E('div', { 'class': 'hh4x-header-actions' }, [
					storageText ? E('span', { 'class': 'hh4x-sms-storage-pill' }, [storageText]) : null,
					E('button', {
						'class': 'cbi-button cbi-button-action',
						'disabled': simBlocked ? true : undefined,
						'click': function () { showComposeModal(''); }
					}, [_('+ Compose')]),
					E('button', {
						'class': 'cbi-button cbi-button-neutral',
						'click': function () { reloadSMSList(); }
					}, [_('Refresh')])
				].filter(Boolean))
			])
		]);

		if (simBlocked) {
			body.appendChild(E('div', { 'class': 'hh4x-warning', 'style': 'margin-bottom:16px;' }, [
				E('span', { 'class': 'hh4x-warning-icon' }, ['⚠']),
				E('span', {}, [simBlocked])
			]));
		}

		var toolbar = E('div', { 'class': 'hh4x-sms-toolbar' }, [
			E('label', { 'class': 'hh4x-sms-toolbar-label' }, [
				E('input', {
					'type': 'checkbox',
					'id': 'select-all-check',
					'change': function (e) {
						var cbs = document.querySelectorAll('.hh4x-sms-check');
						for (var j = 0; j < cbs.length; j++) cbs[j].checked = e.target.checked;
					}
				}),
				_(' Select All')
			]),
			E('button', {
				'class': 'cbi-button cbi-button-negative hh4x-btn-sm',
				'id': 'delete-selected-btn',
				'click': function (e) {
					e.stopPropagation();
					var checked = [];
					var cbs = document.querySelectorAll('.hh4x-sms-check:checked');
					for (var j = 0; j < cbs.length; j++) checked.push(parseInt(cbs[j].value, 10));
					if (checked.length === 0) { ui.addNotification(null, E('p', [_('No messages selected.')]), 'info'); return; }
					if (!confirm(_('Delete %d selected message(s)?').format(checked.length))) return;
					var btn = document.getElementById('delete-selected-btn');
					btn.disabled = true;
					btn.textContent = _('Deleting...');
					callDeleteSMSBulk({ ids: checked }).then(function (result) {
						if (result && typeof result === 'object' && result.error == null) {
							reloadSMSList();
						} else {
							ui.addNotification(null, E('p', [_('Delete failed: ') + (result?.error || _('Unknown error'))]), 'error');
							btn.disabled = false;
							btn.textContent = _('Delete Selected');
						}
					}).catch(function (err) {
						ui.addNotification(null, E('p', [_('Delete error: ') + String(err)]), 'error');
						btn.disabled = false;
						btn.textContent = _('Delete Selected');
					});
				}
			}, [_('Delete Selected')])
		]);

		if (smsList.length === 0) {
			body.appendChild(hh4x.createCard(_('Messages'), [
				E('p', { 'style': 'text-align:center;color:var(--text-color-medium);padding:2em 0;' }, [_('No messages in ' + smsViewState.key + '.')])
			]));
		} else {
			var rows = [];
			for (var i = 0; i < smsList.length; i++) {
				var sms = smsList[i];
				var sender = Array.isArray(sms.PhoneNumber) ? sms.PhoneNumber[0] : (sms.PhoneNumber || '--');
				var matched = hh4x.resolveContact(contactMap, sender);
				var content = sms.SMSContent || '';

				var senderNode = matched
					? E('span', { 'class': 'hh4x-sms-sender', 'dir': 'auto' }, [
						matched.name,
						E('span', { 'class': 'hh4x-resolved-sub', 'dir': 'ltr' }, [sender])
					])
					: E('span', { 'class': 'hh4x-sms-sender' }, [sender]);

				var row = E('div', { 'class': 'hh4x-sms-row' + (sms.SMSType == 1 ? ' hh4x-sms-unread' : '') }, [
					E('div', { 'class': 'hh4x-sms-check-cell' }, [
						E('input', {
							'type': 'checkbox',
							'class': 'hh4x-sms-check',
							'value': sms.SMSId,
							'click': function (e) { e.stopPropagation(); }
						})
					]),
					E('div', { 'class': 'hh4x-sms-body' }, [
						E('div', { 'class': 'hh4x-sms-header' }, [
							senderNode,
							E('span', { 'class': 'hh4x-sms-date' }, [sms.SMSTime || '--'])
						]),
						E('div', { 'class': 'hh4x-sms-preview', 'dir': 'auto' }, [truncate(content, 100)]),
						E('div', { 'class': 'hh4x-sms-id hh4x-sms-footer' }, (function () {
							var items = [E('span', {}, ['ID: ' + sms.SMSId])];
							if (currentKey === 'inbox') {
								var otp = extractOtp(content);
								if (otp) {
									var label = _('Copy OTP: ') + otp;
									var otpBtn = E('button', {
										'class': 'cbi-button cbi-button-action hh4x-otp-btn hh4x-otp-pill',
										'click': function (e) {
											e.stopPropagation();
											hh4x.copyToClipboard(otp, otpBtn, label);
										}
									}, [label]);
									items.push(otpBtn);
								}
							}
							return items;
						})())
					])
				]);

				row.addEventListener('click', (function (smsData) {
					return function (e) {
						if (e.target.type !== 'checkbox') showSMSModal(smsData);
					};
				})(sms));

				rows.push(row);
			}

			var pagination = hh4x.createPagination(smsViewState.page, totalPages, function (nextPage) {
				smsViewState.page = nextPage;
				reloadSMSList();
			});

			body.appendChild(hh4x.createCard(_('Messages (%d)').format(smsList.length), [
				toolbar,
				E('div', { 'class': 'hh4x-sms-list' }, rows),
				pagination
			].filter(Boolean)));
		}

		// Handle #compose=<number> deep link from Contacts or Call Log
		if (!simBlocked && window.location.hash && window.location.hash.indexOf('#compose=') === 0) {
			var preNum = decodeURIComponent(window.location.hash.slice(9));
			history.replaceState(null, '', window.location.pathname + window.location.search);
			setTimeout(function () { showComposeModal(preNum); }, 50);
		}

		return body;
	}
});
