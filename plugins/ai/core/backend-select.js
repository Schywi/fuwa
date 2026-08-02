(function () {
	'use strict';

	var cached_capability = null;
	var cached_capability_promise = null;

	function lower(value) {
		return String(value || '').toLowerCase();
	}

	function is_ios_platform(platform) {
		platform = lower(platform);
		return platform === 'iphone' || platform === 'ipad' || platform === 'ipod';
	}

	function is_ios_user_agent(user_agent) {
		user_agent = lower(user_agent);
		if (user_agent.indexOf('iphone') >= 0 || user_agent.indexOf('ipad') >= 0 || user_agent.indexOf('ipod') >= 0) {
			return true;
		}

		return user_agent.indexOf('macintosh') >= 0
			&& typeof navigator === 'object'
			&& navigator.maxTouchPoints > 1;
	}

	function detect_platform() {
		var nav = typeof navigator === 'object' ? navigator : null;
		var platform = nav && nav.platform ? nav.platform : '';
		var user_agent = nav && nav.userAgent ? nav.userAgent : '';
		var ios = is_ios_platform(platform) || is_ios_user_agent(user_agent);

		return {
			platform: platform || 'unknown',
			user_agent: user_agent || '',
			ios: ios,
			max_touch_points: nav && typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0,
		};
	}

	function has_opfs() {
		return typeof navigator === 'object'
			&& navigator.storage
			&& typeof navigator.storage.getDirectory === 'function';
	}

	async function probe_webgpu() {
		if (typeof navigator !== 'object' || !navigator.gpu || typeof navigator.gpu.requestAdapter !== 'function') {
			return {
				available: false,
				reason: 'navigator.gpu unavailable',
			};
		}

		try {
			var adapter = await navigator.gpu.requestAdapter();
			if (!adapter) {
				return {
					available: false,
					reason: 'requestAdapter returned null',
				};
			}

			return {
				available: true,
				reason: 'adapter acquired',
			};
		} catch (err) {
			return {
				available: false,
				reason: err && err.message ? err.message : 'requestAdapter failed',
			};
		}
	}

	async function detect_capability() {
		if (cached_capability) return cached_capability;
		if (cached_capability_promise) return cached_capability_promise;

		cached_capability_promise = (async function () {
			var platform = detect_platform();
			var webgpu = await probe_webgpu();
			var capability = {
				tier: 'tier3_cpu_only',
				preferred_backend: 'wasm',
				webgpu: webgpu.available,
				webgpu_reason: webgpu.reason,
				opfs: has_opfs(),
				platform: platform.platform,
				ios: platform.ios,
				max_touch_points: platform.max_touch_points,
			};

			if (platform.ios) {
				cached_capability = capability;
				return capability;
			}

			if (webgpu.available) {
				capability.tier = 'tier2_webgpu';
				capability.preferred_backend = 'webgpu';
				cached_capability = capability;
				return capability;
			}

			cached_capability = capability;
			return capability;
		})();

		try {
			return await cached_capability_promise;
		} finally {
			cached_capability_promise = null;
		}
	}

	function clear_cache() {
		cached_capability = null;
		cached_capability_promise = null;
	}

	window.FuwaAIBackendSelect = {
		detectCapability: detect_capability,
		clearCache: clear_cache,
	};
})();
