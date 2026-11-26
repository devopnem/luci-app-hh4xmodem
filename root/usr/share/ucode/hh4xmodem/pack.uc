/*
 * pack.uc - Native ucode TCP client for HH40V/HH41V MDM9207 pack protocol
 * Copyright (C) 2026 HH4xModem
 * Licensed under the Apache License, Version 2.0.
 */

'use strict';

import * as socket from 'socket';
import * as uci from 'uci';

// Pack protocol header layout:
//   "pack" magic (4 bytes) + total_length (4 bytes big-endian) +
//   reserved (4 bytes) + padding (32 bytes) = 44-byte pack header
//   + 28-byte legacy ack prefix = 72 bytes before the JSON payload.
const ACK_PREFIX_LEN  = 28;
const PACK_HEADER_LEN = 44;
const PAYLOAD_START   = ACK_PREFIX_LEN + PACK_HEADER_LEN;
const MAX_RECV_LOOPS  = 8;

export function get_config(opts) {
	opts = opts || {};
	let ip = opts.ip || getenv('MODEM_IP');
	let port = opts.port || getenv('MODEM_PORT');

	if (!ip || !port) {
		try {
			let ctx = uci.cursor();
			if (!ip) ip = ctx.get('hh4xmodem', 'settings', 'modem_ip');
			if (!port) port = ctx.get('hh4xmodem', 'settings', 'modem_port');
			ctx.unload();
		} catch (e) {}
	}

	return {
		ip: ip || '192.168.225.1',
		port: int(port) || 2016
	};
};

function build_request(method, params) {
	let p = (params == null || params == '') ? '{}' :
		(type(params) == 'string' ? params : sprintf('%J', params));
	let payload = sprintf('{"jsonrpc":"2.0","method":"%s","params":%s,"id":"1.1"}', method, p);
	let total_len = PACK_HEADER_LEN + length(payload);

	let req = 'pack';
	req += sprintf('%c%c%c%c',
		(total_len >> 24) & 0xFF, (total_len >> 16) & 0xFF,
		(total_len >> 8) & 0xFF, total_len & 0xFF);
	req += sprintf('%c%c%c%c', 0, 0, 0, 1);
	for (let i = 0; i < 32; i++) req += '\x00';
	return req + payload;
}

// Extract the first balanced JSON object from response past PAYLOAD_START.
// Tracks string context so braces inside SMS/USSD string values don't break
// framing, and skips the binary ack+pack header so stray 0x7b bytes can't
// shift the start offset.
function extract_json(response) {
	if (length(response) <= PAYLOAD_START) return null;
	let rel = index(substr(response, PAYLOAD_START), '{');
	if (rel < 0) return null;
	let start = PAYLOAD_START + rel;
	let depth = 0, in_str = false, esc = false;
	for (let j = start; j < length(response); j++) {
		let c = substr(response, j, 1);
		if (in_str) {
			if (esc) esc = false;
			else if (c == '\\') esc = true;
			else if (c == '"') in_str = false;
			continue;
		}
		if (c == '"') in_str = true;
		else if (c == '{') depth++;
		else if (c == '}') {
			depth--;
			if (depth == 0)
				return substr(response, start, j - start + 1);
		}
	}
	return null;
}

function open_and_send(cfg, method, params, timeout_sec) {
	let addr = socket.sockaddr({
		family: socket.AF_INET,
		address: cfg.ip,
		port: cfg.port
	});
	let sock = socket.create(socket.AF_INET, socket.SOCK_STREAM);
	if (!sock) return { error: 'Failed to create socket', code: -1 };

	let tv = [timeout_sec || 1, 0];
	sock.setopt(socket.SOL_SOCKET, socket.SO_SNDTIMEO, tv);
	sock.setopt(socket.SOL_SOCKET, socket.SO_RCVTIMEO, tv);

	if (!sock.connect(addr)) {
		sock.close();
		return { error: sprintf('Failed to connect to %s:%d', cfg.ip, cfg.port), code: -1 };
	}

	sock.send(build_request(method, params));
	return { sock: sock };
}

function read_reply(sock) {
	let response = '';
	let clean = null;
	for (let i = 0; i < MAX_RECV_LOOPS && clean == null; i++) {
		let chunk = null;
		try { chunk = sock.recv(65536); } catch (e) { chunk = null; }
		if (chunk === '') break;
		if (chunk == null) {
			if (length(response) > 0) {
				clean = extract_json(response);
				if (clean != null) break;
			}
			sleep(150);
			continue;
		}
		response += chunk;
		clean = extract_json(response);
	}
	sock.close();
	if (clean == null)
		return { error: sprintf('No response or too short (%d bytes)', length(response)), code: -1 };
	return { raw: clean };
}

export function call_raw(method, params, opts) {
	let cfg = get_config(opts);
	let opened = open_and_send(cfg, method, params, opts ? opts.timeout : null);
	if (opened.error != null) return opened;
	return read_reply(opened.sock);
};

export function call(method, params, opts) {
	let r = call_raw(method, params, opts);
	if (r.error != null) return r;
	let parsed = null;
	try { parsed = json(r.raw); } catch (e) { parsed = null; }
	if (parsed == null)
		return { error: 'Failed to parse JSON', raw: r.raw, code: -1 };
	return parsed;
};

// Execute a list of pack methods in parallel chunks without spawning subshells.
// Entries may be method name strings (parameterless) or { method, params, key }.
export function call_batch(methods, opts) {
	let cfg = get_config(opts);
	let chunk_size = (opts && opts.chunk_size) || 6;
	let out = {};

	for (let base = 0; base < length(methods); base += chunk_size) {
		let pending = [];
		let end = base + chunk_size;
		if (end > length(methods)) end = length(methods);

		for (let i = base; i < end; i++) {
			let entry = methods[i];
			let m = (type(entry) == 'object') ? entry.method : entry;
			let p = (type(entry) == 'object' && entry.params != null) ? entry.params : '{}';
			let k = (type(entry) == 'object' && entry.key) ? entry.key : m;
			let opened = open_and_send(cfg, m, p, opts ? opts.timeout : null);
			if (opened.sock)
				push(pending, { key: k, sock: opened.sock });
		}

		for (let item in pending) {
			let r = read_reply(item.sock);
			if (r.raw == null) continue;
			let parsed = null;
			try { parsed = json(r.raw); } catch (e) { parsed = null; }
			if (parsed != null) {
				if (type(parsed) == 'object' && parsed.result != null)
					out[item.key] = parsed.result;
				else
					out[item.key] = parsed;
			}
		}
	}

	return out;
};
