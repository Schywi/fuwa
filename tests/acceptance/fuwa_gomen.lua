local dev = require("runtime.fuwa-dev")
local db = require("runtime.db")

local function cleanup_temp_db(path)
	os.remove(path)
	os.remove(path .. "-journal")
	os.remove(path .. "-wal")
	os.remove(path .. "-shm")
end

local function with_temp_sqlite_provider(fn)
	local path = os.tmpname() .. ".sqlite"
	local provider = db.new("sqlite_local", { path = path })
	local ok, err = pcall(fn, provider)
	cleanup_temp_db(path)
	assert(ok, err)
end

local function response_for(provider, path)
	return dev.build_response("payloads/fuwa-gomen", "GET", path, "", {
		db_provider = provider
	})
end

local function assert_scope_state(t, body, balance, spent, pokes)
	local b, s, p = body:match('FuwaGomen%.createScope%(%{ balance: (%d+), spent: (%d+), pokes: (%d+) %}%)')
	t.eq(tonumber(b), balance, "expected balance")
	t.eq(tonumber(s), spent, "expected spent")
	t.eq(tonumber(p), pokes, "expected pokes")
end

local function count_item_rows(body, item)
	local _, count = body:gsub('data%-id="' .. item .. '"', "")
	return count
end

local function assert_base_markup(t, body)
	t.truthy(body:find('id="gomen"', 1, true) ~= nil, "expected gomen root")
	t.truthy(body:find('script defer src="browser.js"', 1, true) ~= nil, "expected browser asset")
	t.truthy(body:find('/vendor/petite-vue/petite-vue-0.4.1.iife.js', 1, true) ~= nil, "expected petite-vue")
	t.truthy(body:find('/vendor/htmx/htmx-1.9.12.min.js', 1, true) ~= nil, "expected htmx")
	t.truthy(body:find('/vendor/unocss/runtime-mini-66.7.0.js', 1, true) ~= nil, "expected unocss")
	t.truthy(body:find('v-scope="FuwaGomen.createScope({ balance: ', 1, true) ~= nil, "expected reactive scope")
	t.truthy(body:find('data%-ref="seed"') ~= nil, "expected declarative receipt seed")
end

local function run_route_matrix(t, provider)
	local home = response_for(provider, "/")
	t.eq(home.status, 200, "expected GET / status")
	assert_base_markup(t, home.body)
	assert_scope_state(t, home.body, 1000, 0, 0)

	local poke = response_for(provider, "/poke")
	t.eq(poke.status, 200, "expected /poke status")
	assert_scope_state(t, poke.body, 1000, 0, 1)

	local cooldown = response_for(provider, "/cooldown")
	t.eq(cooldown.status, 200, "expected /cooldown status")
	assert_scope_state(t, cooldown.body, 1000, 0, 0)

	local onigiri = response_for(provider, "/buy/onigiri")
	t.eq(onigiri.status, 200, "expected /buy/onigiri status")
	assert_scope_state(t, onigiri.body, 950, 50, 0)
	t.eq(count_item_rows(onigiri.body, "onigiri"), 1, "expected onigiri ledger row")

	local ramen = response_for(provider, "/buy/ramen")
	t.eq(ramen.status, 200, "expected /buy/ramen status")
	assert_scope_state(t, ramen.body, 830, 170, 0)
	t.eq(count_item_rows(ramen.body, "ramen"), 1, "expected ramen ledger row")

	local takoyaki = response_for(provider, "/buy/takoyaki")
	t.eq(takoyaki.status, 200, "expected /buy/takoyaki status")
	assert_scope_state(t, takoyaki.body, 630, 370, 0)
	t.eq(count_item_rows(takoyaki.body, "takoyaki"), 1, "expected takoyaki ledger row")

	local sushi = response_for(provider, "/buy/sushi")
	t.eq(sushi.status, 200, "expected /buy/sushi status")
	assert_scope_state(t, sushi.body, 330, 670, 0)
	t.eq(count_item_rows(sushi.body, "sushi"), 1, "expected sushi ledger row")

	local calm_prep_1 = response_for(provider, "/poke")
	local calm_prep_2 = response_for(provider, "/poke")
	t.eq(calm_prep_1.status, 200, "expected prep /poke status")
	t.eq(calm_prep_2.status, 200, "expected prep /poke status")

	local calm = response_for(provider, "/calm")
	t.eq(calm.status, 200, "expected /calm status")
	assert_scope_state(t, calm.body, 330, 670, 0)

	local reset = response_for(provider, "/reset")
	t.eq(reset.status, 200, "expected /reset status")
	assert_scope_state(t, reset.body, 1000, 0, 0)
	t.eq(count_item_rows(reset.body, "onigiri"), 0, "expected onigiri rows cleared")
	t.eq(count_item_rows(reset.body, "ramen"), 0, "expected ramen rows cleared")
	t.eq(count_item_rows(reset.body, "takoyaki"), 0, "expected takoyaki rows cleared")
	t.eq(count_item_rows(reset.body, "sushi"), 0, "expected sushi rows cleared")
end

return function(t)
	t.test("fuwa-gomen route matrix matches memory and sqlite_local", function()
		run_route_matrix(t, db.new("memory"))

		with_temp_sqlite_provider(function(provider)
			run_route_matrix(t, provider)
		end)
	end)

	t.test("fuwa-gomen cooldown and affordability guards preserve state", function()
		local provider = db.new("memory")

		local idle = response_for(provider, "/cooldown")
		assert_scope_state(t, idle.body, 1000, 0, 0)

		response_for(provider, "/buy/sushi")
		response_for(provider, "/buy/sushi")
		response_for(provider, "/buy/sushi")
		local refused = response_for(provider, "/buy/sushi")
		assert_scope_state(t, refused.body, 100, 900, 0)
		t.eq(count_item_rows(refused.body, "sushi"), 3, "expected refused purchase to skip ledger insert")
	end)
end
