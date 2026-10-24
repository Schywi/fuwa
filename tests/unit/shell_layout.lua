-- Shell layout: the Observability stage header.
--
-- The panel links (Grafana, Cilium, Argo CD) belong under the "Observability"
-- title, not side by side with it on the same 38px row.

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

local home_fuwa = read_file("shell/views/fragments/home.fuwa")
local layout_fuwa = read_file("shell/views/layout.fuwa")

t.test("the observability header stacks its links below the title", function()
	t.contains(home_fuwa, '<div class="stage-header stage-header--stacked">', "expected the stacked header variant")
	t.contains(home_fuwa, '<span class="stage-title">Observability</span>', "expected the title first")
	t.contains(home_fuwa, '<div class="stage-links">', "expected the links in their own row container")

	-- The title must close before the links open: that is what puts them below.
	local title_at = home_fuwa:find('<span class="stage-title">Observability</span>', 1, true)
	local links_at = home_fuwa:find('<div class="stage-links">', 1, true)
	if not (title_at and links_at and links_at > title_at) then
		error("the link row must follow the title inside the observation header")
	end
end)

t.test("the stacked header is a column, so nothing sits beside the title", function()
	t.contains(layout_fuwa, ".stage-header--stacked {", "expected the variant to be styled")
	t.contains(layout_fuwa, "flex-direction: column;", "expected a column layout")
	t.contains(layout_fuwa, "align-items: flex-start;", "expected the children to be left aligned")
	t.contains(layout_fuwa, "height: auto;", "expected the fixed 38px row height to be released")
	t.contains(layout_fuwa, ".stage-links {", "expected the link row styling")
	t.contains(layout_fuwa, "flex-wrap: wrap;", "expected the links to wrap instead of overflowing")
end)

t.test("the three panel links are unchanged and stay inside the header", function()
	t.contains(home_fuwa, "@click=\"openPanel('http://192.168.0.245/')\"", "expected Grafana")
	t.contains(home_fuwa, "@click=\"openPanel('http://192.168.0.241/')\"", "expected Cilium")
	t.contains(home_fuwa, "@click=\"openPanel('/argocd/')\"", "expected Argo CD")

	-- Slice the header block out by offsets: Lua patterns do not span newlines
	-- without a flag, and this file is one tag per line.
	local start_at = home_fuwa:find('<div class="stage-header stage-header--stacked">', 1, true)
	local end_at = home_fuwa:find('<div class="obs-activity-list"', 1, true)
	if not (start_at and end_at and end_at > start_at) then
		error("could not isolate the observability header")
	end
	local header = home_fuwa:sub(start_at, end_at - 1)
	t.contains(header, '<div class="stage-links">', "the links must live inside the header block")
	t.contains(header, "Grafana", "Grafana must be inside the header block")
	t.contains(header, "Argo CD", "Argo CD must be inside the header block")
end)

t.test("other stage headers are untouched", function()
	-- The terminal and browser headers keep the single-row layout.
	local plain = 0
	for _ in home_fuwa:gmatch('<div class="stage%-header">') do
		plain = plain + 1
	end
	if plain < 1 then
		error("expected at least one single-row stage header to remain")
	end
end)

print(string.format("shell_layout: %d passed, %d failed", results.passed, results.failed))
for _, failure in ipairs(results.failures) do
	print("FAIL: " .. failure)
end
if results.failed > 0 then
	os.exit(1)
end
