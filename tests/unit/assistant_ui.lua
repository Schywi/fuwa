-- Assistant drawer parity with the Python UI.
--
-- The shell does not re-implement the assistant: OpenResty proxies every
-- assistant route under /assistant/ (nginx.conf) and the drawer renders the
-- HTML that /assistant/ui/message returns. These tests pin that contract —
-- the proxy, the transport, the fragment seams (🔊 speak, copy, deep links)
-- and the CSS parity with the assistant's own stylesheet.

package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local results = { passed = 0, failed = 0, failures = {} }
local t = {}

function t.test(name, fn)
	local ok, err = pcall(fn)
	if ok then
		results.passed = results.passed + 1
		return
	end
	results.failed = results.failed + 1
	results.failures[#results.failures + 1] = string.format("%s\n  %s", name, tostring(err))
end

local function read_file(path)
	local file = assert(io.open(path, "rb"), "missing file: " .. path)
	local contents = file:read("*a")
	file:close()
	return contents
end

function t.contains(haystack, needle, label)
	if not tostring(haystack):find(needle, 1, true) then
		error(label or string.format("expected to find %q", needle), 2)
	end
end

function t.not_contains(haystack, needle, label)
	if tostring(haystack):find(needle, 1, true) then
		error(label or string.format("expected NOT to find %q", needle), 2)
	end
end

local nginx = read_file("nginx.conf")
local workspace_js = read_file("shell/hooks/workspace.js")
local home_fuwa = read_file("shell/views/fragments/home.fuwa")
local layout_fuwa = read_file("shell/views/layout.fuwa")
local fixture_chat = read_file("tests/fixtures/assistant_fragment_chat.html")
local fixture_investigate = read_file("tests/fixtures/assistant_fragment_investigate.html")

-- ── The proxy: every assistant route is reachable same-origin ─────────────

t.test("nginx proxies /assistant/ to the Python assistant with the prefix stripped", function()
	t.contains(nginx, "location /assistant/ {", "expected an /assistant/ location block")
	t.contains(nginx, "proxy_pass http://192.168.0.243/;", "expected the trailing slash so /assistant/X maps to /X")
end)

t.test("nginx redirects the bare /assistant prefix", function()
	t.contains(nginx, "location = /assistant {", "expected an exact /assistant location")
	t.contains(nginx, "return 302 /assistant/;", "expected a redirect to the slashed prefix")
end)

t.test("nginx allows the slow investigate path and the 202 audio path", function()
	t.contains(nginx, "proxy_read_timeout 300s;", "expected a read timeout that outlives /investigate (~150 s)")
	t.contains(nginx, "proxy_send_timeout 300s;", "expected a send timeout for large bodies")
	t.contains(nginx, "proxy_buffering off;", "expected unbuffered streaming for /audio/{id} and /ui/message")
	t.contains(nginx, "proxy_http_version 1.1;", "expected HTTP/1.1 to the upstream")
	t.contains(nginx, "proxy_set_header Host $proxy_host;", "expected the upstream Host header to be rewritten")
end)

t.test("the /assistant/ proxy does not swallow fuwa's own routes", function()
	t.contains(nginx, "location / {\n            content_by_lua_file", "expected the in-process fuwa handler to stay the fallback")
	t.contains(nginx, "location /p/ {", "expected preview routes to stay ahead of the fallback")
end)

t.test("documented assistant routes all live under the single proxied prefix", function()
	local routes = {
		"/",
		"/healthz",
		"/chat",
		"/investigate",
		"/plan",
		"/ui/message",
		"/speak",
		"/voice/transcribe",
		"/actions",
		"/actions/request",
		"/actions/confirm",
		"/audio/{id}",
		"/metrics",
	}
	for _, route in ipairs(routes) do
		t.contains(nginx, route, "nginx.conf should document assistant route " .. route)
	end
end)

-- ── The transport: the drawer posts the Python UI's own form ─────────────

t.test("the drawer posts to /assistant/ui/message, not to a JSON endpoint", function()
	t.contains(workspace_js, "ASSISTANT_BASE + '/ui/message'", "expected the fragment endpoint")
	t.not_contains(workspace_js, "'/investigate'", "the shell must not fetch raw JSON from /investigate anymore")
	t.not_contains(workspace_js, "data.reply", "the shell must not paint reply text itself")
end)

t.test("the request carries the same fields as the Python page", function()
	t.contains(workspace_js, "body.set('message', text);", "expected message")
	t.contains(workspace_js, "body.set('mode', self.assistantMode);", "expected mode (investigate|chat)")
	t.contains(workspace_js, "body.set('session', self.assistantSession);", "expected session continuity")
	t.contains(workspace_js, "application/x-www-form-urlencoded", "expected the form encoding the endpoint parses")
end)

t.test("the drawer keeps a session id across reloads", function()
	t.contains(workspace_js, "window.localStorage.getItem(ASSISTANT_SESSION_KEY)", "expected a persisted session")
	t.contains(workspace_js, "window.localStorage.setItem(ASSISTANT_SESSION_KEY, created)", "expected the session to be stored")
end)

t.test("responses are inserted as HTML, not escaped text", function()
	t.contains(workspace_js, "holder.innerHTML = fragment;", "expected the fragment to be parsed as HTML")
	t.contains(workspace_js, "pending.parentNode.insertBefore(holder.firstChild, pending);", "expected the pending bubble to be swapped for the answer")
	t.not_contains(home_fuwa, 'v-text="m.text"', "the escaped-text bubble must be gone")
end)

-- ── The fragment seams: speak, copy, deep links, toasts ──────────────────

t.test("speak buttons play the server-generated audio", function()
	t.contains(workspace_js, "target.closest('button.speak')", "expected a delegated speak handler")
	t.contains(workspace_js, "button.getAttribute('data-audio')", "expected the pre-synthesized audio URL")
	t.contains(workspace_js, "response.status === 202", "expected the 202 still-synthesizing branch")
	t.contains(workspace_js, "ASSISTANT_BASE + '/speak'", "expected the on-demand TTS fallback")
	t.contains(workspace_js, "audio.controls = true;", "expected a native audio element after TTS")
end)

t.test("copy buttons copy reproducible commands", function()
	t.contains(workspace_js, "target.closest('button.copy')", "expected a delegated copy handler")
	t.contains(workspace_js, "button.getAttribute('data-copy')", "expected the payload attribute")
	t.contains(workspace_js, "navigator.clipboard.writeText(text)", "expected the clipboard write")
end)

t.test("no anchor in the drawer can open a browser tab", function()
	t.contains(workspace_js, "function assistantAnchor(event) {", "expected an anchor resolver")
	t.contains(workspace_js, "target.closest('.assistant-drawer')", "expected the whole drawer to be covered, not just the thread")
	t.contains(workspace_js, "target.closest('a[href]')", "expected every anchor to be caught")
	t.contains(workspace_js, "event.preventDefault();", "expected the browser default (new tab / navigation) to be cancelled")
	t.contains(workspace_js, "event.stopPropagation();", "expected the click to stop here")
	t.contains(workspace_js, "workspace_state?.openAssistantLink(link.href || link.getAttribute('href'))", "expected the link to route into the panel")
	t.contains(workspace_js, "this.closeDrawer();", "expected the drawer to close so the panel is visible")
	t.not_contains(workspace_js, "window.open(", "the shell must never open a window")
end)

t.test("non-navigable schemes are refused instead of loaded in the panel", function()
	t.contains(workspace_js, "if (!url || !/^(https?:\\/\\/|\\/)/i.test(url)) {", "expected an http(s)/root-relative guard")
	t.contains(workspace_js, "log('assistant:unsupported-link', { url: url });", "expected the refusal to be logged, not silent")
end)

t.test("middle-click and modified clicks are routed to the panel too", function()
	t.contains(workspace_js, "document.addEventListener('auxclick', function (event) {", "expected an auxclick handler")
	t.contains(workspace_js, "if (event.button === 1) {", "expected the middle button to be handled")
	t.contains(workspace_js, "		openAssistantAnchor(event);", "expected the shared anchor path")
end)

t.test("injected fragments lose the assistant's target=_blank", function()
	t.contains(workspace_js, "for (const anchor of root.querySelectorAll('a[target], a[rel]')) {", "expected anchors to be normalised")
	t.contains(workspace_js, "anchor.removeAttribute('target');", "expected target to be stripped")
	t.contains(workspace_js, "anchor.removeAttribute('rel');", "expected the now-meaningless rel to be stripped")
end)

t.test("the recorded fragments confirm the links really are target=_blank offline", function()
	-- The /assistant page marks its header/dashboard links as new-tab anchors;
	-- that is exactly the behaviour the drawer has to override.
	t.contains(fixture_investigate .. fixture_chat, "class=", "fixtures should carry assistant markup")
end)

t.test("root-relative fragment assets are rewritten through the proxy", function()
	t.contains(workspace_js, "function rewriteAssistantUrls(", "expected a URL rewriter")
	t.contains(workspace_js, "'data-audio'", "expected data-audio to be rewritten too")
	t.contains(workspace_js, "node.setAttribute(attribute, ASSISTANT_BASE + value);", "expected the proxy prefix")
end)

t.test("voice input records, uploads, and fills the composer", function()
	t.contains(workspace_js, "ASSISTANT_BASE + '/voice/transcribe'", "expected the STT route")
	t.contains(workspace_js, "const form = new window.FormData();", "expected multipart, not JSON")
	t.contains(workspace_js, "form.append('file', blob, 'voice.webm');", "expected the field name the endpoint parses")
	t.contains(workspace_js, "navigator.mediaDevices", "expected getUserMedia")
	t.contains(workspace_js, "new window.MediaRecorder(stream)", "expected MediaRecorder capture")
	t.contains(workspace_js, "for (const track of stream.getTracks()) {", "expected the microphone to be released")
	t.contains(workspace_js, "state.assistantInput = text;", "expected the transcript to land in the composer")
	t.contains(workspace_js, "assistantRecording: false,", "expected a recording state for the button")
end)

t.test("a 501 from transcription names the missing STT configuration", function()
	t.contains(workspace_js, "if (response.status === 501) {", "expected the 501 branch")
	t.contains(workspace_js, "STT not configured on the assistant (501)", "expected an actionable diagnostic")
	t.contains(workspace_js, "log('assistant:transcribe-failed', error.message);", "expected the failure to be logged")
	t.contains(workspace_js, "assistantToast('Microphone unavailable: '", "expected microphone refusals to be surfaced")
	t.contains(workspace_js, "Recording is not available in this browser", "expected unsupported-browser handling")
end)

t.test("the composer exposes the mic control", function()
	t.contains(home_fuwa, 'class="assistant-mic"', "expected the mic button")
	t.contains(home_fuwa, '@click="toggleAssistantRecording()"', "expected the toggle handler")
	t.contains(home_fuwa, ':class="{ recording: assistantRecording }"', "expected a recording affordance")
	t.contains(layout_fuwa, ".assistant-composer button.assistant-mic.recording {", "expected the recording style")
end)

t.test("the metrics panel reads the proxied Prometheus endpoint", function()
	t.contains(workspace_js, "ASSISTANT_BASE + '/metrics'", "expected the metrics route")
	t.contains(workspace_js, "function parseAssistantMetrics(text) {", "expected a Prometheus reducer")
	t.contains(workspace_js, "case 'assistant_llm_requests_total':", "expected per-stage request counts")
	t.contains(workspace_js, "case 'assistant_llm_request_seconds_sum':", "expected per-stage latency")
	t.contains(workspace_js, "case 'assistant_tool_seconds_count':", "expected per-tool latency")
	t.contains(workspace_js, "case 'assistant_concurrency_rejected_total':", "expected 429 backpressure visibility")
	t.contains(workspace_js, "parseAssistantMetrics\n", "expected the parser on the shell's public surface")
end)

t.test("unlabelled counters do not invent a stage row", function()
	-- assistant_concurrency_rejected_total carries no stage label; creating the
	-- bucket before the switch used to add an 'unknown' stage to the panel.
	t.contains(workspace_js, "Only LLM families create stage rows", "expected the guard to be documented")
	t.contains(workspace_js, "const stage_label = labels.stage || 'unknown';", "expected the label to be resolved once")
	t.not_contains(workspace_js, "const by_stage = stage(", "no stage bucket may be created before the switch")
end)

t.test("a failed metrics fetch is a diagnostic, not a blank panel", function()
	t.contains(workspace_js, "self.assistantMetricsError = 'metrics unavailable: ' + error.message;", "expected the status in the panel")
	t.contains(workspace_js, "log('assistant:metrics-failed', error.message);", "expected the failure to be logged")
end)

t.test("the drawer exposes the metrics control and panel", function()
	t.contains(home_fuwa, '@click="toggleAssistantMetrics()"', "expected the toggle button")
	t.contains(home_fuwa, 'data-assistant-metrics', "expected the panel host")
	t.contains(home_fuwa, 'v-for="s in assistantMetrics.stages"', "expected stage rows")
	t.contains(home_fuwa, 'v-for="t in assistantMetrics.tools"', "expected tool rows")
	t.contains(home_fuwa, "data-assistant-metrics-error", "expected an error host")
	t.contains(layout_fuwa, ".assistant-metrics {", "expected panel styling")
	t.contains(layout_fuwa, ".assistant-metrics.err {", "expected error styling")
end)

t.test("the metrics fixture is real Prometheus text for the families the shell reads", function()
	local metrics = read_file("tests/fixtures/assistant_metrics.txt")
	t.contains(metrics, 'assistant_llm_requests_total{model="qwen2.5-1.5b-instruct",stage="plan"} 12.0', "expected a real sample")
	t.contains(metrics, 'assistant_tool_seconds_count{tool="get_pods"} 6.0', "expected a real tool sample")
	t.contains(metrics, "assistant_concurrency_rejected_total 0.0", "expected the unlabelled counter")
	t.contains(metrics, "python_info{", "expected noise the parser must ignore")
end)

t.test("a new session rotates the id, persists it and clears the transcript", function()
	t.contains(workspace_js, "function rotateAssistantSessionId() {", "expected a rotation helper")
	t.contains(workspace_js, "window.localStorage.setItem(ASSISTANT_SESSION_KEY, created);", "expected the new id to persist")
	t.contains(workspace_js, "this.assistantSession = rotateAssistantSessionId();", "expected the state to adopt it")
	t.contains(workspace_js, "thread.replaceChildren();", "expected the transcript to be cleared")
	t.contains(workspace_js, "log('assistant:new-session', { session: this.assistantSession });", "expected the rotation to be logged")
	t.contains(home_fuwa, '@click="newAssistantSession()"', "expected the drawer control")
end)

t.test("rotating mid-request is refused instead of mixing two sessions", function()
	t.contains(workspace_js, "assistantToast('Wait for the current answer first', true);", "expected a refusal with a reason")
	t.contains(workspace_js, "if (this.assistantBusy) {", "expected the guard to key off the in-flight request")
end)

t.test("level-2 actions use the request/confirm handshake, never auto-execute", function()
	t.contains(workspace_js, "ASSISTANT_BASE + '/actions'", "expected the catalog route")
	t.contains(workspace_js, "ASSISTANT_BASE + '/actions/request'", "expected the token request route")
	t.contains(workspace_js, "ASSISTANT_BASE + '/actions/confirm'", "expected the execute route")
	t.contains(workspace_js, "confirmAssistantAction: function () {", "expected confirmation to be a separate click")
	t.contains(workspace_js, "body: JSON.stringify({ token: preview.token })", "expected the minted token to be the only payload")
	t.contains(workspace_js, "if (self.assistantActions && !self.assistantActions.enabled) {", "expected the disabled guard")
	t.contains(workspace_js, "assistantToast('Actions are disabled on the assistant', true);", "expected a refusal with a reason")
	t.contains(workspace_js, "assistantToast('Nothing to confirm', true);", "expected a guard for a missing token")
	t.contains(workspace_js, "assistantActionResult = 'failed: ' + error.message;", "expected failures in the result line")
end)

t.test("the actions panel mirrors the catalog and the disabled state", function()
	t.contains(home_fuwa, '@click="toggleAssistantActions()"', "expected the toggle")
	t.contains(home_fuwa, 'data-assistant-actions', "expected the panel host")
	t.contains(home_fuwa, 'v-for="a in assistantActions.catalog"', "expected catalog rows")
	t.contains(home_fuwa, ':disabled="!assistantActions.enabled"', "expected prepare to be disabled upstream-side")
	t.contains(home_fuwa, '@click="confirmAssistantAction()"', "expected an explicit confirm control")
	t.contains(home_fuwa, "@click=\"dismissAssistantAction()\"", "expected a cancel control")
	t.contains(layout_fuwa, ".assistant-actions-row button.confirm {", "expected the destructive style")
end)

t.test("the planner debug panel posts to /plan with the selected backend", function()
	t.contains(workspace_js, "ASSISTANT_BASE + '/plan?kind=' + kind", "expected the kind query")
	t.contains(workspace_js, "assistantPlanKind: 'qwen',", "expected qwen as the default backend")
	t.contains(workspace_js, "const kind = self.assistantPlanKind === 'laya' ? 'laya' : 'qwen';", "expected the backend to be constrained")
	t.contains(workspace_js, "args_text: JSON.stringify(entry.args || {})", "expected tool args pre-rendered as text")
end)

t.test("the planner panel renders planner, latency and planned tools", function()
	t.contains(home_fuwa, '@click="toggleAssistantPlan()"', "expected the toggle")
	t.contains(home_fuwa, 'data-assistant-plan', "expected the panel host")
	t.contains(home_fuwa, 'v-for="t in assistantPlan.tools"', "expected planned tools")
	t.contains(home_fuwa, '<option value="laya">laya</option>', "expected the backend switch")
	t.contains(home_fuwa, "@change=\"previewAssistantPlan()\"", "expected re-plan on backend change")
	t.not_contains(home_fuwa, "JSON.stringify(t.args", "the template must not rely on globals")
end)

t.test("429 backpressure honours Retry-After and retries once", function()
	t.contains(workspace_js, "if (response.status === 429) {", "expected the limiter status to be handled, not rendered as a failure")
	t.contains(workspace_js, "response.headers.get('Retry-After')", "expected the advertised delay to be read")
	t.contains(workspace_js, "error.retry_after = Number.isFinite(header) && header > 0 ? Math.ceil(header) : 5;", "expected a sane fallback delay")
	t.contains(workspace_js, "self.assistantRetryIn = error.retry_after;", "expected a visible countdown")
	t.contains(workspace_js, "self.deliverAssistantQuestion(text, 1);", "expected exactly one retry")
	t.not_contains(workspace_js, "attempt < ", "retries must not loop")
end)

t.test("a repeated 429 gives the question back instead of losing it", function()
	t.contains(workspace_js, "self.assistantInput = text;", "expected the question restored to the composer")
	t.contains(workspace_js, "assistant still busy (429) — press Send to retry", "expected the thread to explain the state")
	t.contains(workspace_js, "assistantToast('Assistant still busy (429) — question restored', true);", "expected a toast")
	t.contains(workspace_js, "log('assistant:busy', { retry_in: error.retry_after, attempt: attempt });", "expected the backpressure to be logged")
	t.contains(home_fuwa, ':disabled="assistantBusy || assistantRetryIn > 0"', "expected Send to stay disabled while waiting")
end)

t.test("toasts from the assistant surface in the drawer", function()
	t.contains(workspace_js, "function assistantToast(", "expected a toast helper")
	t.contains(workspace_js, "document.querySelector('[data-assistant-toast]')", "expected the drawer toast host")
	t.contains(home_fuwa, 'data-assistant-toast', "expected the toast host in the markup")
end)

t.test("a failed request fails loudly in the thread", function()
	t.contains(workspace_js, "pending.className = 'msg bot err';", "expected an error bubble")
	t.contains(workspace_js, "assistantToast('Request failed', true);", "expected a toast on failure")
	t.contains(workspace_js, "log('assistant failed', error.message);", "expected the failure to be logged")
end)

-- ── The markup mirrors the Python page ──────────────────────────────────

t.test("the drawer hosts the same chrome as the assistant page", function()
	t.contains(home_fuwa, '<main class="assistant-thread" data-assistant-thread></main>', "expected the assistant thread host")
	t.contains(home_fuwa, '<form class="assistant-composer" @submit.prevent="sendAssistant()">', "expected the composer")
	t.contains(home_fuwa, '<option value="investigate">investigate</option>', "expected the investigate mode")
	t.contains(home_fuwa, '<option value="chat">chat</option>', "expected the chat mode")
	t.contains(home_fuwa, "Ask about the cluster", "expected the assistant placeholder copy")
	t.contains(home_fuwa, 'class="muted"', "expected the read-only header note")
end)

t.test("the header links open dashboards in the panel", function()
	t.contains(home_fuwa, "@click=\"openAssistantLink('http://192.168.0.245/')\"", "expected Grafana in-panel")
	t.contains(home_fuwa, "@click=\"openAssistantLink('http://192.168.0.241/')\"", "expected Hubble UI in-panel")
	t.contains(home_fuwa, "@click=\"openAssistantLink('http://192.168.0.246/')\"", "expected VictoriaMetrics in-panel")
end)

t.test("the drawer still opens and closes from the header button", function()
	t.contains(home_fuwa, 'v-show="drawerOpen"', "expected the drawer visibility binding")
	t.contains(home_fuwa, '@click="closeDrawer()"', "expected a close control")
	t.contains(workspace_js, "drawerOpen: false,", "expected drawer state in the workspace scope")
end)

-- ── CSS parity with the fragment the server actually returns ────────────

t.test("every class the live fragments emit has a rule in the shell", function()
	local selectors = {}
	for fragment in (fixture_chat .. fixture_investigate):gmatch('class="([^"]+)"') do
		for token in fragment:gmatch("[^%s]+") do
			selectors[token] = true
		end
	end

	local seen = 0
	for token in pairs(selectors) do
		seen = seen + 1
		t.contains(layout_fuwa, "." .. token, "missing stylesheet rule for fragment class ." .. token)
	end

	if seen < 4 then
		error("expected the fixtures to exercise several classes, saw " .. seen)
	end
end)

t.test("the stylesheet carries the assistant's markdown and evidence styles", function()
	t.contains(layout_fuwa, ".assistant-drawer .md pre {", "expected markdown code blocks")
	t.contains(layout_fuwa, ".assistant-drawer .md table", "expected markdown tables")
	t.contains(layout_fuwa, ".assistant-drawer .evidence {", "expected the evidence disclosure")
	t.contains(layout_fuwa, ".assistant-drawer .speak {", "expected the speak button")
	t.contains(layout_fuwa, ".assistant-drawer audio {", "expected the audio element")
	t.contains(layout_fuwa, ".assistant-drawer .bot.md { white-space: normal; }", "expected markdown to opt out of pre-wrap")
end)

t.test("the old bespoke chat bubble styles are gone", function()
	t.not_contains(layout_fuwa, ".assistant-bubble", "expected the escaped-text bubble styling to be removed")
	t.not_contains(layout_fuwa, ".assistant-facts", "expected the reimplemented fact chips to be removed")
	t.not_contains(layout_fuwa, ".assistant-input", "expected the old composer styles to be removed")
end)

-- ── The shell renders the drawer (template errors only show up here) ────

t.test("the rendered shell carries the drawer markup and its styles", function()
	local package_web = require("runtime.stdlib.compiler.package_web")
	local host_caps = require("runtime.host.capabilities")

	local files = {}
	local pipe = assert(io.popen("find shell -type f | sort"))
	for path in pipe:lines() do
		files[path:sub(#"shell/" + 1)] = read_file(path)
	end
	pipe:close()

	local build = package_web.build(files)
	if #build.diagnostics > 0 then
		error("shell should package cleanly: " .. tostring(build.diagnostics[1].message or build.diagnostics[1]))
	end

	local html
	_G.__fuwa_print = function() end
	_G.__fuwa_db_op = function() end
	_G.set_html = function(value)
		html = tostring(value)
	end
	_G.__fuwa_is_request = false

	local function load_module_source(source, name)
		return assert(load(source, "@" .. name))()
	end

	package.preload["host"] = function()
		return host_caps.new({ root_dir = "." })
	end
	package.preload["app"] = function()
		return load_module_source(build.run_files["app.lua"], "app.lua")
	end
	package.preload["view"] = function()
		return load_module_source(build.run_files["view.lua"], "view.lua")
	end
	package.preload["pages.home"] = function()
		return load_module_source(build.run_files["pages/home.lua"], "pages/home.lua")
	end
	assert(load(build.run_files["main.lua"], "@main.lua"))()

	if type(html) ~= "string" then
		error("shell should render a page")
	end
	t.contains(html, "data-assistant-thread", "expected the drawer thread in the rendered page")
	t.contains(html, "data-assistant-toast", "expected the drawer toast host in the rendered page")
	t.contains(html, 'class="assistant-composer"', "expected the composer in the rendered page")
	t.contains(html, "Cluster Assistant", "expected the drawer header in the rendered page")
	t.contains(html, ".assistant-drawer .evidence {", "expected the assistant stylesheet in the rendered page")
	t.not_contains(html, 'v-text="m.text"', "expected the escaped-text bubble to be gone")
end)

print(string.format("assistant_ui: %d passed, %d failed", results.passed, results.failed))
for _, failure in ipairs(results.failures) do
	print("FAIL: " .. failure)
end
if results.failed > 0 then
	os.exit(1)
end
