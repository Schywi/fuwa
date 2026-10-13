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
	t.contains(app, "FUWA_SIGNOZ_OTLP_URL: http://vector-router:4318/v1/traces", "expected OTLP traces to route through Vector before reaching Signoz")
	t.contains(app, "FUWA_VECTOR_URL: http://vector-router:8687/", "expected ingress container to know where to forward request events")
	t.not_contains(app, "busybox", "expected busybox placeholders to be removed from the app fragment")

	t.contains(dev, "telemetry.yml", "expected dev stack to include telemetry services")
	t.contains(dev, "signoz.yml", "expected dev stack to include the SigNoz services")
	t.not_contains(dev, "openresty.yml", "expected the imported stack not to replace the current ingress")
	t.not_contains(dev, "busybox", "expected no placeholder containers in the imported stack")
end)

t.test("root nginx keeps dev handlers and serves the pod-log stream", function()
	local nginx = read_file("nginx.conf")

	t.contains(nginx, "user root;", "expected openresty workers to run as root")
	t.contains(nginx, "location /__dev/traces {", "expected trace endpoint to remain on the current ingress")
	t.contains(nginx, "location /__dev/traces/live {", "expected trace SSE endpoint to remain on the current ingress")
	t.contains(nginx, "location /__dev/pods/live {", "expected the pod-log SSE endpoint to be served")
	t.contains(nginx, "resolver 10.43.0.10", "expected the cluster CoreDNS resolver")
	t.not_contains(nginx, "resolver 127.0.0.11", "expected the Docker embedded resolver to be removed")
	t.not_contains(nginx, "location /dash/signoz/ {", "expected the compose-only SigNoz proxy to be removed")
	t.not_contains(nginx, "proxy_pass http://victoriametrics:8428;", "expected the compose-only VictoriaMetrics proxy to be removed")
	t.not_contains(nginx, "proxy_pass http://vector-router:8686;", "expected the compose-only Vector proxy to be removed")
end)

t.test("shell tmux pane streams cluster pods and links cluster dashboards", function()
	local home = read_file("shell/views/fragments/home.fuwa")

	t.contains(home, 'data-tmux-slot="fuwa"', "expected a fuwa pod slot")
	t.contains(home, 'data-tmux-selector="app.kubernetes.io/name=fuwa"', "expected slots to select pods by label")
	t.contains(home, "openPanel('http://192.168.0.245/')", "expected the Grafana button to embed the Grafana LoadBalancer IP in the panel")
	t.contains(home, "openPanel('http://192.168.0.241/')", "expected the Cilium button to embed the Hubble UI LoadBalancer IP in the panel")
	t.contains(home, "openPanel('http://192.168.0.242/browser/?dbms=bolt%3A%2F%2F192.168.0.242%3A7687&amp;db=neo4j&amp;preselectAuthMethod=NO_AUTH')", "expected the Neo4j button to open Browser with Bolt prefilled and no-auth selected")
	t.contains(home, "openDrawer()", "expected the Assistant button to open the chat drawer")
	t.contains(home, '@submit.prevent="sendAssistant()"', "expected the drawer to host the native assistant chat")
	t.not_contains(home, "openSignoz", "expected the dead SigNoz panel handler to be removed")
	t.not_contains(home, "home.arpa", "expected no home.arpa hosts in the shell")
end)

t.test("openresty tracing fans out traces, metrics and logs over OTLP", function()
	local sink = read_file("runtime/openresty/tracing/sink.lua")
	local traces = read_file("runtime/openresty/traces.lua")
	local pipeline = read_file("runtime/openresty/tracing/pipeline.lua")
	local router = read_file("runtime/openresty/tracing/router.lua")
	local otlp = read_file("runtime/openresty/tracing/adapters/otlp.lua")

	t.contains(sink, 'require("runtime.openresty.tracing.pipeline")', "expected sink to route through the shared tracing pipeline")
	t.contains(traces, 'require("runtime.openresty.tracing.pipeline")', "expected POST trace ingestion to share the same pipeline")
	t.contains(pipeline, 'require("runtime.openresty.tracing.router")', "expected pipeline to delegate backend routing to the router layer")
	t.contains(router, 'os.getenv("FUWA_OTLP_URL")', "expected the router OTLP endpoint to be configurable")
	t.contains(router, 'emit_trace(event)', "expected router to fan out traces explicitly")
	t.contains(router, 'emit_metric(event)', "expected router to fan out metrics explicitly")
	t.contains(router, 'emit_log(event)', "expected router to fan out logs explicitly")
	t.not_contains(router, "vector", "expected the Vector adapter to be gone")
	t.contains(otlp, 'event.kind ~= "request"', "expected only request spans to become OTLP traces")
	t.contains(otlp, 'http.status_code', "expected OTLP payloads to preserve request status")
	t.contains(otlp, 'resourceMetrics', "expected OTLP metrics payloads")
	t.contains(otlp, 'http_requests_total', "expected request counters to be exported as OTLP metrics")
end)

t.test("seeded dashboard files are present", function()
	local bootstrap = read_file("infra/docker-compose/signoz-bootstrap.py")
	local overview = read_file("infra/signoz-seeds/dashboards/fuwa-overview.json")

	t.contains(bootstrap, "build_dashboard_payload", "expected full SigNoz bootstrap parity, not the minimal placeholder seeder")
	t.contains(bootstrap, "_widgets_for_title", "expected generated dashboard widget templates")
	t.contains(overview, "Request count, error rate, and status breakdown across all services", "expected the real seed descriptions from exploration")
end)

t.test("vector otlp passthrough uses the documented source and sink shape", function()
	local vector = read_file("infra/docker-compose/vector.toml")

	t.contains(vector, "[sources.otlp.use_otlp_decoding]", "expected OTLP passthrough to preserve trace payloads")
	t.contains(vector, 'logs = true', "expected OTLP passthrough to preserve log payloads")
	t.contains(vector, 'traces = true', "expected OTLP decoding to stay enabled for traces")
	t.contains(vector, "[sources.otlp.grpc]", "expected the Vector OTLP source to expose the gRPC listener too")
	t.contains(vector, 'address = "0.0.0.0:4317"', "expected OTLP gRPC to listen on the standard collector port")
	t.contains(vector, "[sources.otlp.http]", "expected the Vector OTLP source to expose the HTTP listener")
	t.contains(vector, 'address = "0.0.0.0:4318"', "expected OTLP HTTP to listen on the standard collector port")
	t.contains(vector, 'inputs = ["otlp.traces"]', "expected the Signoz sink to consume the trace output stream")
	t.contains(vector, 'inputs = ["otlp.logs"]', "expected the SigNoz log sink to consume the log output stream")
	t.contains(vector, "[sinks.signoz.protocol]", "expected nested protocol config for the Vector OTLP sink")
	t.contains(vector, 'type = "http"', "expected Vector sink protocol type to be HTTP")
	t.contains(vector, 'uri = "http://signoz-ingester:4318/v1/traces"', "expected SigNoz OTLP HTTP endpoint")
	t.contains(vector, "[sinks.signoz.protocol.encoding]", "expected explicit sink encoding block nested under protocol")
	t.contains(vector, "[sinks.signoz_logs.protocol]", "expected nested protocol config for the Vector OTLP log sink")
	t.contains(vector, 'uri = "http://signoz-ingester:4318/v1/logs"', "expected SigNoz OTLP log endpoint")
	t.contains(vector, "[sinks.signoz_logs.protocol.encoding]", "expected explicit sink encoding block nested under the log sink protocol")
	t.contains(vector, 'codec = "otlp"', "expected OTLP protobuf encoding for the Signoz sink")
	t.not_contains(vector, 'protocol = "http"', "expected no invalid scalar protocol value in the Vector sink")
end)

if results.failed > 0 then
	io.stderr:write(string.format("%d tests failed\n\n", results.failed))
	for _, failure in ipairs(results.failures) do
		io.stderr:write(failure .. "\n\n")
	end
	os.exit(1)
end

print(string.format("ok - %d infra merge tests", results.passed))
