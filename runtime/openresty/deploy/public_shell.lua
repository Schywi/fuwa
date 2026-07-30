-- runtime/openresty/deploy/public_shell.lua
-- Wraps deployed payload HTML in a minimal standalone document.
-- The marketing page loads this in an iframe — no shell chrome, just the app.

local function build_bridge_script(mount_path)
	return [[
<script>
(function() {
  var base = ']] .. mount_path .. [[';
  window.__FUWA_APP_BASE_PATH__ = base;
  function rebase(url) {
    if (url && url.indexOf('/') === 0 && url.indexOf(base) !== 0) {
      return base + url;
    }
    return url;
  }
  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('a[href^="/"]').forEach(function(el) {
      el.setAttribute('href', rebase(el.getAttribute('href')));
    });
  });
})();
</script>
]]
end

function wrap_html(html, mount_path)
	-- If already a full HTML document, inject bridge script into <head>
	if html:match("<html") or html:lower():match("<!doctype") then
		local bridge = build_bridge_script(mount_path)
		local injected = html:gsub("(<[Hh][Ee][Aa][Dd][^>]*>)", "%1\n" .. bridge, 1)
		return injected
	end

	-- Fragment: wrap in minimal standalone document
	return table.concat({
		"<!doctype html>",
		"<html>",
		"<head>",
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		'<script defer src="/vendor/htmx/htmx-1.9.12.min.js"></script>',
		'<script defer src="/vendor/petite-vue/petite-vue-0.4.1.iife.js"></script>',
		build_bridge_script(mount_path),
		"</head>",
		'<body data-fuwa-public-shell="true">',
		html,
		"</body>",
		"</html>",
	}, "\n")
end
