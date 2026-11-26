/*
 * contacts.js - SIM Contact Book manager for HH4xModem
 * Copyright (C) 2026 HH4xModem
 * Licensed under the Apache License, Version 2.0.
 */

'use strict';
'require rpc';
'require view';
'require ui';

if (!document.querySelector('link[href*="hh4xmodem.css"]')) {
	document.querySelector('head').appendChild(E('link', {
		'rel': 'stylesheet',
		'type': 'text/css',
		'href': L.resource('view/hh4xmodem/hh4xmodem.css') + '?_=' + Date.now()
	}));
}

const callGetContacts = rpc.declare({
	object: 'hh4xmodem',
	method: 'get_contacts'
});

const callSaveContact = rpc.declare({
	object: 'hh4xmodem',
	method: 'save_contact',
	params: { pb_id: '', name: '', number: '' },
	reject: true
});

const callDeleteContact = rpc.declare({
	object: 'hh4xmodem',
	method: 'delete_contact',
	params: { pb_id: '' },
	reject: true
});

const callDeleteContactsBulk = rpc.declare({
	object: 'hh4xmodem',
	method: 'delete_contacts_bulk',
	params: { ids: [] },
	reject: true
});

const callImportContacts = rpc.declare({
	object: 'hh4xmodem',
	method: 'import_contacts',
	params: { contacts: [] },
	reject: true
});

const AVATAR_COLORS = [
	'#3b82f6', '#10b981', '#f59e0b', '#ef4444',
	'#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6'
];

var currentView = null;
var currentData = null;
var searchQuery = '';

function createCard(title, content) {
	return E('div', { 'class': 'cbi-section hh4x-card' }, [
		E('div', { 'class': 'hh4x-card-header' }, [
			E('h3', { 'class': 'hh4x-card-title' }, [title])
		]),
		E('div', { 'class': 'hh4x-card-body' }, content)
	]);
}

function createModalOverlay(id) {
	var overlay = E('div', { 'class': 'hh4x-modal-overlay', 'id': id, 'style': 'display:none;' });
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
}

function avatarInitials(name) {
	var s = String(name || '').trim();
	if (!s) return '?';
	var parts = s.split(/\s+/);
	if (parts.length >= 2)
		return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
	return s.slice(0, 2).toUpperCase();
}

function avatarColor(name) {
	var s = String(name || '');
	var h = 0;
	for (var i = 0; i < s.length; i++)
		h = ((h << 5) - h) + s.charCodeAt(i);
	return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function copyToClipboard(text, btn, idleLabel) {
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
}

function isAsciiOnly(str) {
	return /^[\x20-\x7E]*$/.test(str || '');
}

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
	var lines = ['ID,Name,Number'];
	contacts.forEach(function (c) {
		lines.push([c.id, esc(c.name), esc(c.number)].join(','));
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

function reloadContacts() {
	if (!currentView) return;
	var refreshBtn = document.getElementById('contacts-refresh-btn');
	if (refreshBtn) {
		refreshBtn.disabled = true;
		refreshBtn.textContent = _('Refreshing...');
	}
	callGetContacts().then(function (newData) {
		var newBody = currentView.render(newData);
		var container = document.querySelector('.hh4x-page');
		if (container && container.parentNode)
			container.parentNode.replaceChild(newBody, container);
	}).catch(function (err) {
		ui.addNotification(null, E('p', [_('Error loading SIM contacts: ') + String(err)]), 'error');
		if (refreshBtn) {
			refreshBtn.disabled = false;
			refreshBtn.textContent = _('Refresh');
		}
	});
}

function showContactModal(contact) {
	var overlay = document.getElementById('hh4x-contact-modal');
	if (!overlay) {
		overlay = createModalOverlay('hh4x-contact-modal');
		document.body.appendChild(overlay);
	}

	var isEdit = !!(contact && contact.id != null && contact.id !== '');
	var maxName = (currentData && currentData.max_name_len) || 14;
	var maxNum = (currentData && currentData.max_number_len) || 40;

	overlay.querySelector('.hh4x-modal-title').textContent = isEdit
		? _('Edit Contact (#%d)').format(contact.index + 1)
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
		'placeholder': _('Contact name'),
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

	var saveBtn = E('button', {
		'class': 'cbi-button cbi-button-apply',
		'id': 'contact-save-btn',
		'click': function (e) {
			e.preventDefault();
			var name = nameInput.value.trim();
			var number = numInput.value.trim().replace(/[^0-9+*#]/g, '');
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
			callSaveContact({
				pb_id: isEdit ? String(contact.id) : '',
				name: name,
				number: number
			}).then(function (r) {
				if (r && r.error == null) {
					overlay.style.display = 'none';
					ui.addNotification(null, E('p', [_('Contact "%s" saved to SIM.').format(name)]), 'info');
					reloadContacts();
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
		overlay = createModalOverlay('hh4x-import-modal');
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
					reloadContacts();
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
		       String(c.index + 1).indexOf(q) >= 0;
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
				copyToClipboard(c.number, copyBtn, _('Copy'));
			}
		}, [_('Copy')]);

		var row = E('div', { 'class': 'hh4x-contact-row' }, [
			E('div', { 'class': 'hh4x-sms-check-cell' }, [
				E('input', {
					'type': 'checkbox',
					'class': 'hh4x-contact-check',
					'value': c.id
				})
			]),
			E('div', {
				'class': 'hh4x-contact-avatar',
				'style': 'background:' + avatarColor(c.name) + ';'
			}, [avatarInitials(c.name)]),
			E('div', { 'class': 'hh4x-contact-main' }, [
				E('div', { 'class': 'hh4x-contact-name', 'dir': 'auto' }, [c.name || _('(Unnamed)')]),
				E('div', { 'class': 'hh4x-contact-meta' }, [
					E('span', { 'class': 'hh4x-contact-number', 'dir': 'ltr' }, [c.number || '--']),
					E('span', { 'class': 'hh4x-slot-pill' }, ['#' + (c.index + 1)])
				])
			]),
			E('div', { 'class': 'hh4x-contact-actions' }, [
				copyBtn,
				E('button', {
					'class': 'cbi-button cbi-button-neutral hh4x-btn-sm',
					'click': function () { showContactModal(c); }
				}, [_('Edit')]),
				E('button', {
					'class': 'cbi-button cbi-button-negative hh4x-btn-sm',
					'click': function (e) {
						if (!confirm(_('Delete "%s" from SIM card?').format(c.name || c.number))) return;
						var btn = e.target;
						btn.disabled = true;
						btn.textContent = '...';
						callDeleteContact({ pb_id: String(c.id) }).then(function (r) {
							if (r && r.error == null) {
								reloadContacts();
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
		return callGetContacts().catch(function (err) {
			return { error: String(err), contacts: [] };
		});
	},

	render: function (data) {
		currentView = this;
		currentData = data || { contacts: [] };
		var contacts = Array.isArray(currentData.contacts) ? currentData.contacts : [];
		var hasError = currentData.error != null;
		var used = currentData.used != null ? currentData.used : contacts.length;
		var total = currentData.total || 0;
		var pct = (total > 0) ? Math.min(100, (used / total) * 100) : 0;
		var barCls = pct >= 90 ? 'usage-critical' : (pct >= 75 ? 'usage-warn' : 'usage-good');

		var fileInput = E('input', {
			'type': 'file',
			'accept': '.vcf,.vcard,.csv,text/vcard,text/csv',
			'style': 'display:none;',
			'change': function (e) {
				var file = e.target.files && e.target.files[0];
				e.target.value = '';
				if (!file) return;
				var reader = new FileReader();
				reader.onload = function (ev) {
					var text = String(ev.target.result || '');
					var entries = (/\.vcf$|\.vcard$/i.test(file.name) || /BEGIN:VCARD/i.test(text))
						? parseVcf(text)
						: parseCsv(text);
					if (!entries.length) {
						ui.addNotification(null, E('p', [_('No valid contacts found in %s.').format(file.name)]), 'warning');
						return;
					}
					showImportModal(entries, file.name);
				};
				reader.readAsText(file);
			}
		});

		var body = E('div', { 'class': 'hh4x-page' }, [
			fileInput,
			E('div', { 'class': 'hh4x-page-header hh4x-header-flex' }, [
				E('div', {}, [
					E('h2', { 'class': 'hh4x-page-title' }, [_('SIM Contact Book')]),
					E('p', { 'class': 'hh4x-page-desc' }, [
						_('View, add, edit, import and export contacts stored on the SIM card.')
					])
				]),
				E('div', { 'class': 'hh4x-header-actions' }, [
					E('button', {
						'class': 'cbi-button cbi-button-apply',
						'disabled': hasError ? true : undefined,
						'click': function () { showContactModal(null); }
					}, [_('+ Add Contact')]),
					E('button', {
						'class': 'cbi-button cbi-button-neutral',
						'id': 'contacts-refresh-btn',
						'click': function () { reloadContacts(); }
					}, [_('Refresh')])
				])
			])
		]);

		if (hasError) {
			body.appendChild(E('div', { 'class': 'hh4x-warning', 'style': 'margin-bottom:1.2em;' }, [
				E('span', { 'class': 'hh4x-warning-icon' }, ['⚠']),
				E('span', {}, [String(currentData.error)])
			]));
			return body;
		}

		body.appendChild(createCard(_('SIM Storage'), [
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
						_('Max number: %d digits · Max name: %d chars (~%d Arabic/Unicode)').format(
							currentData.max_number_len || 40,
							currentData.max_name_len || 14,
							Math.max(4, Math.floor(((currentData.max_name_len || 14) - 1) / 2))
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

		var listContainer = E('div', { 'class': 'hh4x-contact-list' });

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
						for (var j = 0; j < cbs.length; j++) checked.push(String(cbs[j].value));
						if (!checked.length) {
							ui.addNotification(null, E('p', [_('No contacts selected.')]), 'info');
							return;
						}
						if (!confirm(_('Delete %d selected contact(s) from SIM?').format(checked.length))) return;
						var btn = e.target;
						btn.disabled = true;
						btn.textContent = _('Deleting...');
						callDeleteContactsBulk({ ids: checked }).then(function (r) {
							if (r && r.error == null) {
								reloadContacts();
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
				'placeholder': _('Search name, number, or #...'),
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

		body.appendChild(createCard(_('Contacts'), [
			toolbar,
			listContainer
		]));

		return body;
	}
});
