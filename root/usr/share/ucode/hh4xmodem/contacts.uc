/*
 * contacts.uc - SIM Contact Book manager via native MDM9207 pack protocol
 * Copyright (C) 2026 HH4xModem
 * Licensed under the Apache License, Version 2.0.
 */

'use strict';

import * as pack from 'hh4xmodem.pack';

const PB_CALL_OPTS = { timeout: 5 };

function pack_ok(r) {
	return r != null && (r.error == null || r.error == 0 || r.error == '0' || length(r) == 0);
}

function pack_error(r, fallback) {
	if (r == null) return { error: fallback, code: -1 };
	if (type(r.error) == 'string') return { error: r.error, code: r.code ?? -1 };
	if (type(r.error) == 'object' && r.error.message != null)
		return { error: sprintf('%s (%s)', r.error.message, r.error.code ?? -1), code: r.error.code ?? -1 };
	if (r.message != null)
		return { error: sprintf('%s (%s)', r.message, r.code ?? -1), code: r.code ?? -1 };
	if (r.error != null)
		return { error: sprintf('%s (modem error %s)', fallback, r.error), code: int(r.error) || -1 };
	return { error: fallback, code: -1 };
}

function sanitize_number(num) {
	if (type(num) != 'string') return '';
	num = trim(num);
	let out = '';
	for (let i = 0; i < length(num); i++) {
		let c = substr(num, i, 1);
		if (index('0123456789+*#', c) >= 0) {
			// '+' is only valid as an international prefix.
			if (c == '+' && length(out) > 0) continue;
			out += c;
		}
	}
	return out;
}

function check_pb_ready() {
	let init = pack.call('getPhoneBookInitState', '{}', PB_CALL_OPTS);
	if (init != null && init.error != null && init.error != 0 && init.error != '0')
		return pack_error(init, 'Failed to query SIM phonebook status');
	if (init != null && init.pb_init_state != null && int(init.pb_init_state) == 0) {
		return {
			error: 'SIM phonebook is still initialising. Wait a moment and refresh.',
			code: 'PB_NOT_INIT'
		};
	}
	return null;
}

export function list() {
	let not_ready = check_pb_ready();
	if (not_ready != null) {
		not_ready.contacts = [];
		return not_ready;
	}

	let batch = pack.call_batch([
		{ method: 'getPhoneBookInfo', params: '{"pb_type":"sim"}' },
		{ method: 'getPhoneBooklistInfo', params: '{"pb_type":"sim"}' }
	], PB_CALL_OPTS);

	let info = batch.getPhoneBookInfo;
	let list_resp = batch.getPhoneBooklistInfo;

	if (list_resp == null)
		list_resp = pack.call('getPhoneBooklistInfo', '{"pb_type":"sim"}', PB_CALL_OPTS);

	if (!pack_ok(list_resp)) {
		let err = pack_error(list_resp, 'Failed to read SIM contacts');
		err.contacts = [];
		return err;
	}

	if (info == null)
		info = pack.call('getPhoneBookInfo', '{"pb_type":"sim"}', PB_CALL_OPTS);

	let info_ok = pack_ok(info);
	let raw_list = (list_resp && type(list_resp.data) == 'array') ? list_resp.data : [];
	let contacts = [];

	for (let item in raw_list) {
		if (type(item) != 'object') continue;
		if (item.pb_type != null && item.pb_type != 'sim') continue;
		let id_str = (item.pb_id != null) ? trim('' + item.pb_id) : '';
		if (!length(id_str)) continue;
		push(contacts, {
			id: id_str,
			index: int(id_str),
			name: trim(item.pb_name == null ? '' : '' + item.pb_name),
			number: trim(item.phone_number == null ? '' : '' + item.phone_number)
		});
	}

	sort(contacts, function(a, b) {
		let an = lc(a.name || '');
		let bn = lc(b.name || '');
		if (an < bn) return -1;
		if (an > bn) return 1;
		return a.index - b.index;
	});

	let used = (info_ok && info.current_num != null) ? int(info.current_num) : length(contacts);
	// core_app spells the capacity key "totle_num".
	let total = (info_ok && (info.totle_num != null || info.total_num != null))
		? int(info.totle_num ?? info.total_num)
		: 250;
	let max_name_len = (info_ok && info.name_length != null && int(info.name_length) > 0)
		? int(info.name_length)
		: 14;
	let max_number_len = (info_ok && info.number_length != null && int(info.number_length) > 0)
		? int(info.number_length)
		: 40;

	return {
		error: null,
		contacts: contacts,
		used: used,
		total: total,
		max_name_len: max_name_len,
		max_number_len: max_number_len
	};
};

export function save(pb_id, name, number) {
	let clean_num = sanitize_number(number);
	let clean_name = trim(name == null ? '' : '' + name);

	if (!length(clean_num))
		return { error: 'Enter a valid phone number (digits, +, *, #)', code: -1 };
	if (!length(clean_name))
		return { error: 'Enter a contact name', code: -1 };

	let not_ready = check_pb_ready();
	if (not_ready != null) return not_ready;

	let id_str = (pb_id != null) ? trim('' + pb_id) : '';
	let is_edit = match(id_str, /^[0-9]+$/) != null;
	let method = is_edit ? 'editPhoneBook' : 'addPhoneBook';
	let req_id = is_edit ? id_str : '-1';

	let params = sprintf('{"pb_type":"sim","pb_name":%J,"phone_number":%J,"pb_id":%J}',
		clean_name, clean_num, req_id);
	let r = pack.call(method, params, PB_CALL_OPTS);
	if (!pack_ok(r))
		return pack_error(r, 'Failed to save contact to SIM');

	return { error: null, id: req_id, name: clean_name, number: clean_num };
};

export function remove(pb_id) {
	let id_str = (pb_id != null) ? trim('' + pb_id) : '';
	if (!match(id_str, /^[0-9]+$/))
		return { error: 'Invalid SIM contact ID', code: -1 };

	let not_ready = check_pb_ready();
	if (not_ready != null) return not_ready;

	let r = pack.call('deletePhoneBook', sprintf('{"pb_id":%J}', id_str), PB_CALL_OPTS);
	if (!pack_ok(r))
		return pack_error(r, 'Failed to delete SIM contact');

	return { error: null, deleted: 1 };
};

export function remove_bulk(ids) {
	if (type(ids) != 'array' || length(ids) == 0)
		return { error: 'No contact IDs provided', code: -1 };

	let clean_ids = [];
	for (let raw in ids) {
		let s = (raw != null) ? trim('' + raw) : '';
		if (!match(s, /^[0-9]+$/))
			return { error: 'Invalid SIM contact ID', code: -1 };
		push(clean_ids, s);
	}

	let not_ready = check_pb_ready();
	if (not_ready != null) return not_ready;

	let r = pack.call('deletePhoneBook', sprintf('{"pb_id":%J}', join(',', clean_ids)), PB_CALL_OPTS);
	if (!pack_ok(r))
		return pack_error(r, 'Failed to delete selected SIM contacts');

	return { error: null, deleted: length(clean_ids) };
};

export function import_bulk(entries) {
	if (type(entries) != 'array' || length(entries) == 0)
		return { error: 'No contacts to import', code: -1 };

	let not_ready = check_pb_ready();
	if (not_ready != null) return not_ready;

	let imported = 0;
	let skipped = 0;
	let last_error = null;

	for (let item in entries) {
		if (type(item) != 'object') { skipped++; continue; }
		let clean_num = sanitize_number(item.number);
		let clean_name = trim(item.name == null ? '' : '' + item.name);
		if (!length(clean_num) || !length(clean_name)) { skipped++; continue; }

		let params = sprintf('{"pb_type":"sim","pb_name":%J,"phone_number":%J,"pb_id":"-1"}',
			clean_name, clean_num);
		let r = pack.call('addPhoneBook', params, PB_CALL_OPTS);
		if (pack_ok(r)) {
			imported++;
		} else {
			skipped++;
			let err = pack_error(r, 'SIM write error');
			last_error = err.error;
		}
	}

	return {
		error: (imported == 0 && last_error) ? last_error : null,
		imported: imported,
		skipped: skipped,
		last_error: last_error
	};
};
