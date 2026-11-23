/*
 * contacts.uc - SIM Contact Book manager over 3GPP AT+CPBS/CPBR/CPBW
 * Copyright (C) 2026 HH4xModem
 * Licensed under the Apache License, Version 2.0.
 */

'use strict';

import { open, unlink, stat } from 'fs';
import * as at from 'hh4xmodem.at';

const CACHE_FILE = '/tmp/hh4xmodem_contacts_cache.json';
const CACHE_TTL_SEC = 300;
const CHUNK_SIZE = 40;

function read_cache() {
	if (!stat(CACHE_FILE)) return null;
	let fd = open(CACHE_FILE, 'r');
	if (!fd) return null;
	let raw = fd.read('all');
	fd.close();
	let data = null;
	try { data = json(raw); } catch (e) { data = null; }
	return (type(data) == 'object') ? data : null;
}

function write_cache(payload) {
	let fd = open(CACHE_FILE, 'w');
	if (!fd) return;
	fd.write(sprintf('%J', payload));
	fd.close();
}

export function invalidate_cache() {
	try { unlink(CACHE_FILE); } catch (e) {}
};

function sanitize_number(num) {
	if (type(num) != 'string') return '';
	num = trim(num);
	let out = '';
	for (let i = 0; i < length(num); i++) {
		let c = substr(num, i, 1);
		if (index('0123456789+*#', c) >= 0) {
			// Only allow '+' as the leading character
			if (c == '+' && length(out) > 0) continue;
			out += c;
		}
	}
	return out;
}

function parse_cpbs_query(raw) {
	// +CPBS: "SM",42,250
	let m = match(raw || '', /\+CPBS:\s*"([^"]+)",\s*(\d+),\s*(\d+)/);
	if (!m) return { storage: 'SM', used: null, total: null };
	return {
		storage: m[1],
		used: int(m[2]),
		total: int(m[3])
	};
}

function parse_cpbr_range(raw) {
	// +CPBR: (1-250),40,14
	let m = match(raw || '', /\+CPBR:\s*\((\d+)-(\d+)\)(?:,\s*(\d+))?(?:,\s*(\d+))?/);
	if (!m) return { min_idx: 1, max_idx: 250, max_number_len: 40, max_name_len: 14 };
	return {
		min_idx: int(m[1]) || 1,
		max_idx: int(m[2]) || 250,
		max_number_len: int(m[3]) || 40,
		max_name_len: int(m[4]) || 14
	};
}

function parse_cpbr_lines(raw, ucs2_active) {
	let items = [];
	if (!raw) return items;
	for (let line in split(raw, '\n')) {
		line = trim(line);
		let m = match(line, /^\+CPBR:\s*(\d+),\s*"([^"]*)",\s*(\d+),\s*"([^"]*)"/);
		if (!m) continue;
		let raw_name = m[4];
		let name = (ucs2_active && at.is_ucs2_hex(raw_name))
			? at.ucs2_decode(raw_name)
			: raw_name;
		push(items, {
			index: int(m[1]),
			number: m[2],
			type: int(m[3]),
			name: trim(name)
		});
	}
	return items;
}

function select_sim_phonebook() {
	let r = at.send('AT+CPBS="SM"');
	if (!r.ok) return r;
	let cs = at.send('AT+CSCS="UCS2"');
	return { ok: true, ucs2: cs.ok };
}

function restore_charset() {
	// Restore IRA so external AT scripts expecting ASCII are unaffected.
	at.send('AT+CSCS="IRA"');
}

export function get_cached() {
	let c = read_cache();
	if (c && type(c.contacts) == 'array') {
		return c;
	}
	return { error: null, contacts: [], cached: false, stale: true };
};

export function list(force_refresh) {
	if (!force_refresh) {
		let c = read_cache();
		if (c && c.updated_at && (time() - c.updated_at) < CACHE_TTL_SEC) {
			c.cached = true;
			return c;
		}
	}

	let ready = at.check_ready();
	if (!ready.ok)
		return { error: ready.error, code: ready.code, contacts: [] };

	let sel = select_sim_phonebook();
	if (!sel.ok)
		return { error: sel.error || 'Failed to select SIM phonebook', code: sel.code || 'AT_ERROR', contacts: [] };

	let q = at.send('AT+CPBS?');
	let storage = parse_cpbs_query(q.raw);

	let rng = at.send('AT+CPBR=?');
	let limits = parse_cpbr_range(rng.raw);

	let max_idx = storage.total || limits.max_idx || 250;
	let min_idx = limits.min_idx || 1;
	let contacts = [];

	// Fast path: if SIM reports 0 used slots, skip scanning completely.
	if (storage.used == null || storage.used > 0) {
		for (let start = min_idx; start <= max_idx; start += CHUNK_SIZE) {
			let end = start + CHUNK_SIZE - 1;
			if (end > max_idx) end = max_idx;

			let chunk = at.send(sprintf('AT+CPBR=%d,%d', start, end));
			if (chunk.ok && chunk.raw) {
				let parsed = parse_cpbr_lines(chunk.raw, sel.ucs2);
				for (let item in parsed)
					push(contacts, item);
			}
			// Early exit once we've collected all reported entries.
			if (storage.used != null && length(contacts) >= storage.used)
				break;
		}
	}

	restore_charset();

	sort(contacts, function(a, b) {
		let an = lc(a.name || '');
		let bn = lc(b.name || '');
		if (an < bn) return -1;
		if (an > bn) return 1;
		return a.index - b.index;
	});

	let result = {
		error: null,
		contacts: contacts,
		used: storage.used != null ? storage.used : length(contacts),
		total: storage.total || max_idx,
		max_number_len: limits.max_number_len,
		max_name_len: limits.max_name_len,
		ucs2: sel.ucs2,
		updated_at: time(),
		cached: false
	};

	write_cache(result);
	return result;
};

export function save(index_val, name, number) {
	let clean_num = sanitize_number(number);
	let clean_name = trim(name == null ? '' : '' + name);

	if (!length(clean_num))
		return { error: 'Enter a valid phone number (digits, +, *, #)', code: -1 };
	if (!length(clean_name))
		return { error: 'Enter a contact name', code: -1 };

	let idx = int(index_val || 0);
	if (idx < 0)
		return { error: 'Invalid SIM slot index', code: -1 };

	let ready = at.check_ready();
	if (!ready.ok)
		return { error: ready.error, code: ready.code };

	let sel = select_sim_phonebook();
	if (!sel.ok)
		return { error: sel.error || 'Failed to select SIM phonebook', code: sel.code || -1 };

	let num_type = (substr(clean_num, 0, 1) == '+') ? 145 : 129;
	let encoded_name = sel.ucs2
		? at.ucs2_encode(clean_name)
		: replace(clean_name, '"', '');

	let cmd = (idx > 0)
		? sprintf('AT+CPBW=%d,"%s",%d,"%s"', idx, clean_num, num_type, encoded_name)
		: sprintf('AT+CPBW=,"%s",%d,"%s"', clean_num, num_type, encoded_name);

	let r = at.send(cmd);
	restore_charset();

	if (!r.ok)
		return { error: r.error || 'Failed to save contact to SIM', code: r.code || -1 };

	invalidate_cache();
	return { error: null, index: idx, name: clean_name, number: clean_num };
};

export function remove(index_val) {
	let idx = int(index_val || 0);
	if (idx < 1)
		return { error: 'Invalid SIM slot index', code: -1 };

	let ready = at.check_ready();
	if (!ready.ok)
		return { error: ready.error, code: ready.code };

	let sel = at.send('AT+CPBS="SM"');
	if (!sel.ok)
		return { error: sel.error || 'Failed to select SIM phonebook', code: sel.code || -1 };

	let r = at.send(sprintf('AT+CPBW=%d', idx));
	if (!r.ok)
		return { error: r.error || 'Failed to delete contact', code: r.code || -1 };

	invalidate_cache();
	return { error: null, deleted: 1 };
};

export function remove_bulk(indices) {
	if (type(indices) != 'array' || length(indices) == 0)
		return { error: 'No contact slots provided', code: -1 };

	let ready = at.check_ready();
	if (!ready.ok)
		return { error: ready.error, code: ready.code };

	let sel = at.send('AT+CPBS="SM"');
	if (!sel.ok)
		return { error: sel.error || 'Failed to select SIM phonebook', code: sel.code || -1 };

	let deleted = 0;
	let failed = 0;
	for (let raw_idx in indices) {
		let idx = int(raw_idx || 0);
		if (idx < 1) { failed++; continue; }
		let r = at.send(sprintf('AT+CPBW=%d', idx));
		if (r.ok) deleted++;
		else failed++;
	}

	invalidate_cache();
	if (deleted == 0 && failed > 0)
		return { error: 'Failed to delete selected contacts', code: -1 };

	return { error: null, deleted: deleted, failed: failed };
};

export function import_bulk(entries) {
	if (type(entries) != 'array' || length(entries) == 0)
		return { error: 'No contacts to import', code: -1 };

	let ready = at.check_ready();
	if (!ready.ok)
		return { error: ready.error, code: ready.code };

	let sel = select_sim_phonebook();
	if (!sel.ok)
		return { error: sel.error || 'Failed to select SIM phonebook', code: sel.code || -1 };

	let imported = 0;
	let skipped = 0;
	let last_error = null;

	for (let item in entries) {
		if (type(item) != 'object') { skipped++; continue; }
		let clean_num = sanitize_number(item.number);
		let clean_name = trim(item.name == null ? '' : '' + item.name);
		if (!length(clean_num) || !length(clean_name)) { skipped++; continue; }

		let num_type = (substr(clean_num, 0, 1) == '+') ? 145 : 129;
		let encoded_name = sel.ucs2
			? at.ucs2_encode(clean_name)
			: replace(clean_name, '"', '');

		let r = at.send(sprintf('AT+CPBW=,"%s",%d,"%s"', clean_num, num_type, encoded_name));
		if (r.ok) {
			imported++;
		} else {
			skipped++;
			last_error = r.error || 'SIM write error';
			// Stop early if SIM memory is full (CME ERROR 20 / memory full)
			if (match(lc(last_error), /full|20/))
				break;
		}
	}

	restore_charset();
	invalidate_cache();

	return {
		error: (imported == 0 && last_error) ? last_error : null,
		imported: imported,
		skipped: skipped,
		last_error: last_error
	};
};
