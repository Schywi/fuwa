local results = {
	passed = 0,
	failed = 0,
	failures = {},
}

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

function t.contains(haystack, needle, label)
	if not tostring(haystack):find(needle, 1, true) then
		error(label or string.format("expected to find %q", needle), 2)
	end
end

function t.not_contains(haystack, needle, label)
	if tostring(haystack):find(needle, 1, true) then
		error(label or string.format("expected not to find %q", needle), 2)
	end
end

local function read_file(path)
	local file = assert(io.open(path, "rb"))
	local contents = file:read("*a")
	file:close()
	return contents
end

t.test("top-level infra entrypoint imports the real stack and names the compose project", function()
	local compose = read_file("infra/docker-compose.yml")
	local app = read_file("infra/docker-compose/app.dev.yml")
	local dev = read_file("infra/docker-compose/dev.yml")

	t.contains(compose, "name: docker-compose", "expected compose project name to match shell tmux container names")
	t.contains(compose, "docker-compose/app.dev.yml", "expected top-level compose to include the app ingress fragment")
	t.contains(compose, "docker-compose/dev.yml", "expected top-level compose to include the real infra stack fragment")

	t.contains(app, "services:", "expected app fragment to define services")
	t.contains(app, "openresty:", "expected current ingress service to stay authoritative")
	t.contains(app, "infra/Dockerfile.openresty", "expected app fragment to reuse the current OpenResty image build")
	t.contains(app, "FUWA_SIGNOZ_OTLP_URL: http://signoz-ingester:4318/v1/traces", "expected ingress container to publish the direct SigNoz OTLP target")
	t.contains(app, "FUWA_UPTRACE_OTLP_URL: ${FUWA_UPTRACE_OTLP_URL:-}", "expected optional Uptrace OTLP target for parallel tracing")
	t.contains(app, "FUWA_VECTOR_URL: http://vector-router:8687/", "expected ingress container to know where to forward request events")
	t.not_contains(app, "FUWA_UPTRACE_EMAIL", "expected no invented Uptrace helper credentials in the app ingress env")
	t.not_contains(app, "FUWA_UPTRACE_PASSWORD", "expected no invented Uptrace helper credentials in the app ingress env")
	t.not_contains(app, "busybox", "expected busybox placeholders to be removed from the app fragment")

	t.contains(dev, "telemetry.yml", "expected dev stack to include telemetry services")
	t.contains(dev, "signoz.yml", "expected dev stack to include the SigNoz services")
	t.contains(dev, "uptrace.yml", "expected dev stack to include the Uptrace services")
	t.not_contains(dev, "openresty.yml", "expected the imported stack not to replace the current ingress")
	t.not_contains(dev, "busybox", "expected no placeholder containers in the imported stack")
end)

t.test("root nginx keeps dev handlers and proxies dashboard routes", function()
	local nginx = read_file("nginx.conf")

	t.contains(nginx, "user root;", "expected openresty workers to run as root in dev so docker.sock access works for tmux panes")
	t.contains(nginx, "location /__dev/traces {", "expected trace endpoint to remain on the current ingress")
	t.contains(nginx, "location /__dev/traces/live {", "expected trace SSE endpoint to remain on the current ingress")
	t.contains(nginx, "location /__dev/containers/live {", "expected container mux endpoint to remain on the current ingress")

	t.contains(nginx, "map $http_referer $signoz_api_allowed {", "expected guarded Signoz API routing")
	t.contains(nginx, "location = /dash/signoz/ {", "expected Signoz landing redirect")
	t.contains(nginx, "location /dash/signoz/ {", "expected Signoz dashboard proxy route")
	t.contains(nginx, "proxy_pass http://signoz:8080;", "expected Signoz upstream proxy")
	t.contains(nginx, "if ($signoz_api_allowed = 0) {", "expected API guard for non-dashboard referers")
	t.contains(nginx, "rewrite ^/api/?(.*)$ /dash/signoz/api/$1 break;", "expected Signoz API path rewrite")
	t.contains(nginx, "location /dash/vmetrics/ {", "expected VictoriaMetrics proxy route")
	t.contains(nginx, "proxy_pass http://victoriametrics:8428;", "expected VictoriaMetrics upstream")
	t.contains(nginx, "location /dash/uptrace/ {", "expected proxied Uptrace dashboard route")
	t.contains(nginx, "proxy_pass http://uptrace:14318;", "expected Uptrace upstream proxy")
	t.not_contains(nginx, "/uptrace-local/", "expected no invented uptrace-local helper route in the grounded ingress config")
	t.contains(nginx, "location /dash/clickhouse/ {", "expected ClickHouse proxy route")
	t.contains(nginx, "proxy_pass http://signoz-clickhouse:8123;", "expected ClickHouse upstream")
	t.contains(nginx, "location /dash/vector/ {", "expected Vector proxy route")
	t.contains(nginx, "proxy_pass http://vector-router:8686;", "expected Vector upstream")
end)

t.test("shell tmux pane points at the real app container", function()
	local home = read_file("shell/views/fragments/home.fuwa")
	local tilt = read_file("infra/Tiltfile")

	t.contains(home, 'data-tmux-container="docker-compose-openresty-1"', "expected tmux pane to follow the current app ingress container")
	t.not_contains(home, 'data-tmux-container="docker-compose-fuwa-1"', "expected stale fuwa container slot to be removed")
	t.contains(home, "window.open('/dash/uptrace/'", "expected the Uptrace button to open the grounded Uptrace dashboard route")
	t.not_contains(home, "/uptrace-local/", "expected no invented Uptrace helper button target")
	t.contains(tilt, "project_name='docker-compose'", "expected Tilt compose project name to align with shell tmux expectations")
end)

t.test("openresty tracing pipeline keeps local traces and forwards request events", function()
	local sink = read_file("runtime/openresty/tracing/sink.lua")
	local traces = read_file("runtime/openresty/traces.lua")
	local pipeline = read_file("runtime/openresty/tracing/pipeline.lua")
	local router = read_file("runtime/openresty/tracing/router.lua")
	local vector = read_file("runtime/openresty/tracing/adapters/vector.lua")
	local otlp = read_file("runtime/openresty/tracing/adapters/otlp.lua")
	local http = read_file("runtime/openresty/tracing/http.lua")

	t.contains(sink, 'require("runtime.openresty.tracing.pipeline")', "expected sink to route through the shared tracing pipeline")
	t.contains(traces, 'require("runtime.openresty.tracing.pipeline")', "expected POST trace ingestion to share the same pipeline")
	t.contains(pipeline, 'require("runtime.openresty.tracing.router")', "expected pipeline to delegate backend routing to the router layer")
	t.contains(router, 'emit_trace(event)', "expected router to fan out traces explicitly")
	t.contains(router, 'emit_metric(event)', "expected router to fan out metrics explicitly")
	t.contains(router, 'emit_log(event)', "expected router to reserve a log sink entrypoint")
	t.contains(vector, "request_total = 1", "expected request events to be normalized for Vector metrics")
	t.contains(vector, "error_total = status >= 400 and 1 or 0", "expected Vector payloads to carry error counters")
	t.contains(otlp, 'event.kind ~= "request"', "expected only request spans to become OTLP traces")
	t.contains(otlp, 'http.status_code', "expected OTLP payloads to preserve request status")
	t.contains(http, 'ngx.timer.at(0, post_json_now, target, payload_json, log_label or "http sink")', "expected async forwarding instead of blocking the request path")
end)

t.test("seeded dashboard and uptrace parity files are present", function()
	local bootstrap = read_file("infra/docker-compose/signoz-bootstrap.py")
	local uptrace = read_file("infra/docker-compose/uptrace/config.yml")
	local overview = read_file("infra/signoz-seeds/dashboards/fuwa-overview.json")

	t.contains(bootstrap, "build_dashboard_payload", "expected full SigNoz bootstrap parity, not the minimal placeholder seeder")
	t.contains(bootstrap, "_widgets_for_title", "expected generated dashboard widget templates")
	t.contains(uptrace, "email: admin@uptrace.local", "expected deterministic Uptrace dev user")
	t.contains(uptrace, "token: fuwa_telemetry_demo", "expected seeded Uptrace project token")
	t.contains(overview, "Request count, error rate, and status breakdown across all services", "expected the real seed descriptions from exploration")
end)

if results.failed > 0 then
	io.stderr:write(string.format("%d tests failed\n\n", results.failed))
	for _, failure in ipairs(results.failures) do
		io.stderr:write(failure .. "\n\n")
	end
	os.exit(1)
end

print(string.format("ok - %d infra merge tests", results.passed))
