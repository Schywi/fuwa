-- runtime/host/shell_config.lua
-- Where the shell's panel buttons point.
--
-- The panels (Grafana, Cilium, Neo4j, ...) live on the deployment's own
-- LoadBalancer range, so these are addresses, not secrets. They are read from
-- the environment so a different cluster can retarget them without editing
-- templates; the defaults are the reference deployment's LAN.
--
-- `home.fuwa` renders these through `&dashboard.panels.*` bindings, which the
-- template engine HTML-escapes, so `&` in a query string survives correctly.

local M = {}

local function endpoint(env_name, default)
	local from_env = os.getenv(env_name)
	if from_env == nil or from_env == "" then
		return default
	end
	return from_env
end

function M.panels()
	return {
		grafana = endpoint("FUWA_PANEL_GRAFANA", "http://192.168.0.245/"),
		cilium = endpoint("FUWA_PANEL_CILIUM", "http://192.168.0.241/"),
		victoriametrics = endpoint("FUWA_PANEL_VICTORIAMETRICS", "http://192.168.0.246/"),
		sandboxes = endpoint("FUWA_PANEL_SANDBOXES", "http://192.168.0.250/"),
		-- Neo4j Browser is opened with its Bolt endpoint and no-auth method
		-- preselected; the query string is part of the address.
		neo4j = endpoint(
			"FUWA_PANEL_NEO4J",
			"http://192.168.0.242/browser/?dbms=bolt%3A%2F%2F192.168.0.242%3A7687&db=neo4j&preselectAuthMethod=NO_AUTH"
		),
		-- Hosts the assistant emits as absolute LoadBalancer URLs that cannot be
		-- framed as-is, so a click is routed onto fuwa's own same-origin proxy
		-- instead (see ASSISTANT_LB_ROUTES in shell/hooks/workspace.js).
		argocd_host = endpoint("FUWA_PANEL_ARGOCD_HOST", "192.168.0.247"),
		kargo_host = endpoint("FUWA_PANEL_KARGO_HOST", "192.168.0.249"),
	}
end

return M
