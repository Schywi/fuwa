-- GitOps layout for fuwa, and the Argo CD panel that goes with it.
--
-- The k3s repository (`experiments`) owns the Applications; the manifests stay
-- here, next to the code they describe. These tests pin the split, the pruning
-- safety rails, the image pinning, and the proxy that makes Argo embeddable.

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

local function exists(path)
	local file = io.open(path, "rb")
	if file then
		file:close()
		return true
	end
	return false
end

local app_kustomization = read_file("infra/k8s/app/kustomization.yaml")
local obs_kustomization = read_file("infra/k8s/observability/kustomization.yaml")
local application = read_file("infra/k8s/argocd/application.yaml")
local build_sh = read_file("infra/k8s/build.sh")
local networkpolicy = read_file("infra/k8s/app/networkpolicy.yaml")
local nginx = read_file("nginx.conf")
local home_fuwa = read_file("shell/views/fragments/home.fuwa")

-- ── The split ────────────────────────────────────────────────────────────

t.test("the runtime and the observability stack are separate kustomizations", function()
	for _, name in ipairs({ "namespace", "rbac", "deployment", "service", "networkpolicy" }) do
		if not exists("infra/k8s/app/" .. name .. ".yaml") then
			error("app/" .. name .. ".yaml should exist")
		end
		t.contains(app_kustomization, "- " .. name .. ".yaml", "expected app/" .. name .. " in the kustomization")
	end
	for _, name in ipairs({ "loki", "tempo", "otel-collector", "netpol" }) do
		if not exists("infra/k8s/observability/" .. name .. ".yaml") then
			error("observability/" .. name .. ".yaml should exist")
		end
		t.contains(obs_kustomization, "- " .. name .. ".yaml", "expected observability/" .. name .. " in the kustomization")
	end
	-- The runtime app must never adopt the log store.
	if app_kustomization:find("loki.yaml", 1, true) then
		error("app/ must not include loki.yaml")
	end
end)

t.test("the manifests that must survive a prune say so", function()
	local namespace = read_file("infra/k8s/app/namespace.yaml")
	local loki = read_file("infra/k8s/observability/loki.yaml")
	t.contains(namespace, "argocd.argoproj.io/sync-options: Prune=false", "the namespace must not be pruned")
	t.contains(loki, "argocd.argoproj.io/sync-options: Prune=false", "the loki PVC must not be pruned")
end)

t.test("the image tag is pinned by the build, not by kubectl", function()
	t.contains(app_kustomization, "images:", "expected an image pin")
	t.contains(app_kustomization, "- name: 127.0.0.1:5000/fuwa", "expected the registry reference the node pulls")
	t.contains(app_kustomization, "    newTag:", "expected a mutable tag slot the build rewrites")

	t.contains(build_sh, 'tag="sha-${sha}"', "expected the tag to be the git sha")
	t.contains(build_sh, 'sed -i "s|^    newTag: .*|    newTag: ${tag}|"', "expected the build to pin what it pushed")
	t.contains(build_sh, "commit it to deploy through Argo", "expected the deploy instruction, not a rollout restart")
end)

-- ── The Application that the k3s repo applies ─────────────────────────────

t.test("the Application follows the k3s repo's conventions", function()
	t.contains(application, "kind: Application", "expected a single Application")
	t.contains(application, "namespace: argocd", "Applications live in the argocd namespace")
	t.contains(application, "app.kubernetes.io/managed-by: argocd", "expected the conventional label")
	t.contains(application, "resources-finalizer.argocd.argoproj.io", "expected the resources finalizer")
	t.contains(application, "project: default", "expected the default project")
	t.contains(application, "prune: true", "expected pruning")
	t.contains(application, "selfHeal: true", "expected self-healing")
end)

t.test("the Application reads the fuwa repo, not a copy", function()
	t.contains(application, "repoURL: https://github.com/Schwyi/fuwa.git", "expected the fuwa repository")
	t.contains(application, "targetRevision: k3s-integration", "expected the integration branch")
	t.contains(application, "path: infra/k8s/app", "expected the runtime kustomization")
	t.contains(application, "namespace: fuwa", "expected the fuwa namespace as destination")
end)

t.test("the runtime pod may reach argocd-server, as the panel requires", function()
	t.contains(networkpolicy, "io.kubernetes.pod.namespace: argocd", "expected an argocd egress rule")
	t.contains(networkpolicy, 'port: "80"', "expected argocd-server's http port")
end)

-- ── The panel ────────────────────────────────────────────────────────────

t.test("nginx makes Argo embeddable: headers dropped, base rewritten", function()
	t.contains(nginx, "location /argocd/ {", "expected the panel proxy")
	t.contains(nginx, "proxy_hide_header X-Frame-Options;", "expected the framing refusal removed")
	t.contains(nginx, "proxy_hide_header Content-Security-Policy;", "expected frame-ancestors removed")
	t.contains(nginx, 'sub_filter \'<base href="/">\' \'<base href="/argocd/">\';', "expected the asset base rewritten")
	t.contains(nginx, "location /api/ {", "expected the absolute /api/v1 calls proxied")
	t.contains(nginx, "location = /argocd {", "expected the bare prefix to redirect")
end)

t.test("the shell exposes Argo as a panel, never as a tab", function()
	t.contains(home_fuwa, "openPanel('/argocd/')", "expected the button to open the panel")
	if home_fuwa:find('href="http://192.168.0.247', 1, true) then
		error("Argo must not be linked as a plain anchor (that opens a tab)")
	end
end)

print(string.format("k8s_gitops: %d passed, %d failed", results.passed, results.failed))
for _, failure in ipairs(results.failures) do
	print("FAIL: " .. failure)
end
if results.failed > 0 then
	os.exit(1)
end
