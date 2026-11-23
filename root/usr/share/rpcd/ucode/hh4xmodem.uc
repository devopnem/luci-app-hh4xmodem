#!/usr/bin/ucode
'use strict';
import { popen } from 'fs';
import * as pack from 'hh4xmodem.pack';
import * as contacts from 'hh4xmodem.contacts';

function shellquote(value) {
	if (value == null) value = '';
	return "'" + replace(value, "'", "'\\''") + "'";
}

function pack_call(method, params) {
	return pack.call(method, params || '{}');
}

function get_system_info() { return pack_call('GetSystemInfo'); }
function get_status() { return pack_call('GetSystemStatus'); }
function get_signal() { return pack_call('GetNetworkInfo'); }
function get_network_settings() { return pack_call('GetNetworkSettings'); }
function get_usage() { return pack_call('GetUsageRecord'); }
function get_connection_state() { return pack_call('GetConnectionState'); }
function get_sim_status() { return pack_call('GetSimStatus'); }
function get_lan_settings() { return pack_call('GetLanSettings'); }
function get_sms_storage() { return pack_call('GetSMSStorageState'); }
function get_sms_settings() { return pack_call('GetSMSSettings'); }
function get_upnp() { return pack_call('GetUpnpSettings'); }
function get_dmz() { return pack_call('getDMZInfo'); }
function get_language() { return pack_call('GetCurrentLanguage'); }
function get_connection_settings() { return pack_call('GetConnectionSettings'); }
function get_registration_state() { return pack_call('GetNetworkRegisterState'); }
function get_profile_list() { return pack_call('GetProfileList'); }
function get_current_profile() { return pack_call('getCurrentProfile'); }
function get_pin_state() { return pack_call('GetAutoValidatePinState'); }
function get_usage_settings() { return pack_call('GetUsageSettings'); }

function reboot_modem() {
	let r = pack_call('SetDeviceReboot');
	if (r != null && type(r) == 'object' && r.error == null) return { error: null, response: r };
	if (type(r) == 'object' && length(r) == 0) return { error: null };
	return r || { error: 'Reboot failed', code: -1 };
}

function send_connect() {
	let r = pack_call('Connect');
	if (r != null && type(r) == 'object' && r.error == null) return { error: null, response: r };
	if (type(r) == 'object' && length(r) == 0) return { error: null };
	return r || { error: 'Connect failed', code: -1 };
}

function disconnect_modem() {
	let r = pack_call('DisConnect');
	if (r != null && type(r) == 'object' && r.error == null) return { error: null, response: r };
	if (type(r) == 'object' && length(r) == 0) return { error: null };
	return r || { error: 'Disconnect failed', code: -1 };
}

// The modem reports success as {} or {error:0}; only a real (truthy,
// non-zero) error is an actual failure.
function pack_ok(r) {
	return r != null && (r.error == null || r.error == 0 || r.error == '0' || length(r) == 0);
}

function truthy(v) {
	return v == true || v == 1 || v == '1';
}

function valid_ipv4(value) {
	if (type(value) != 'string') return false;
	let parts = split(value, '.');
	if (length(parts) != 4) return false;
	for (let p in parts) {
		if (!length(p) || length(p) > 3) return false;
		for (let i = 0; i < length(p); i++)
			if (index('0123456789', substr(p, i, 1)) < 0) return false;
		if (int(p) > 255) return false;
	}
	return true;
}

function validate_dmz_ip(ip, lan) {
	if (!valid_ipv4(ip)) return 'Enter a valid IPv4 address';
	let p = split(ip, '.');
	let first = int(p[0]);
	let last = int(p[3]);
	if (first == 0 || first == 127 || first >= 224)
		return 'The DMZ host must be a unicast LAN address';
	if (last == 0 || last == 255)
		return 'The DMZ host cannot be the network or broadcast address';
	let lan_ip = lan.LanIp || lan.IPv4IPAddress;
	let mask = lan.Submask || lan.SubnetMask;
	if (valid_ipv4(lan_ip)) {
		if (ip == lan_ip) return 'The DMZ host cannot be the modem itself';
		let l = split(lan_ip, '.');
		if (mask == '255.255.255.0' && (p[0] != l[0] || p[1] != l[1] || p[2] != l[2]))
			return sprintf('The DMZ host must be inside the modem LAN subnet (%s.%s.%s.x)', l[0], l[1], l[2]);
	}
	return null;
}

function set_upnp(enabled) {
	let want = truthy(enabled) ? 1 : 0;
	let before = get_upnp();
	if (type(before) == 'object' && before.upnp_switch != null && int(before.upnp_switch) == want)
		return { error: null, upnp_switch: want };
	let r = pack_call('SetUpnpSettings', sprintf('{"upnp_switch":%d}', want));
	if (r != null && r.error != null) return r;
	let last = null;
	for (let i = 0; i < 3; i++) {
		if (i > 0) sleep(300);
		let cur = get_upnp();
		if (type(cur) == 'object' && cur.upnp_switch != null) {
			last = int(cur.upnp_switch);
			if (last == want) return { error: null, upnp_switch: want };
		}
	}
	return { error: sprintf('Modem did not apply the UPnP setting (reported %s)', last != null ? last : 'unknown'), code: -1 };
}

function set_dmz(enabled, ip) {
	let cur = get_dmz();
	if (type(cur) != 'object' || cur.dmz_status == null) {
		if (type(cur) == 'object' && cur.error != null) return cur;
		return { error: 'DMZ is not supported by this modem firmware', code: -1 };
	}
	let want = truthy(enabled) ? 1 : 0;
	ip = trim(ip || '');
	if (want == 0 && int(cur.dmz_status) == 0)
		return { error: null, dmz_status: 0, dmz_ip: cur.dmz_ip || '' };
	if (want == 1 && int(cur.dmz_status) == 1 && ip == (cur.dmz_ip || ''))
		return { error: null, dmz_status: 1, dmz_ip: ip };
	if (want == 1) {
		if (!length(ip)) return { error: 'Enter the DMZ host IP address', code: -1 };
		let lan = pack_call('GetLanSettings');
		if (type(lan) != 'object' || lan.error != null) lan = {};
		let problem = validate_dmz_ip(ip, lan);
		if (problem != null) return { error: problem, code: -1 };
	} else {
		ip = cur.dmz_ip || ip;
	}
	let r = pack_call('setDMZInfo', sprintf('{"dmz_status":%d,"dmz_ip":%J}', want, ip));
	if (r != null && r.error != null) return r;
	let last = null;
	for (let i = 0; i < 3; i++) {
		if (i > 0) sleep(300);
		let after = get_dmz();
		if (type(after) == 'object' && after.dmz_status != null) {
			last = int(after.dmz_status);
			if (last == want && (want == 0 || after.dmz_ip == ip))
				return { error: null, dmz_status: want, dmz_ip: after.dmz_ip };
		}
	}
	return { error: sprintf('Modem did not apply the DMZ setting (reported status %s)', last != null ? last : 'unknown'), code: -1 };
}

function unlock_pin(pin) {
	if (pin == null) return { error: 'Missing PIN', code: -1 };
	pin = trim(pin);
	if (!length(pin)) return { error: 'Empty PIN', code: -1 };
	let r = pack_call('UnlockPin', sprintf('{"PIN":%J}', pin));
	if (pack_ok(r)) return { error: null };
	return r || { error: 'Unlock failed', code: -1 };
}

function unlock_puk(puk, new_pin) {
	if (puk == null || new_pin == null) return { error: 'Missing PUK or new PIN', code: -1 };
	puk = trim(puk);
	new_pin = trim(new_pin);
	if (!length(puk) || !length(new_pin)) return { error: 'Empty PUK or PIN', code: -1 };
	let r = pack_call('UnlockPuk', sprintf('{"Pin":%J,"Puk":%J}', new_pin, puk));
	if (!pack_ok(r)) return r || { error: 'Unlock failed', code: -1 };
	let s = get_sim_status();
	let st = (s && s.SIMState != null) ? s.SIMState : null;
	if (st == 7 || st == 2) return { error: null };
	return { error: 'PUK rejected, still locked, or blocked', code: -1 };
}

function change_pin(old_pin, new_pin) {
	if (old_pin == null || new_pin == null) return { error: 'Missing old or new PIN', code: -1 };
	old_pin = trim(old_pin);
	new_pin = trim(new_pin);
	if (!length(old_pin) || !length(new_pin)) return { error: 'Empty old or new PIN', code: -1 };
	let r = pack_call('ChangePinCode', sprintf('{"CurrentPin":%J,"NewPin":%J}', old_pin, new_pin));
	if (pack_ok(r)) return { error: null };
	return r || { error: 'Change PIN failed', code: -1 };
}

function change_pin_state(pin, enable) {
	if (pin == null) return { error: 'Missing PIN', code: -1 };
	pin = trim(pin);
	if (!length(pin)) return { error: 'Empty PIN', code: -1 };
	let state = enable ? 1 : 0;
	let r = pack_call('ChangePinState', sprintf('{"Pin":%J,"State":%d}', pin, state));
	if (pack_ok(r)) return { error: null };
	return r || { error: enable ? 'Set PIN failed' : 'Disable PIN failed', code: -1 };
}

function clear_usage() {
	let r = pack_call('SetUsageRecordClear');
	if (r != null && r.error == null) return { error: null };
	return r || { error: 'Clear failed', code: -1 };
}

function clear_call_log() {
	let ids = '';
	let page = 1, total_pages = 1;
	while (page <= total_pages) {
		let r = pack_call('GetCallLogList', sprintf('{"Page":%d,"ListType":0}', page));
		if (r == null || r.error != null) break;
		let list = r.CallLogList || [];
		for (let c in list) {
			if (c.Id != null) {
				if (length(ids) > 0) ids += ',';
				ids += int(c.Id);
			}
		}
		total_pages = int(r.TotalPageCount || 1);
		page++;
	}

	if (length(ids) == 0) return { error: null };

	let r = pack_call('DeleteCallLog', sprintf('{"Id":[%s],"ListType":0}', ids));
	if (r != null && r.error == null) return { error: null };
	return r || { error: 'Clear failed', code: -1 };
}

function sim_blocked_reason(state) {
	if (state == 0) return 'no SIM is inserted';
	if (state == 1) return 'the SIM is not ready yet';
	if (state == 2) return 'the SIM is locked (PIN required)';
	if (state == 3) return 'the SIM is locked (PUK required)';
	if (state == 4) return 'the SIM is network-locked (NCK required)';
	if (state == 5) return 'the PUK is blocked';
	if (state == 6) return 'the SIM is invalid';
	if (state == 11) return 'the SIM is initialising';
	return 'the SIM is not ready (state ' + state + ')';
}

function sim_blocked_error(action) {
	let s = pack_call('GetSimStatus');
	if (type(s) != 'object' || s.error != null || s.SIMState == null)
		return null;
	let state = int(s.SIMState);
	if (state == 7) return null;
	return { error: sprintf('Cannot %s: %s', action, sim_blocked_reason(state)),
		 code: -1, simState: state };
}

function send_ussd(code) {
	if (code == null) return { error: 'Missing USSD code', code: -1 };
	code = trim(code);
	if (!length(code)) return { error: 'Empty USSD code', code: -1 };
	let blocked = sim_blocked_error('send a USSD code');
	if (blocked != null) return blocked;
	pack_call('SetUSSDEnd', '{}');
	sleep(1500);
	let r = pack_call('SendUSSD', sprintf('{"UssdType":0,"UssdContent":%J}', code));
	if (r == null || r.error != null) return r || { error: 'Send failed', code: -1 };
	let res;
	let end_session = function() { pack_call('SetUSSDEnd', '{}'); };
	let is_real = function(r) {
		return r && r.error == null && (r.UssdType == 1 || r.UssdType == 2) && r.UssdContent;
	};
	for (let i = 0; i < 20; i++) {
		if (i > 0) sleep(1000);
		res = pack_call('GetUSSDSendResult');
		if (is_real(res)) {
			end_session();
			return { error: null, text: res.UssdContent, more: res.UssdType == 2 };
		}
	}
	if (is_real(res)) { end_session(); return { error: null, text: res.UssdContent, more: res.UssdType == 2 }; }
	return { error: 'No USSD response from network', code: -1 };
}

function ussd_end_session() {
	pack_call('SetUSSDEnd', '{}');
	return { error: null };
}

function set_usage_settings(settings) {
	if (settings == null || type(settings) != 'object')
		return { error: 'Missing settings', code: -1 };
	let r = pack_call('SetUsageSettings', sprintf('%J', settings));
	if (r != null && r.error == null) return { error: null };
	return r || { error: 'Set failed', code: -1 };
}

function unlock_sim(code, lock_state) {
	if (code == null) return { error: 'Missing unlock code', code: -1 };
	code = trim(code);
	if (!length(code)) return { error: 'Empty unlock code', code: -1 };
	let r = pack_call('UnlockSimlock', sprintf('{"SIMLockCode":%J,"SIMLockState":%d}', code, int(lock_state || 0)));
	if (pack_ok(r)) return { error: null };
	if (type(r) == 'object' && r.message != null)
		return { error: sprintf('SIM unlock failed: %s', r.message), code: r.code ?? -1 };
	return r;
}

function set_network_mode(mode) {
	if (mode == null) return { error: 'Missing mode', code: -1 };
	mode = int(mode);
	if (mode < 0 || mode > 6) return { error: 'Invalid mode', code: -1 };
	let cur = pack_call('GetNetworkSettings') || {};
	let params = sprintf('{"NetworkMode":%d,"NetselectionMode":%d,"NetworkBand":%d,"DomesticRoam":%d,"DomesticRoamGuard":%d}',
		mode, cur.NetselectionMode ?? 0, cur.NetworkBand ?? 255, cur.DomesticRoam ?? 0, cur.DomesticRoamGuard ?? 0);
	let r = pack_call('SetNetworkSettings', params);
	if (r != null && type(r) == 'object' && r.error == null) return { error: null, mode: mode, response: r };
	if (type(r) == 'object' && length(r) == 0) return { error: null, mode: mode };
	return r || { error: 'Set failed', code: -1 };
}

function get_sms_data(key, page) {
	key = key || 'inbox';
	page = int(page || 1);
	let batch = pack.call_batch([
		{ method: 'GetSMSListByContactNum', params: sprintf('{"Page":%d,"key":%J}', page, key) },
		'GetSMSStorageState',
		'GetSimStatus'
	]);
	return {
		GetSMSListByContactNum: batch.GetSMSListByContactNum || { SMSList: [] },
		GetSMSStorageState: batch.GetSMSStorageState || {},
		GetSimStatus: batch.GetSimStatus || null
	};
}

function get_sms_list(key, page) {
	key = key || 'inbox';
	page = int(page || 1);
	return pack_call('GetSMSListByContactNum', sprintf('{"Page":%d,"key":%J}', page, key)) || { error: 'No result', SMSList: [] };
}

function get_single_sms(id) {
	id = int(id || 0);
	if (id < 1) return { error: 'Invalid SMS ID', code: -1 };
	return pack_call('GetSingleSMS', sprintf('{"SMSId":%d}', id)) || { error: 'No result' };
}

function send_sms(phone, content) {
	if (phone == null || content == null) return { error: 'Missing phone or content', code: -1 };
	phone = trim(phone);
	content = trim(content);
	if (!length(phone) || !length(content)) return { error: 'Empty phone or content', code: -1 };
	let blocked = sim_blocked_error('send an SMS');
	if (blocked != null) return blocked;
	let r = pack_call('SendSMS', sprintf('{"PhoneNumber":%J,"SMSContent":%J,"SMSId":-1}',
		phone, content));
	if (r == null) return { error: 'Send SMS failed: no response', code: -1 };
	if (type(r) == 'object' && r.message != null && r.code != null)
		return { error: sprintf('Send SMS failed: %s (%s)', r.message, r.code), code: -1 };
	return { error: null, response: r };
}

function delete_sms(id) {
	id = int(id || 0);
	if (id < 1) return { error: 'Invalid SMS ID', code: -1 };
	let r = pack_call('DeleteSMS', sprintf('{"DelFlag":3,"SMSArray":[%d]}', id));
	if (r != null && r.error == null) return { error: null };
	return r || { error: 'Delete failed', code: -1 };
}

function delete_sms_bulk(ids) {
	if (type(ids) != 'array' || length(ids) == 0) return { error: 'No SMS IDs provided', code: -1 };
	let arr = '';
	for (let i = 0; i < length(ids); i++) {
		let n = int(ids[i]);
		if (n < 1) return { error: 'Invalid SMS ID', code: -1 };
		if (length(arr) > 0) arr += ',';
		arr += n;
	}
	let params = sprintf('{"DelFlag":3,"SMSArray":[%s]}', arr);
	let r = pack_call('DeleteSMS', params);
	if (r != null && r.error == null) return { error: null, count: length(ids) };
	return r || { error: 'Delete failed', code: -1 };
}

function get_send_sms_result() { return pack_call('GetSendSMSResult') || { error: 'No result' }; }

function get_calllog_data(list_type, page) {
	list_type = int(list_type || 0);
	page = int(page || 1);
	let batch = pack.call_batch([
		{ method: 'GetCallLogList', params: sprintf('{"Page":%d,"ListType":%d}', page, list_type) },
		'GetCallLogCountInfo'
	]);
	return {
		GetCallLogList: batch.GetCallLogList || { CallLogList: [] },
		GetCallLogCountInfo: batch.GetCallLogCountInfo || {}
	};
}

function get_call_log_list(list_type, page) {
	list_type = int(list_type || 0);
	page = int(page || 1);
	return pack_call('GetCallLogList', sprintf('{"Page":%d,"ListType":%d}', page, list_type)) || { error: 'No result', CallLogList: [] };
}

function get_call_log_count() { return pack_call('GetCallLogCountInfo') || { error: 'No result' }; }

/* ---- SIM Contact Book ---- */

function get_contacts(force) {
	let blocked = sim_blocked_error('read SIM contacts');
	if (blocked != null) return { error: blocked.error, code: blocked.code, simState: blocked.simState, contacts: [] };
	return contacts.list(truthy(force));
}

function get_contacts_cached() {
	return contacts.get_cached();
}

function save_contact(index_val, name, number) {
	let blocked = sim_blocked_error('save a SIM contact');
	if (blocked != null) return blocked;
	return contacts.save(index_val, name, number);
}

function delete_contact(index_val) {
	let blocked = sim_blocked_error('delete a SIM contact');
	if (blocked != null) return blocked;
	return contacts.remove(index_val);
}

function delete_contacts_bulk(indices) {
	let blocked = sim_blocked_error('delete SIM contacts');
	if (blocked != null) return blocked;
	return contacts.remove_bulk(indices);
}

function import_contacts(entries) {
	let blocked = sim_blocked_error('import SIM contacts');
	if (blocked != null) return blocked;
	return contacts.import_bulk(entries);
}

/* ---- Batched status queries ---- */

const POLL_METHODS = [
	'GetNetworkInfo', 'GetConnectionState', 'GetSimStatus', 'GetUsageRecord'
];

const CORE_METHODS = [
	'GetNetworkInfo', 'GetSystemInfo', 'GetSystemStatus',
	'GetConnectionState', 'GetSimStatus', 'GetUsageRecord'
];

const EXTRA_METHODS = [
	'GetAutoValidatePinState', 'GetSMSSettings', 'GetSMSStorageState',
	'GetLanSettings', 'GetUpnpSettings', 'getDMZInfo', 'GetCurrentLanguage',
	'GetNetworkSettings', 'GetNetworkRegisterState', 'GetConnectionSettings',
	'GetProfileList', 'getCurrentProfile'
];

function get_poll() { return pack.call_batch(POLL_METHODS); }
function get_all() { return pack.call_batch(CORE_METHODS); }
function get_all_full() { return pack.call_batch([...CORE_METHODS, ...EXTRA_METHODS]); }

function get_dashboard() {
	let batch = pack.call_batch([
		'GetSystemInfo', 'GetSystemStatus', 'GetNetworkInfo',
		'GetConnectionState', 'GetNetworkSettings', 'GetSimStatus', 'GetUsageRecord'
	]);
	return {
		device: batch.GetSystemInfo || {},
		status: batch.GetSystemStatus || {},
		signal: batch.GetNetworkInfo || {},
		connection: batch.GetConnectionState || {},
		network: batch.GetNetworkSettings || {},
		sim: batch.GetSimStatus || {},
		usage: batch.GetUsageRecord || {},
		timestamp: time()
	};
}

function reset_modem() {
	let r = pack_call('SetDeviceReset');
	if (r != null && type(r) == 'object' && r.error == null) return { error: null, response: r };
	if (type(r) == 'object' && length(r) == 0) return { error: null };
	return r || { error: 'Reset failed', code: -1 };
}

function set_connection_settings(settings) {
	if (settings == null) return { error: 'Missing settings', code: -1 };
	if (type(settings) != 'object') return { error: 'Settings must be an object', code: -1 };
	let cur = pack_call('GetConnectionSettings');
	if (type(cur) != 'object' || cur.error != null)
		return { error: 'Failed to read current connection settings', code: -1 };
	for (let k, v in settings) cur[k] = v;
	let connectMode = int(cur.ConnectMode ?? 0);
	let pdpType = int(cur.PdpType ?? 0);
	let roamingConnect = int(cur.RoamingConnect ?? 1);
	let idleTime = int(cur.IdleTime ?? 600);
	let params = sprintf('{"ConnectMode":%d,"PdpType":%d,"RoamingConnect":%d,"IdleTime":%d}',
		connectMode, pdpType, roamingConnect, idleTime);
	let r = pack_call('SetConnectionSettings', params);
	if (r != null && type(r) == 'object' && r.error == null) return { error: null, response: r };
	if (type(r) == 'object' && length(r) == 0) return { error: null };
	return r || { error: 'Set failed', code: -1 };
}

function edit_profile(profile) {
	if (profile == null) return { error: 'Missing profile', code: -1 };
	if (type(profile) != 'object') return { error: 'Profile must be an object', code: -1 };
	let method = profile.ProfileID ? 'EditProfile' : 'AddNewProfile';
	let profileId = profile.ProfileID ? sprintf(',"ProfileID":%d', int(profile.ProfileID)) : '';
	let params = sprintf('{"ProfileName":%J,"APN":%J,"UserName":%J,"Password":%J,"AuthType":%d,"DailNumber":%J%s}',
		profile.ProfileName, profile.APN, profile.UserName, profile.Password,
		int(profile.AuthType ?? 0), profile.DailNumber, profileId);
	let r = pack_call(method, params);
	if (r != null && type(r) == 'object' && r.error == null) return { error: null };
	if (type(r) == 'object' && length(r) == 0) return { error: null };
	return r || { error: 'Set failed', code: -1 };
}

function delete_profile(profile_id) {
	profile_id = int(profile_id || 0);
	if (profile_id < 1) return { error: 'Invalid ProfileID', code: -1 };
	let r = pack_call('DeleteProfile', sprintf('{"ProfileID":%d}', profile_id));
	if (pack_ok(r)) return { error: null };
	return r || { error: 'Delete failed', code: -1 };
}

function set_default_profile(profile_id) {
	profile_id = int(profile_id || 0);
	if (profile_id < 1) return { error: 'Invalid ProfileID', code: -1 };
	let r = pack_call('SetDefaultProfile', sprintf('{"ProfileID":%d}', profile_id));
	if (pack_ok(r)) return { error: null };
	return r || { error: 'Set failed', code: -1 };
}

const NV_HELPER = '/usr/bin/hh4xmodem-nv';

function nv_call(args) {
	let fd = popen(sprintf('%s %s 2>/dev/null', NV_HELPER, args));
	if (!fd) return { ok: false, error: 'Failed to execute the NV helper', code: -1 };
	let out = '';
	let line;
	while ((line = fd.read('line')) != null) out += line;
	fd.close();
	let res = null;
	try { res = json(trim(out)); } catch (e) { res = null; }
	return (type(res) == 'object') ? res : { ok: false, error: 'Invalid response from the NV helper', raw: out, code: -1 };
}

function get_imei() { return nv_call('status'); }

function set_imei(imei) {
	if (imei == null || !length(trim(imei))) return { ok: false, error: 'Enter an IMEI', code: -1 };
	return nv_call(sprintf('restore %s', shellquote(trim(imei))));
}

function cancel_imei_change() { return nv_call('cancel'); }
function get_nv_imei() { return nv_call('read'); }
function backup_nv_partitions() { return nv_call('backup'); }
function restore_nv_backup(imei) { return set_imei(imei); }

const methods = {
	get_system_info:         { call: function() { return get_system_info(); } },
	get_status:              { call: function() { return get_status(); } },
	get_signal:              { call: function() { return get_signal(); } },
	get_network_settings:    { call: function() { return get_network_settings(); } },
	set_network_mode:        { args: { mode: 0 }, call: function(request) { return set_network_mode(request.args.mode); } },
	get_usage:               { call: get_usage },
	get_usage_settings:      { call: get_usage_settings },
	get_connection_state:    { call: get_connection_state },
	get_sim_status:          { call: get_sim_status },
	get_sms_storage:         { call: get_sms_storage },
	get_sms_settings:        { call: get_sms_settings },
	get_lan_settings:        { call: get_lan_settings },
	get_upnp:                { call: get_upnp },
	get_dmz:                 { call: get_dmz },
	set_upnp:                { args: { enabled: true }, call: function(request) { return set_upnp(request.args.enabled); } },
	set_dmz:                 { args: { enabled: false, ip: '' }, call: function(request) { return set_dmz(request.args.enabled, request.args.ip); } },
	get_language:            { call: get_language },
	get_connection_settings: { call: get_connection_settings },
	get_registration_state:  { call: get_registration_state },
	get_profile_list:        { call: get_profile_list },
	get_current_profile:     { call: get_current_profile },
	get_pin_state:           { call: get_pin_state },
	reboot_modem:            { call: reboot_modem },
	send_connect:            { call: send_connect },
	disconnect_modem:        { call: disconnect_modem },
	unlock_pin:              { args: { pin: '' }, call: function(request) { return unlock_pin(request.args.pin); } },
	unlock_puk:              { args: { puk: '', new_pin: '' }, call: function(request) { return unlock_puk(request.args.puk, request.args.new_pin); } },
	change_pin:              { args: { old_pin: '', new_pin: '' }, call: function(request) { return change_pin(request.args.old_pin, request.args.new_pin); } },
	change_pin_state:        { args: { pin: '', enable: true }, call: function(request) { return change_pin_state(request.args.pin, request.args.enable); } },
	clear_usage:             { call: clear_usage },
	clear_call_log:          { call: clear_call_log },
	send_ussd:               { args: { code: '' }, call: function(request) { return send_ussd(request.args.code); } },
	ussd_end_session:        { call: ussd_end_session },
	set_usage_settings:      { args: { settings: {} }, call: function(request) { return set_usage_settings(request.args.settings); } },
	unlock_sim:              { args: { code: '', lock_state: 0 }, call: function(request) { return unlock_sim(request.args.code, request.args.lock_state); } },
	get_sms_data:            { args: { key: 'inbox', page: 1 }, call: function(request) { return get_sms_data(request.args.key, request.args.page); } },
	get_sms_list:            { args: { key: 'inbox', page: 1 }, call: function(request) { return get_sms_list(request.args.key, request.args.page); } },
	get_single_sms:          { args: { id: 0 }, call: function(request) { return get_single_sms(request.args.id); } },
	send_sms:                { args: { phone: '', content: '' }, call: function(request) { return send_sms(request.args.phone, request.args.content); } },
	delete_sms:              { args: { id: 0 }, call: function(request) { return delete_sms(request.args.id); } },
	delete_sms_bulk:         { args: { ids: [] }, call: function(request) { return delete_sms_bulk(request.args.ids); } },
	get_send_sms_result:     { call: get_send_sms_result },
	get_calllog_data:        { args: { list_type: 0, page: 1 }, call: function(request) { return get_calllog_data(request.args.list_type, request.args.page); } },
	get_call_log_list:       { args: { list_type: 0, page: 1 }, call: function(request) { return get_call_log_list(request.args.list_type, request.args.page); } },
	get_call_log_count:      { call: get_call_log_count },
	get_contacts:            { args: { force: false }, call: function(request) { return get_contacts(request.args.force); } },
	get_contacts_cached:     { call: get_contacts_cached },
	save_contact:            { args: { index: 0, name: '', number: '' }, call: function(request) { return save_contact(request.args.index, request.args.name, request.args.number); } },
	delete_contact:          { args: { index: 0 }, call: function(request) { return delete_contact(request.args.index); } },
	delete_contacts_bulk:    { args: { indices: [] }, call: function(request) { return delete_contacts_bulk(request.args.indices); } },
	import_contacts:         { args: { contacts: [] }, call: function(request) { return import_contacts(request.args.contacts); } },
	get_poll:                { call: get_poll },
	get_dashboard:           { call: get_dashboard },
	get_all:                 { call: get_all },
	get_all_full:            { call: get_all_full },
	set_connection_settings: { args: { settings: {} }, call: function(request) { return set_connection_settings(request.args.settings); } },
	edit_profile:            { args: { profile: {} }, call: function(request) { return edit_profile(request.args.profile); } },
	delete_profile:          { args: { profile_id: 0 }, call: function(request) { return delete_profile(request.args.profile_id); } },
	set_default_profile:     { args: { profile_id: 0 }, call: function(request) { return set_default_profile(request.args.profile_id); } },
	get_nv_imei:             { call: get_nv_imei },
	get_imei:                { call: get_imei },
	set_imei:                { args: { imei: '' }, call: function(request) { return set_imei(request.args.imei); } },
	cancel_imei_change:      { call: cancel_imei_change },
	backup_nv_partitions:    { call: backup_nv_partitions },
	restore_nv_backup:       { args: { imei: '' }, call: function(request) { return restore_nv_backup(request.args.imei); } },
	reset_modem:             { call: reset_modem },
};

return { 'hh4xmodem': methods };
