/*
 * at.uc - AT command & UCS2 helper module for HH40V/HH41V MDM9207
 * Copyright (C) 2026 HH4xModem
 * Licensed under the Apache License, Version 2.0.
 */

'use strict';

import { popen, stat } from 'fs';
import * as uci from 'uci';

const SMS_TOOL = '/usr/bin/sms_tool';
const DEFAULT_PORT = '/dev/ttyUSB2';
const CONFIG_TTL_SEC = 30;

let cached_port = null;
let cached_port_at = 0;

function shellquote(value) {
	if (value == null) value = '';
	return "'" + replace(value, "'", "'\\''") + "'";
}

export function get_at_port(opts) {
	opts = opts || {};
	let env_port = opts.port || getenv('AT_PORT');
	if (env_port) return env_port;

	let now = time();
	if (!opts.fresh && cached_port && (now - cached_port_at) < CONFIG_TTL_SEC)
		return cached_port;

	let p = null;
	try {
		let ctx = uci.cursor();
		p = ctx.get('hh4xmodem', 'settings', 'at_port');
		ctx.unload();
	} catch (e) {}

	cached_port = p || DEFAULT_PORT;
	cached_port_at = now;
	return cached_port;
};

export function ensure_usb_serial(port) {
	port = port || get_at_port();
	if (stat(port)) return true;
	system('echo "1bbb 0196" > /sys/bus/usb-serial/drivers/option1/new_id 2>/dev/null || ' +
	       'echo "1bbb 0196" > /sys/bus/usb-serial/drivers/option/new_id 2>/dev/null');
	sleep(400);
	return stat(port) != null;
};

export function check_ready(opts) {
	let port = get_at_port(opts);
	if (!stat(SMS_TOOL)) {
		return {
			ok: false,
			code: 'NO_SMS_TOOL',
			error: 'sms_tool is not installed (/usr/bin/sms_tool). Install sms-tool to manage SIM contacts over AT.'
		};
	}
	if (!ensure_usb_serial(port)) {
		return {
			ok: false,
			code: 'NO_AT_PORT',
			error: sprintf('Modem AT port %s is not available. Ensure USB serial driver (kmod-usb-serial-option) is loaded.', port)
		};
	}
	return { ok: true, port: port };
};

export function send(cmd, opts) {
	let ready = check_ready(opts);
	if (!ready.ok) return ready;

	let fd = popen(sprintf('%s -d %s at %s 2>&1', SMS_TOOL, shellquote(ready.port), shellquote(cmd)));
	if (!fd) return { ok: false, code: 'EXEC_FAIL', error: 'Failed to execute sms_tool' };

	let out = '';
	let line;
	while ((line = fd.read('line')) != null)
		out += line;
	let rc = fd.close();

	let clean = trim(replace(out, /\r/g, ''));
	if (match(clean, /(^|\n)(ERROR|\+CME ERROR:[^\n]*|\+CMS ERROR:[^\n]*)/)) {
		let m = match(clean, /(\+CM[ES] ERROR:[^\n]*|ERROR)/);
		return {
			ok: false,
			code: 'AT_ERROR',
			error: m ? trim(m[1]) : 'Modem returned ERROR',
			raw: clean
		};
	}

	return { ok: rc == 0 || length(clean) > 0, raw: clean };
};

/* ---- UCS2 (UTF-16BE hex) <-> UTF-8 codecs ---- */

function hex_val(ch) {
	let c = ord(ch);
	if (c >= 48 && c <= 57) return c - 48;
	if (c >= 65 && c <= 70) return c - 55;
	if (c >= 97 && c <= 102) return c - 87;
	return -1;
}

export function is_ucs2_hex(s) {
	if (type(s) != 'string') return false;
	let n = length(s);
	if (n < 4 || (n % 4) != 0) return false;
	for (let i = 0; i < n; i++) {
		if (hex_val(substr(s, i, 1)) < 0) return false;
	}
	return true;
};

function codepoint_to_utf8(cp) {
	if (cp <= 0x7F) return chr(cp);
	if (cp <= 0x7FF) {
		return chr(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F));
	}
	if (cp <= 0xFFFF) {
		return chr(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
	}
	if (cp <= 0x10FFFF) {
		return chr(
			0xF0 | (cp >> 18),
			0x80 | ((cp >> 12) & 0x3F),
			0x80 | ((cp >> 6) & 0x3F),
			0x80 | (cp & 0x3F)
		);
	}
	return '?';
}

export function ucs2_decode(hex) {
	if (!is_ucs2_hex(hex)) return hex || '';
	let out = '';
	let n = length(hex);
	let i = 0;
	while (i + 3 < n) {
		let u = (hex_val(substr(hex, i, 1)) << 12) |
		        (hex_val(substr(hex, i + 1, 1)) << 8) |
		        (hex_val(substr(hex, i + 2, 1)) << 4) |
		        hex_val(substr(hex, i + 3, 1));
		i += 4;
		// Handle UTF-16 surrogate pairs
		if (u >= 0xD800 && u <= 0xDBFF && i + 3 < n) {
			let lo = (hex_val(substr(hex, i, 1)) << 12) |
			         (hex_val(substr(hex, i + 1, 1)) << 8) |
			         (hex_val(substr(hex, i + 2, 1)) << 4) |
			         hex_val(substr(hex, i + 3, 1));
			if (lo >= 0xDC00 && lo <= 0xDFFF) {
				i += 4;
				let cp = 0x10000 + ((u - 0xD800) << 10) + (lo - 0xDC00);
				out += codepoint_to_utf8(cp);
				continue;
			}
		}
		if (u != 0) out += codepoint_to_utf8(u);
	}
	return out;
};

export function ucs2_encode(str) {
	if (type(str) != 'string' || !length(str)) return '';
	let out = '';
	let n = length(str);
	let i = 0;
	while (i < n) {
		let b0 = ord(str, i);
		let cp = 0;
		if (b0 < 0x80) {
			cp = b0;
			i += 1;
		} else if ((b0 & 0xE0) == 0xC0 && i + 1 < n) {
			let b1 = ord(str, i + 1);
			cp = ((b0 & 0x1F) << 6) | (b1 & 0x3F);
			i += 2;
		} else if ((b0 & 0xF0) == 0xE0 && i + 2 < n) {
			let b1 = ord(str, i + 1);
			let b2 = ord(str, i + 2);
			cp = ((b0 & 0x0F) << 12) | ((b1 & 0x3F) << 6) | (b2 & 0x3F);
			i += 3;
		} else if ((b0 & 0xF8) == 0xF0 && i + 3 < n) {
			let b1 = ord(str, i + 1);
			let b2 = ord(str, i + 2);
			let b3 = ord(str, i + 3);
			cp = ((b0 & 0x07) << 18) | ((b1 & 0x3F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F);
			i += 4;
		} else {
			cp = 0x3F;
			i += 1;
		}

		if (cp <= 0xFFFF) {
			out += sprintf('%04X', cp);
		} else {
			cp -= 0x10000;
			let hi = 0xD800 + (cp >> 10);
			let lo = 0xDC00 + (cp & 0x3FF);
			out += sprintf('%04X%04X', hi, lo);
		}
	}
	return out;
};
