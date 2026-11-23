/*
 * contacts.js - SIM Contact Book manager for HH4xModem
 * Copyright (C) 2026 HH4xModem
 * Licensed under the Apache License, Version 2.0.
 */

'use strict';
'require rpc';
'require view';
'require ui';
'require hh4xmodem.common as hh4x';

hh4x.ensureCss();

const callGetContacts = rpc.declare({
	object: 'hh4xmodem',
	method: 'get_contacts',
	params: { force: false }
});

const callSaveContact = rpc.declare({
	object: 'hh4xmodem',
	method: 'save_contact',
	params: { index: 0, name: '', number: '' },
	reject: true
});

const callDeleteContact = rpc.declare({
	object: 'hh4xmodem',
	method: 'delete_contact',
	params: { index: 0 },
	reject: true
});

const callDeleteContactsBulk = rpc.declare({
	object: 'hh4xmodem',
	method: 'delete_contacts_bulk',
	params: { indices: [] },
	reject: true
});

const callImportContacts = rpc.declare({
	object: 'hh4xmodem',
	method: 'import_contacts',
	params: { contacts: [] },
	reject: true
});

var currentView = null;
var currentData = null;
var searchQuery = '';

function isAsciiOnly(str) {
	return /^[\x20-\x7E]*$/.test(str || '');
}

// SIM EF_ADN stores UCS2 names with a 1-byte 0x80 prefix + 2 bytes/char,
// so non-ASCII (e.g. Arabic) names typically fit half as many characters.
function effectiveNameLimit(name, maxNameLen) {
	var rawMax = maxNameLen || 14;
	if (!isAsciiOnly(name)) return Math.max(4, Math.floor((rawMax - 1) / 2));
	return rawMax;
}

function downloadTextFile(filename, content, mime) {
	var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
	var a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

function exportVcf(contacts) {
	var lines = [];
	contacts.forEach(function (c) {
		lines.push('BEGIN:VCARD');
		lines.push('VERSION:3.0');
		lines.push('FN:' + (c.name || '').replace(/[\r\n]/g, ' '));
		lines.push('TEL;TYPE=CELL:' + (c.number || ''));
		lines.push('END:VCARD');
	});
	downloadTextFile('sim_contacts.vcf', lines.join('\r\n') + '\r\n', 'text/vcard;charset=utf-8');
}

function exportCsv(contacts) {
	var esc = function (v) {
		var s = String(v == null ? '' : v);
		if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
		return s;
	};
	var lines = ['Slot,Name,Number'];
	contacts.forEach(function (c) {
		lines.push([c.index, esc(c.name), esc(c.number)].join(','));
	});
	downloadTextFile('sim_contacts.csv', '\uFEFF' + lines.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
}

function decodeQuotedPrintableUtf8(str) {
	var bytes = [];
	for (var i = 0; i < str.length; i++) {
		if (str[i] === '=' && i + 2 < str.length && /^[0-9A-Fa-f]{2}$/.test(str.substr(i + 1, 2))) {
			bytes.push(parseInt(str.substr(i + 1, 2), 16));
			i += 2;
		} else {
			bytes.push(str.charCodeAt(i) & 0xFF);
		}
	}
	try {
		return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
	} catch (e) {
		return str;
	}
}

function parseVcf(text) {
	// Unfold soft line breaks and folded vCard lines
	var unfolded = text.replace(/=\r?\n/g, '').replace(/\r?\n[ \t]/g, '');
	var cards = unfolded.split(/BEGIN:VCARD/i);
	var out = [];
	for (var i = 1; i < cards.length; i++) {
		var lines = cards[i].split(/\r?\n/);
		var name = '';
		var number = '';
		for (var j = 0; j < lines.length; j++) {
			var line = lines[j].trim();
			var sep = line.indexOf(':');
			if (sep < 0) continue;
			var key = line.slice(0, sep).toUpperCase();
			var val = line.slice(sep + 1).trim();
			if (/^FN(;|$)/.test(key) || (!name && /^N(;|$)/.test(key))) {
				if (key.indexOf('QUOTED-PRINTABLE') >= 0)
					val = decodeQuotedPrintableUtf8(val);
				if (/^N(;|$)/.test(key))
					val = val.split(';').filter(Boolean).reverse().join(' ');
				if (val) name = val.trim();
			} else if (!number && /^TEL(;|$)/.test(key)) {
				var cleaned = val.replace(/[^0-9+*#]/g, '');
				if (cleaned) number = cleaned;
			}
		}
		if (name && number) out.push({ name: name, number: number });
	}
	return out;
}

function parseCsvLine(line) {
	var cols = [];
	var cur = '';
	var inQuotes = false;
	for (var i = 0; i < line.length; i++) {
		var ch = line[i];
		if (inQuotes) {
			if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
			else if (ch === '"') inQuotes = false;
			else cur += ch;
		} else {
			if (ch === '"') inQuotes = true;
			else if (ch === ',') { cols.push(cur.trim()); cur = ''; }
			else cur += ch;
		}
	}
	cols.push(cur.trim());
	return cols;
}

function parseCsv(text) {
	var lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
	if (!lines.length) return [];
	var first = parseCsvLine(lines[0]).map(function (c) { return c.toLowerCase(); });
	var nameCol = -1, numCol = -1, startRow = 0;
	for (var i = 0; i < first.length; i++) {
		if (nameCol < 0 && /name|nom|contact/.test(first[i])) nameCol = i;
		if (numCol < 0 && /num|phone|tel|mobile/.test(first[i])) numCol = i;
	}
	if (nameCol >= 0 || numCol >= 0) {
		startRow = 1;
		if (nameCol < 0) nameCol = 0;
		if (numCol < 0) numCol = 1;
	} else if (first.length >= 3 && /^\d+$/.test(first[0])) {
		nameCol = 1; numCol = 2;
	} else {
		nameCol = 0; numCol = 1;
	}

	var out = [];
	for (var r = startRow; r < lines.length; r++) {
		var cols = parseCsvLine(lines[r]);
		var name = (cols[nameCol] || '').trim();
		var num = (cols[numCol] || '').replace(/[^0-9+*#]/g, '');
		if (name && num) out.push({ name: name, number: num });
	}
	return out;
}

function reloadContacts(force) {
	if (!currentView) return;
	var refreshBtn = document.getElementById('contacts-refresh-btn');
	if (refreshBtn) {
		refreshBtn.disabled = true;
		refreshBtn.textContent = _('Reading SIM...');
	}
	callGetContacts({ force: !!force }).then(function (newData) {
		var newBody = currentView.render(newData);
		var container = document.querySelector('.hh4x-page');
		if (container && container.parentNode)
			container.parentNode.replaceChild(newBody, container);
	}).catch(function (err) {
		ui.addNotification(null, E('p', [_('Error loading SIM contacts: ') + String(err)]), 'error');
		if (refreshBtn) {
			refreshBtn.disabled = false;
			refreshBtn.textContent = _('Refresh SIM');
		}
	});
}

function showContactModal(contact) {
	var overlay = document.getElementById('hh4x-contact-modal');
	if (!overlay) {
		overlay = hh4x.createModalOverlay('hh4x-contact-modal');
		document.body.appendChild(overlay);
	}

	var isEdit = !!(contact && contact.index > 0);
	var maxName = (currentData && currentData.max_name_len) || 14;
	var maxNum = (currentData && currentData.max_number_len) || 40;

	overlay.querySelector('.hh4x-modal-title').textContent = isEdit
		? _('Edit Contact (Slot #%d)').format(contact.index)
		: _('Add SIM Contact');

	var body = overlay.querySelector('.hh4x-modal-body');
	body.innerHTML = '';

	var nameHint = E('div', { 'class': 'hh4x-field-hint' });
	var updateNameHint = function (val) {
		var limit = effectiveNameLimit(val, maxName);
		var len = (val || '').length;
		var mode = isAsciiOnly(val) ? 'ASCII' : 'Unicode/UCS2';
		nameHint.textContent = _('%d / ~%d chars (%s)').format(len, limit, mode);
		nameHint.className = 'hh4x-field-hint' + (len > limit ? ' hh4x-hint-warn' : '');
	};

	var nameInput = E('input', {
		'type': 'text',
		'id': 'contact-form-name',
		'class': 'cbi-input-text',
		'dir': 'auto',
		'value': (contact && contact.name) || '',
		'placeholder': _('Contact name (Latin or Arabic)'),
		'style': 'width:100%;box-sizing:border-box;',
		'input': function (e) { updateNameHint(e.target.value); }
	});
	updateNameHint((contact && contact.name) || '');

	var numInput = E('input', {
		'type': 'tel',
		'id': 'contact-form-number',
		'class': 'cbi-input-text',
		'dir': 'ltr',
		'value': (contact && contact.number) || '',
		'maxlength': maxNum,
		'placeholder': _('+213555123456 or 0555123456'),
		'style': 'width:100%;box-sizing:border-box;font-family:monospace;'
	});

	var slotInput = E('input', {
		'type': 'number',
		'id': 'contact-form-slot',
		'class': 'cbi-input-text',
		'min': 0,
		'max': (currentData && currentData.total) || 250,
		'value': isEdit ? contact.index : '',
		'placeholder': _('Auto (first free SIM slot)'),
		'disabled': isEdit ? true : undefined,
		'style': 'width:100%;box-sizing:border-box;'
	});

	var saveBtn = E('button', {
		'class': 'cbi-button cbi-button-apply',
		'id': 'contact-save-btn',
		'click': function (e) {
			e.preventDefault();
			var name = nameInput.value.trim();
			var number = numInput.value.trim().replace(/[^0-9+*#]/g, '');
			var slot = isEdit ? contact.index : (parseInt(slotInput.value, 10) || 0);
			if (!name) {
				ui.addNotification(null, E('p', [_('Enter a contact name.')]), 'info');
				nameInput.focus();
				return;
			}
			if (!number) {
				ui.addNotification(null, E('p', [_('Enter a valid phone number.')]), 'info');
				numInput.focus();
				return;
			}
			saveBtn.disabled = true;
			saveBtn.textContent = _('Saving to SIM...');
			callSaveContact({ index: slot, name: name, number: number }).then(function (r) {
				if (r && r.error == null) {
					overlay.style.display = 'none';
					ui.addNotification(null, E('p', [_('Contact "%s" saved to SIM.').format(name)]), 'info');
					reloadContacts(true);
				} else {
					ui.addNotification(null, E('p', [_('Save failed: ') + ((r && r.error) || _('Unknown error'))]), 'error');
					saveBtn.disabled = false;
					saveBtn.textContent = _('Save');
				}
			}).catch(function (err) {
				ui.addNotification(null, E('p', [_('Save error: ') + String(err)]), 'error');
				saveBtn.disabled = false;
				saveBtn.textContent = _('Save');
			});
		}
	}, [_('Save')]);

	body.appendChild(E('div', { 'class': 'hh4x-form-group' }, [
		E('label', { 'class': 'hh4x-form-label' }, [_('Name')]),
		nameInput,
		nameHint
	]));
	body.appendChild(E('div', { 'class': 'hh4x-form-group' }, [
		E('label', { 'class': 'hh4x-form-label' }, [_('Phone Number')]),
		numInput
	]));
	if (!isEdit) {
		body.appendChild(E('div', { 'class': 'hh4x-form-group' }, [
			E('label', { 'class': 'hh4x-form-label' }, [_('SIM Slot (optional)')]),
			slotInput
		]));
	}
	body.appendChild(E('div', { 'class': 'hh4x-modal-actions' }, [
		E('button', {
			'class': 'cbi-button cbi-button-neutral',
			'click': function () { overlay.style.display = 'none'; }
		}, [_('Cancel')]),
		saveBtn
	]));

	overlay.style.display = 'flex';
	nameInput.focus();
}

function showImportModal(entries, filename) {
	var overlay = document.getElementById('hh4x-import-modal');
	if (!overlay) {
		overlay = hh4x.createModalOverlay('hh4x-import-modal');
		document.body.appendChild(overlay);
	}

	overlay.querySelector('.hh4x-modal-title').textContent = _('Import Contacts (%s)').format(filename);
	var body = overlay.querySelector('.hh4x-modal-body');
	body.innerHTML = '';

	var freeSlots = (currentData && currentData.total != null && currentData.used != null)
		? Math.max(0, currentData.total - currentData.used) : null;

	body.appendChild(E('p', { 'style': 'margin-top:0;' }, [
		_('Found %d contact(s) ready to write to the SIM card.').format(entries.length),
		freeSlots != null ? (' ' + _('Available SIM slots: %d.').format(freeSlots)) : ''
	]));

	var previewList = E('div', { 'class': 'hh4x-import-preview' },
		entries.slice(0, 50).map(function (c) {
			return E('div', { 'class': 'hh4x-info-row' }, [
				E('span', { 'class': 'hh4x-info-label', 'dir': 'auto' }, [c.name]),
				E('span', { 'class': 'hh4x-info-value', 'style': 'font-family:monospace;' }, [c.number])
			]);
		})
	);
	if (entries.length > 50) {
		previewList.appendChild(E('div', { 'style': 'padding:0.4em 0;color:var(--text-color-medium);font-size:0.85em;' }, [
			_('...and %d more').format(entries.length - 50)
		]));
	}
	body.appendChild(previewList);

	var importBtn = E('button', {
		'class': 'cbi-button cbi-button-apply',
		'click': function () {
			importBtn.disabled = true;
			importBtn.textContent = _('Importing...');
			callImportContacts({ contacts: entries }).then(function (r) {
				overlay.style.display = 'none';
				if (r && r.error == null) {
					var msg = _('Imported %d contact(s) to SIM.').format(r.imported || 0);
					if (r.skipped > 0) msg += ' ' + _('%d skipped.').format(r.skipped);
					ui.addNotification(null, E('p', [msg]), 'info');
					reloadContacts(true);
				} else {
					ui.addNotification(null, E('p', [_('Import failed: ') + ((r && r.error) || _('Unknown error'))]), 'error');
				}
			}).catch(function (err) {
				overlay.style.display = 'none';
				ui.addNotification(null, E('p', [_('Import error: ') + String(err)]), 'error');
			});
		}
	}, [_('Import %d Contact(s)').format(entries.length)]);

	body.appendChild(E('div', { 'class': 'hh4x-modal-actions' }, [
		E('button', {
			'class': 'cbi-button cbi-button-neutral',
			'click': function () { overlay.style.display = 'none'; }
		}, [_('Cancel')]),
		importBtn
	]));

	overlay.style.display = 'flex';
}

function renderContactList(contacts, container) {
	container.innerHTML = '';
	var q = searchQuery.trim().toLowerCase();
	var filtered = contacts.filter(function (c) {
		if (!q) return true;
		return (c.name || '').toLowerCase().indexOf(q) >= 0 ||
		       (c.number || '').toLowerCase().indexOf(q) >= 0 ||
		       String(c.index).indexOf(q) >= 0;
	});

	var countBadge = document.getElementById('contacts-count-badge');
	if (countBadge) {
		countBadge.textContent = q
			? _('%d of %d contacts').format(filtered.length, contacts.length)
			: _('%d contacts').format(contacts.length);
	}

	if (filtered.length === 0) {
		container.appendChild(E('p', {
			'style': 'text-align:center;color:var(--text-color-medium);padding:2em 0;'
		}, [q ? _('No contacts match "%s".').format(searchQuery) : _('No contacts stored on this SIM card.')]));
		return;
	}

	filtered.forEach(function (c) {
		var copyBtn;
		copyBtn = E('button', {
			'class': 'cbi-button cbi-button-neutral hh4x-btn-sm',
			'title': _('Copy phone number'),
			'click': function (e) {
				e.stopPropagation();
				hh4x.copyToClipboard(c.number, copyBtn, _('Copy'));
			}
		}, [_('Copy')]);

		var row = E('div', { 'class': 'hh4x-contact-row' }, [
			E('div', { 'class': 'hh4x-sms-check-cell' }, [
				E('input', {
					'type': 'checkbox',
					'class': 'hh4x-contact-check',
					'value': c.index
				})
			]),
			E('div', {
				'class': 'hh4x-contact-avatar',
				'style': 'background:' + hh4x.avatarColor(c.name) + ';'
			}, [hh4x.avatarInitials(c.name)]),
			E('div', { 'class': 'hh4x-contact-main' }, [
				E('div', { 'class': 'hh4x-contact-name', 'dir': 'auto' }, [c.name || _('(Unnamed)')]),
				E('div', { 'class': 'hh4x-contact-meta' }, [
					E('span', { 'class': 'hh4x-contact-number', 'dir': 'ltr' }, [c.number || '--']),
					E('span', { 'class': 'hh4x-slot-pill' }, ['#' + c.index])
				])
			]),
			E('div', { 'class': 'hh4x-contact-actions' }, [
				E('a', {
					'class': 'cbi-button cbi-button-action hh4x-btn-sm',
					'href': L.url('admin', 'hh4xmodem', 'sms') + '#compose=' + encodeURIComponent(c.number || ''),
					'title': _('Send SMS')
				}, [_('SMS')]),
				copyBtn,
				E('button', {
					'class': 'cbi-button cbi-button-neutral hh4x-btn-sm',
					'click': function () { showContactModal(c); }
				}, [_('Edit')]),
				E('button', {
					'class': 'cbi-button cbi-button-negative hh4x-btn-sm',
					'click': function (e) {
						if (!confirm(_('Delete "%s" (%s) from SIM slot #%d?').format(c.name, c.number, c.index))) return;
						var btn = e.target;
						btn.disabled = true;
						btn.textContent = '...';
						callDeleteContact({ index: c.index }).then(function (r) {
							if (r && r.error == null) {
								reloadContacts(true);
							} else {
								ui.addNotification(null, E('p', [_('Delete failed: ') + ((r && r.error) || _('Unknown error'))]), 'error');
								btn.disabled = false;
								btn.textContent = _('Delete');
							}
						}).catch(function (err) {
							ui.addNotification(null, E('p', [_('Error: ') + String(err)]), 'error');
							btn.disabled = false;
							btn.textContent = _('Delete');
						});
					}
				}, [_('Delete')])
			])
		]);
		container.appendChild(row);
	});
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function () {
		return callGetContacts({ force: false }).catch(function (err) {
			return { error: String(err), contacts: [] };
		});
	},

	render: function (data) {
		currentView = this;
		currentData = data || {};
		var contacts = currentData.contacts || [];
		var used = currentData.used != null ? currentData.used : contacts.length;
		var total = currentData.total || 0;
		var pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
		var barCls = pct < 60 ? 'usage-good' : (pct < 85 ? 'usage-warn' : 'usage-critical');
		var hasError = !!(currentData.error);

		var fileInput = E('input', {
			'type': 'file',
			'accept': '.vcf,.vcard,.csv',
			'style': 'display:none;',
			'change': function (e) {
				var file = e.target.files && e.target.files[0];
				if (!file) return;
				var reader = new FileReader();
				reader.onload = function () {
					var text = String(reader.result || '');
					var entries = /\.vcf|\.vcard/i.test(file.name) || /BEGIN:VCARD/i.test(text)
						? parseVcf(text)
						: parseCsv(text);
					fileInput.value = '';
					if (!entries.length) {
						ui.addNotification(null, E('p', [_('No valid contacts found in %s.').format(file.name)]), 'warning');
						return;
					}
					showImportModal(entries, file.name);
				};
				reader.readAsText(file);
			}
		});

		var listContainer = E('div', { 'class': 'hh4x-contact-list', 'id': 'hh4x-contact-list' });

		var body = E('div', { 'class': 'hh4x-page' }, [
			fileInput,
			E('div', { 'class': 'hh4x-page-header hh4x-header-flex' }, [
				E('div', {}, [
					E('h2', { 'class': 'hh4x-page-title' }, [_('SIM Contact Book')]),
					E('p', { 'class': 'hh4x-page-desc' }, [
						_('Manage contacts stored directly on the SIM card (supports Latin, French, and Arabic UCS2 names).')
					])
				]),
				E('div', { 'class': 'hh4x-header-actions' }, [
					E('button', {
						'class': 'cbi-button cbi-button-action',
						'disabled': hasError ? true : undefined,
						'click': function () { showContactModal(null); }
					}, [_('+ Add Contact')]),
					E('button', {
						'class': 'cbi-button cbi-button-neutral',
						'id': 'contacts-refresh-btn',
						'click': function () { reloadContacts(true); }
					}, [_('Refresh SIM')])
				])
			])
		]);

		if (hasError) {
			body.appendChild(E('div', { 'class': 'hh4x-warning', 'style': 'margin-bottom:1.2em;' }, [
				E('span', { 'class': 'hh4x-warning-icon' }, ['⚠']),
				E('span', {}, [String(currentData.error)])
			]));
		}

		// Storage & Import/Export summary card
		if (!hasError) {
			body.appendChild(hh4x.createCard(_('SIM Storage'), [
				E('div', { 'class': 'hh4x-storage-row' }, [
					E('div', { 'class': 'hh4x-storage-bar-wrap' }, [
						E('div', { 'class': 'hh4x-usage-bar-row' }, [
							E('span', { 'class': 'hh4x-usage-bar-label' }, [
								_('%d of %d SIM slots used').format(used, total || used)
							]),
							E('span', { 'class': 'hh4x-usage-bar-pct' }, [
								total > 0 ? pct.toFixed(0) + '%' : '--'
							])
						]),
						E('div', { 'class': 'hh4x-usage-bar-bg' }, [
							E('div', { 'class': 'hh4x-usage-bar ' + barCls, 'style': 'width:' + pct.toFixed(0) + '%;' })
						]),
						E('div', { 'class': 'hh4x-storage-meta' }, [
							_('Max number: %d digits · Max name: %d chars (~%d Arabic/Unicode) · %s').format(
								currentData.max_number_len || 40,
								currentData.max_name_len || 14,
								Math.max(4, Math.floor(((currentData.max_name_len || 14) - 1) / 2)),
								currentData.cached ? _('Cached') : _('Live from SIM')
							)
						])
					]),
					E('div', { 'class': 'hh4x-io-actions' }, [
						E('button', {
							'class': 'cbi-button cbi-button-neutral hh4x-btn-sm',
							'click': function () { fileInput.click(); }
						}, [_('Import VCF/CSV')]),
						E('button', {
							'class': 'cbi-button cbi-button-neutral hh4x-btn-sm',
							'disabled': contacts.length === 0 ? true : undefined,
							'click': function () { exportVcf(contacts); }
						}, [_('Export VCF')]),
						E('button', {
							'class': 'cbi-button cbi-button-neutral hh4x-btn-sm',
							'disabled': contacts.length === 0 ? true : undefined,
							'click': function () { exportCsv(contacts); }
						}, [_('Export CSV')])
					])
				])
			]));

			var toolbar = E('div', { 'class': 'hh4x-contacts-toolbar' }, [
				E('div', { 'class': 'hh4x-toolbar-left' }, [
					E('label', { 'class': 'hh4x-sms-toolbar-label' }, [
						E('input', {
							'type': 'checkbox',
							'id': 'contacts-select-all',
							'change': function (e) {
								var cbs = document.querySelectorAll('.hh4x-contact-check');
								for (var j = 0; j < cbs.length; j++) cbs[j].checked = e.target.checked;
							}
						}),
						_(' Select All')
					]),
					E('button', {
						'class': 'cbi-button cbi-button-negative hh4x-btn-sm',
						'id': 'contacts-delete-selected',
						'click': function (e) {
							var checked = [];
							var cbs = document.querySelectorAll('.hh4x-contact-check:checked');
							for (var j = 0; j < cbs.length; j++) checked.push(parseInt(cbs[j].value, 10));
							if (!checked.length) {
								ui.addNotification(null, E('p', [_('No contacts selected.')]), 'info');
								return;
							}
							if (!confirm(_('Delete %d selected contact(s) from SIM?').format(checked.length))) return;
							var btn = e.target;
							btn.disabled = true;
							btn.textContent = _('Deleting...');
							callDeleteContactsBulk({ indices: checked }).then(function (r) {
								if (r && r.error == null) {
									reloadContacts(true);
								} else {
									ui.addNotification(null, E('p', [_('Delete failed: ') + ((r && r.error) || _('Unknown error'))]), 'error');
									btn.disabled = false;
									btn.textContent = _('Delete Selected');
								}
							}).catch(function (err) {
								ui.addNotification(null, E('p', [_('Error: ') + String(err)]), 'error');
								btn.disabled = false;
								btn.textContent = _('Delete Selected');
							});
						}
					}, [_('Delete Selected')]),
					E('span', { 'class': 'hh4x-count-pill', 'id': 'contacts-count-badge' }, [
						_('%d contacts').format(contacts.length)
					])
				]),
				E('input', {
					'type': 'search',
					'class': 'cbi-input-text hh4x-search-input',
					'placeholder': _('Search name, number, or slot...'),
					'value': searchQuery,
					'input': function (e) {
						searchQuery = e.target.value;
						var selAll = document.getElementById('contacts-select-all');
						if (selAll) selAll.checked = false;
						renderContactList(contacts, listContainer);
					}
				})
			]);

			renderContactList(contacts, listContainer);

			body.appendChild(hh4x.createCard(_('Contacts'), [
				toolbar,
				listContainer
			]));
		}

		// Handle optional #add=<number> deep link from SMS or Call Log
		if (!hasError && window.location.hash && window.location.hash.indexOf('#add=') === 0) {
			var preNum = decodeURIComponent(window.location.hash.slice(5));
			history.replaceState(null, '', window.location.pathname + window.location.search);
			setTimeout(function () { showContactModal({ name: '', number: preNum }); }, 50);
		}

		return body;
	}
});
