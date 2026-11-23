/*
 * calllog.js - Call log viewer with filter tabs, pagination & contact resolution
 * Copyright (C) 2026 HH4xModem
 * Licensed under the Apache License, Version 2.0.
 */

'use strict';
'require rpc';
'require view';
'require ui';
'require hh4xmodem.common as hh4x';

hh4x.ensureCss();

const callCallLogData = rpc.declare({
	object: 'hh4xmodem',
	method: 'get_calllog_data',
	params: { list_type: 0, page: 1 }
});

const callContactsCached = rpc.declare({
	object: 'hh4xmodem',
	method: 'get_contacts_cached'
});

const callClearCallLog = rpc.declare({
	object: 'hh4xmodem',
	method: 'clear_call_log',
	reject: true
});

var currentView = null;
var callViewState = { list_type: 0, page: 1 };
var contactMap = { exact: {}, suffix: {} };

const CALL_TABS = [
	{ type: 0, label: _('All') },
	{ type: 1, label: _('Incoming') },
	{ type: 2, label: _('Outgoing') },
	{ type: 3, label: _('Missed') }
];

function callTypeLabel(type) {
	switch (type) {
		case 0: return { text: _('Incoming'), cls: 'call-incoming' };
		case 1: return { text: _('Outgoing'), cls: 'call-outgoing' };
		case 2: return { text: _('Missed'), cls: 'call-missed' };
		default: return { text: _('Unknown'), cls: '' };
	}
}

function reloadCallLog() {
	if (!currentView) return;
	currentView.load().then(function (newData) {
		var newBody = currentView.render(newData);
		var container = document.querySelector('.hh4x-page');
		if (container && container.parentNode)
			container.parentNode.replaceChild(newBody, container);
	}).catch(function (err) {
		ui.addNotification(null, E('p', [_('Error loading call log: ') + String(err)]), 'error');
	});
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function () {
		return Promise.all([
			callCallLogData({ list_type: callViewState.list_type, page: callViewState.page }),
			callContactsCached().catch(function () { return null; })
		]).then(function (res) {
			var cData = res[1] || {};
			contactMap = hh4x.buildContactMap(Array.isArray(cData.contacts) ? cData.contacts : []);
			return res[0] || {};
		});
	},

	render: function (data) {
		currentView = this;
		var countInfo = data.GetCallLogCountInfo || {};
		var listData = data.GetCallLogList || {};
		var callLog = listData.CallLogList || [];
		var totalPages = parseInt(listData.TotalPageCount, 10) || 1;

		var tabBar = E('div', { 'class': 'hh4x-sms-tabs' },
			CALL_TABS.map(function (t) {
				return E('button', {
					'class': 'hh4x-sms-tab cbi-button' + (t.type === callViewState.list_type ? ' hh4x-sms-tab-active cbi-button-action' : ' cbi-button-neutral'),
					'click': function () {
						if (callViewState.list_type !== t.type) {
							callViewState.list_type = t.type;
							callViewState.page = 1;
							reloadCallLog();
						}
					}
				}, [t.label]);
			})
		);

		var body = E('div', { 'class': 'hh4x-page' }, [
			E('div', { 'class': 'hh4x-page-header hh4x-header-flex' }, [
				E('div', {}, [
					tabBar,
					E('h2', { 'class': 'hh4x-page-title' }, [_('Call Log')]),
					E('p', { 'class': 'hh4x-page-desc' }, [
						_('View incoming, outgoing, and missed call history from the modem.')
					])
				]),
				E('div', { 'class': 'hh4x-header-actions' }, [
					E('button', {
						'class': 'cbi-button cbi-button-neutral',
						'click': function () { reloadCallLog(); }
					}, [_('Refresh')]),
					E('button', {
						'class': 'cbi-button cbi-button-negative',
						'click': function (e) {
							e.preventDefault();
							if (!confirm(_('Clear all call log entries? This cannot be undone.'))) return;
							var btn = e.target;
							btn.disabled = true;
							btn.textContent = _('Clearing...');
							callClearCallLog().then(function (r) {
								if (r && r.error == null) {
									callViewState.page = 1;
									reloadCallLog();
								} else {
									ui.addNotification(null, E('p', [_('Clear failed: ') + (r?.error || _('Unknown error'))]), 'error');
									btn.disabled = false;
									btn.textContent = _('Clear All');
								}
							}).catch(function (err) {
								ui.addNotification(null, E('p', [_('Error: ') + String(err)]), 'error');
								btn.disabled = false;
								btn.textContent = _('Clear All');
							});
						}
					}, [_('Clear All')])
				])
			])
		]);

		var totalCalls = countInfo.TotalUsedCount || 0;
		body.appendChild(hh4x.createCard(_('Call Summary'), [
			E('div', { 'class': 'hh4x-summary-grid' }, [
				E('div', { 'class': 'hh4x-summary-item' }, [
					E('span', { 'class': 'hh4x-summary-count' }, [String(countInfo.IncomingCallUsed || 0)]),
					E('span', { 'class': 'hh4x-summary-label' }, [_('Incoming')])
				]),
				E('div', { 'class': 'hh4x-summary-item' }, [
					E('span', { 'class': 'hh4x-summary-count' }, [String(countInfo.OutgoingCallUsed || 0)]),
					E('span', { 'class': 'hh4x-summary-label' }, [_('Outgoing')])
				]),
				E('div', { 'class': 'hh4x-summary-item' }, [
					E('span', { 'class': 'hh4x-summary-count' }, [String(countInfo.MissedCallUsed || 0)]),
					E('span', { 'class': 'hh4x-summary-label' }, [_('Missed')])
				]),
				E('div', { 'class': 'hh4x-summary-item' }, [
					E('span', { 'class': 'hh4x-summary-count' }, [String(totalCalls)]),
					E('span', { 'class': 'hh4x-summary-label' }, [_('Total')])
				])
			])
		]));

		if (callLog.length === 0) {
			body.appendChild(hh4x.createCard(_('Call History'), [
				E('p', { 'style': 'text-align:center;color:var(--text-color-medium);padding:2em 0;' }, [_('No call records found.')])
			]));
		} else {
			var rows = callLog.map(function (call) {
				var typeInfo = callTypeLabel(call.CallLogType);
				var num = call.TelNumber || '--';
				var matched = hh4x.resolveContact(contactMap, num);

				var numberNode = matched
					? E('span', { 'class': 'hh4x-call-number', 'dir': 'auto' }, [
						matched.name,
						E('span', { 'class': 'hh4x-resolved-sub', 'dir': 'ltr' }, [num])
					])
					: E('span', { 'class': 'hh4x-call-number', 'style': 'font-family:monospace;' }, [num]);

				var quickActions = [];
				if (num !== '--' && /[0-9+]/.test(num)) {
					quickActions.push(E('a', {
						'class': 'cbi-button cbi-button-action hh4x-btn-sm',
						'href': L.url('admin', 'hh4xmodem', 'sms') + '#compose=' + encodeURIComponent(num)
					}, [_('SMS')]));
					if (!matched) {
						quickActions.push(E('a', {
							'class': 'cbi-button cbi-button-neutral hh4x-btn-sm',
							'href': L.url('admin', 'hh4xmodem', 'contacts') + '#add=' + encodeURIComponent(num)
						}, [_('+ Contact')]));
					}
				}

				return E('div', { 'class': 'hh4x-call-row' }, [
					E('div', { 'class': 'hh4x-call-left' }, [
						E('span', { 'class': 'hh4x-call-type-badge ' + typeInfo.cls }, [typeInfo.text]),
						numberNode
					]),
					E('div', { 'class': 'hh4x-call-right' }, [
						E('span', { 'class': 'hh4x-call-date' }, [call.Date || '--']),
						E('span', { 'class': 'hh4x-call-duration' }, [hh4x.formatDuration(call.Duration)]),
						quickActions.length ? E('div', { 'class': 'hh4x-call-actions' }, quickActions) : null
					].filter(Boolean))
				]);
			});

			var pagination = hh4x.createPagination(callViewState.page, totalPages, function (nextPage) {
				callViewState.page = nextPage;
				reloadCallLog();
			});

			body.appendChild(hh4x.createCard(_('Call History (%d)').format(callLog.length), [
				E('div', { 'class': 'hh4x-call-list' }, rows),
				pagination
			].filter(Boolean)));
		}

		return body;
	}
});
