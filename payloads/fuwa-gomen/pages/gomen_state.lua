local Wallet = require("models.wallet")
local Mood = require("models.mood")
local Ledger = require("models.ledger")

local M = {}

local ITEMS = {
	{ id = "onigiri", icon = "🍙", name = "Onigiri", price = 50 },
	{ id = "ramen", icon = "🍜", name = "Ramen", price = 120 },
	{ id = "takoyaki", icon = "🐙", name = "Takoyaki", price = 200 },
	{ id = "sushi", icon = "🍣", name = "Sushi", price = 300 },
}

local ITEM_BY_ID = {}
for _, item in ipairs(ITEMS) do
	ITEM_BY_ID[item.id] = item
end

local function ensure_wallet()
	local row = Wallet.find_by({ key = "main" })
	if row ~= nil then
		return row
	end
	return assert(Wallet.create({ key = "main", balance = 1000, spent = 0 }).value)
end

local function ensure_mood()
	local row = Mood.find_by({ key = "main" })
	if row ~= nil then
		return row
	end
	return assert(Mood.create({ key = "main", pokes = 0 }).value)
end

local function load_receipt()
	return Ledger.all() or {}
end

local function derive_mood(balance, pokes)
	local key = "neutral"
	if balance <= 0 then
		key = "crying"
	elseif pokes >= 5 then
		key = "tantrum"
	elseif balance < 300 then
		key = "worried"
	elseif pokes >= 3 then
		key = "annoyed"
	elseif pokes >= 1 then
		key = "stern"
	elseif balance >= 800 then
		key = "happy"
	end

	local faces = {
		neutral = "( ˶• ᵕ •˶ )",
		stern = "( ¬_¬ )",
		annoyed = "（ꐦ ¬_¬ ）",
		tantrum = "(ᗒ ᗣ ᗕ)՞",
		worried = "( ˶˃ ⤙ ˂˶ )",
		happy = "( ˶≧ ᗜ ≦˶ )",
		crying = "( ╥﹏╥ )",
	}

	local copy = {
		neutral = { jp = "ふむ…", en = "Mama is watching." },
		stern = { jp = "こら。", en = "Behave yourself." },
		annoyed = { jp = "やめてって。", en = "Quit poking me!" },
		tantrum = { jp = "もう！知らない！", en = "That's IT!" },
		worried = { jp = "あぶないよ…", en = "Money is low..." },
		happy = { jp = "えらいね！", en = "Good job saving!" },
		crying = { jp = "ぜんぶ使ったの…", en = "Papa is crying..." },
	}

	return {
		key = key,
		face = faces[key],
		jp = copy[key].jp,
		en = copy[key].en,
	}
end

local function compute_receipt(receipt_rows)
	local counts = {}
	for _, row in ipairs(receipt_rows) do
		counts[row.item] = (counts[row.item] or 0) + 1
	end

	local rows = {}
	local total = 0
	for _, item in ipairs(ITEMS) do
		local qty = counts[item.id] or 0
		if qty > 0 then
			local line_total = qty * item.price
			total = total + line_total
			rows[#rows + 1] = {
				id = item.id,
				icon = item.icon,
				name = item.name,
				qty = qty,
				line_total = line_total,
			}
		end
	end

	return rows, total
end

local function view_data(wallet, mood, receipt_rows)
	local mood_state = derive_mood(wallet.balance, mood.pokes)
	local receipt_items, total = compute_receipt(receipt_rows)

	return {
		doctype = "<!DOCTYPE html>",
		title = "Fuwa Gomen",
		items = ITEMS,
		balance = wallet.balance,
		spent = wallet.spent,
		pokes = mood.pokes,
		total = total,
		total_text = "-¥" .. tostring(total),
		bar_percent = math.max(0, math.min(100, wallet.balance / 10)),
		bar_is_low = wallet.balance < 300,
		mood_key = mood_state.key,
		face = mood_state.face,
		mood_jp = mood_state.jp,
		mood_en = mood_state.en,
		papa_visible = wallet.balance <= 0,
		receipt_rows = receipt_items,
	}
end

function M.page()
	return view_data(ensure_wallet(), ensure_mood(), load_receipt())
end

function M.poke()
	local mood = ensure_mood()
	Mood.update(mood.id, {
		key = "main",
		pokes = mood.pokes + 1,
	})
	return M.page()
end

function M.cooldown()
	local mood = ensure_mood()
	if mood.pokes > 0 then
		Mood.update(mood.id, {
			key = "main",
			pokes = mood.pokes - 1,
		})
	end
	return M.page()
end

function M.buy(item_id)
	local item = ITEM_BY_ID[item_id]
	if item == nil then
		return M.page()
	end

	local wallet = ensure_wallet()
	if wallet.balance < item.price then
		return M.page()
	end

	Wallet.update(wallet.id, {
		key = "main",
		balance = wallet.balance - item.price,
		spent = wallet.spent + item.price,
	})
	Ledger.create({
		item = item.id,
		price = item.price,
	})
	return M.page()
end

function M.calm()
	local mood = ensure_mood()
	Mood.update(mood.id, {
		key = "main",
		pokes = 0,
	})
	return M.page()
end

function M.reset()
	local wallet = ensure_wallet()
	Wallet.update(wallet.id, {
		key = "main",
		balance = 1000,
		spent = 0,
	})

	local mood = ensure_mood()
	Mood.update(mood.id, {
		key = "main",
		pokes = 0,
	})

	for _, row in ipairs(load_receipt()) do
		Ledger.delete(row.id)
	end

	return M.page()
end

return M
