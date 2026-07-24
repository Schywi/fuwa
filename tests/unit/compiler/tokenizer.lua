package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local tokenizer = require("runtime.stdlib.compiler.tokenizer")
local Stream = require("runtime.stdlib.compiler.stream")
local Emit = require("runtime.stdlib.compiler.emit")

local results = {
  passed = 0,
  failed = 0,
  failures = {},
}

local function pass()
  results.passed = results.passed + 1
end

local function fail(name, err)
  results.failed = results.failed + 1
  results.failures[#results.failures + 1] = string.format("%s\n  %s", name, tostring(err))
end

local function test(name, fn)
  local ok, err = pcall(fn)
  if ok then
    pass()
  else
    fail(name, err)
  end
end

local function eq(actual, expected, label)
  if actual ~= expected then
    error(string.format("%s expected %q, got %q", label or "eq", tostring(expected), tostring(actual)), 2)
  end
end

local function truthy(value, label)
  if not value then
    error(label or "expected truthy", 2)
  end
end

local function falsy(value, label)
  if value then
    error(label or "expected falsy", 2)
  end
end

-- Collect all non-newline tokens from a token array
local function non_newlines(tokens)
  local out = {}
  for _, t in ipairs(tokens) do
    if t.type ~= "newline" then
      out[#out + 1] = t
    end
  end
  return out
end

-- Count tokens of a given type
local function count_type(tokens, ttype)
  local c = 0
  for _, t in ipairs(tokens) do
    if t.type == ttype then c = c + 1 end
  end
  return c
end

--------------------------------------------------------------------------------
-- Tokenizer tests
--------------------------------------------------------------------------------

test("tokenize empty string", function()
  local tokens = tokenizer.tokenize("")
  eq(#tokens, 1)
  eq(tokens[1].type, "newline")
end)

test("tokenize only whitespace", function()
  local tokens = tokenizer.tokenize("   \t  ")
  eq(#tokens, 1)
  eq(tokens[1].type, "newline")
end)

test("tokenize only comment", function()
  local tokens = tokenizer.tokenize("-- this is a comment")
  eq(#tokens, 1)
  eq(tokens[1].type, "newline")
end)

test("tokenize keywords", function()
  local tokens = tokenizer.tokenize([[
module use import schema routes action do end]])
  local nn = non_newlines(tokens)
  local expected = { "module", "use", "import", "schema", "routes", "action", "do", "end" }
  eq(#nn, #expected)
  for i, word in ipairs(expected) do
    eq(nn[i].type, "keyword")
    eq(nn[i].value, word)
  end
end)

test("tokenize identifiers", function()
  local tokens = tokenizer.tokenize("foo bar_1 App Home home_page")
  local nn = non_newlines(tokens)
  eq(#nn, 5)
  eq(nn[1].value, "foo")
  eq(nn[2].value, "bar_1")
  eq(nn[3].value, "App")
  eq(nn[4].value, "Home")
  eq(nn[5].value, "home_page")
  for _, t in ipairs(nn) do
    eq(t.type, "identifier")
  end
end)

test("tokenize strings", function()
  local tokens = tokenizer.tokenize([["hello" "with spaces"]])
  local nn = non_newlines(tokens)
  eq(#nn, 2)
  eq(nn[1].type, "string")
  eq(nn[1].value, "hello")
  eq(nn[2].type, "string")
  eq(nn[2].value, "with spaces")
end)

test("tokenize string with escape sequences", function()
  local tokens = tokenizer.tokenize([["line1\nline2"]])
  local nn = non_newlines(tokens)
  eq(#nn, 1)
  eq(nn[1].type, "string")
  eq(nn[1].value, "line1\nline2")
end)

test("tokenize escaped quote in string", function()
  local tokens = tokenizer.tokenize([["say \"hello\"" "back\\slash"]])
  local nn = non_newlines(tokens)
  eq(#nn, 2)
  eq(nn[1].type, "string")
  eq(nn[1].value, 'say "hello"')
  eq(nn[2].type, "string")
  eq(nn[2].value, "back\\slash")
end)

test("tokenize numbers", function()
  local tokens = tokenizer.tokenize("0 42 3.14")
  local nn = non_newlines(tokens)
  eq(#nn, 3)
  eq(nn[1].type, "number")
  eq(nn[1].value, "0")
  eq(nn[2].type, "number")
  eq(nn[2].value, "42")
  eq(nn[3].type, "number")
  eq(nn[3].value, "3.14")
end)

test("tokenize symbols", function()
  local tokens = tokenizer.tokenize(": ( ) { } , . ? = + - * /")
  local nn = non_newlines(tokens)
  local syms = { ":", "(", ")", "{", "}", ",", ".", "?", "=", "+", "-", "*", "/" }
  eq(#nn, #syms)
  for i, s in ipairs(syms) do
    eq(nn[i].type, "symbol", "symbol " .. s)
    eq(nn[i].value, s, "symbol value " .. s)
  end
end)

test("tokenize multi-char symbols", function()
  local tokens = tokenizer.tokenize("-> == != <= >=")
  local nn = non_newlines(tokens)
  eq(#nn, 5, "should have 5 multi-char symbols")
  eq(nn[1].value, "->")
  eq(nn[2].value, "==")
  eq(nn[3].value, "!=")
  eq(nn[4].value, "<=")
  eq(nn[5].value, ">=")
  for _, t in ipairs(nn) do
    eq(t.type, "symbol")
  end
end)

test("tokenize -> not split into - and >", function()
  local tokens = tokenizer.tokenize("a -> b")
  local nn = non_newlines(tokens)
  eq(#nn, 3)
  eq(nn[1].value, "a")
  eq(nn[2].value, "->")
  eq(nn[3].value, "b")
end)

test("tokenize comments are skipped", function()
  local tokens = tokenizer.tokenize([[
module Foo -- module comment
  -- full line comment
  routes do
end]])
  for _, t in ipairs(tokens) do
    if t.type ~= "newline" then
      falsy(tostring(t.value):find("comment"), "comment leaked: " .. t.value)
    end
  end
end)

test("tokenize newlines are significant", function()
  local tokens = tokenizer.tokenize("a\nb\n\nc\n")
  local newline_count = count_type(tokens, "newline")
  eq(newline_count, 4, "newline count")
end)

test("tokenize line and column tracking", function()
  local tokens = tokenizer.tokenize("module Foo\n  field name :text")
  -- module (1:1)
  eq(tokens[1].line, 1)
  eq(tokens[1].col, 1)
  eq(tokens[1].value, "module")
  -- Foo (1:8) — space is skipped, so it's the next token
  eq(tokens[2].type, "identifier")
  eq(tokens[2].line, 1)
  eq(tokens[2].col, 8)
  eq(tokens[2].value, "Foo")
  -- newline at line 1
  eq(tokens[3].type, "newline")
  eq(tokens[3].line, 1)
  -- field (2:3) — two leading spaces
  eq(tokens[4].line, 2)
  eq(tokens[4].col, 3)
  eq(tokens[4].value, "field")
end)

test("tokenize trailing newline always present", function()
  local tokens = tokenizer.tokenize("module Foo")
  eq(tokens[#tokens].type, "newline")
  tokens = tokenizer.tokenize("module Foo\n")
  eq(tokens[#tokens].type, "newline")
end)

test("tokenize module declaration preserves spacing", function()
  local tokens = tokenizer.tokenize("module App\n")
  local nn = non_newlines(tokens)
  eq(#nn, 2)
  eq(nn[1].type, "keyword")
  eq(nn[1].value, "module")
  eq(nn[2].type, "identifier")
  eq(nn[2].value, "App")
end)

test("tokenize schema block header", function()
  local tokens = tokenizer.tokenize('schema "users" do')
  local nn = non_newlines(tokens)
  eq(#nn, 3)
  eq(nn[1].type, "keyword")
  eq(nn[1].value, "schema")
  eq(nn[2].type, "string")
  eq(nn[2].value, "users")
  eq(nn[3].type, "keyword")
  eq(nn[3].value, "do")
end)

test("tokenize field declaration", function()
  -- field flags (required, unique, redact, default) are identifiers,
  -- not keywords. They are parsed from rest_of_line after the type.
  local tokens = tokenizer.tokenize("  field name :text required unique")
  local nn = non_newlines(tokens)
  eq(nn[1].type, "keyword")
  eq(nn[1].value, "field")
  eq(nn[2].type, "identifier")
  eq(nn[2].value, "name")
  eq(nn[3].type, "symbol")
  eq(nn[3].value, ":")
  eq(nn[4].type, "identifier")
  eq(nn[4].value, "text")
  eq(nn[5].type, "identifier")
  eq(nn[5].value, "required")
  eq(nn[6].type, "identifier")
  eq(nn[6].value, "unique")
end)

test("tokenize routes block header", function()
  local tokens = tokenizer.tokenize("routes do")
  local nn = non_newlines(tokens)
  eq(#nn, 2)
  eq(nn[1].value, "routes")
  eq(nn[2].value, "do")
end)

test("tokenize route line", function()
  local tokens = tokenizer.tokenize('GET "/" Home.index')
  local nn = non_newlines(tokens)
  eq(nn[1].type, "identifier")
  eq(nn[1].value, "GET")
  eq(nn[2].type, "string")
  eq(nn[2].value, "/")
  eq(nn[3].type, "identifier")
  eq(nn[3].value, "Home")
  eq(nn[4].type, "symbol")
  eq(nn[4].value, ".")
  eq(nn[5].type, "identifier")
  eq(nn[5].value, "index")
end)

test("tokenize action declaration", function()
  local tokens = tokenizer.tokenize("action greet(name) do")
  local nn = non_newlines(tokens)
  eq(nn[1].type, "keyword")
  eq(nn[1].value, "action")
  eq(nn[2].type, "identifier")
  eq(nn[2].value, "greet")
  eq(nn[3].type, "symbol")
  eq(nn[3].value, "(")
  eq(nn[4].type, "identifier")
  eq(nn[4].value, "name")
  eq(nn[5].type, "symbol")
  eq(nn[5].value, ")")
  eq(nn[6].type, "keyword")
  eq(nn[6].value, "do")
end)

test("tokenize ? sugar in expression", function()
  local tokens = tokenizer.tokenize("user = db.users.find(id: 1)?")
  local nn = non_newlines(tokens)
  -- Should have ? as a token near the end
  local last = nn[#nn]
  eq(last.type, "symbol")
  eq(last.value, "?")
end)

test("tokenize if guard sugar", function()
  local tokens = tokenizer.tokenize('if w.balance < 50 -> redirect "/"')
  local nn = non_newlines(tokens)
  -- Should contain ->
  local has_arrow = false
  for _, t in ipairs(nn) do
    if t.value == "->" then has_arrow = true end
  end
  truthy(has_arrow, "should have -> symbol")
end)

test("tokenize import block", function()
  local tokens = tokenizer.tokenize([[
import
  Home "pages/home"
  Wallet "models/wallet"
end]])
  local nn = non_newlines(tokens)
  eq(nn[1].type, "keyword")
  eq(nn[1].value, "import")
  eq(nn[2].type, "identifier")
  eq(nn[2].value, "Home")
  eq(nn[3].type, "string")
  eq(nn[3].value, "pages/home")
  eq(nn[4].type, "identifier")
  eq(nn[4].value, "Wallet")
  eq(nn[5].type, "string")
  eq(nn[5].value, "models/wallet")
  eq(nn[6].type, "keyword")
  eq(nn[6].value, "end")
end)

test("tokenize real multiline schema", function()
  local tokens = tokenizer.tokenize([[
schema "users" do
  field name :text required unique
  field age :integer default 0
  timestamps
end]])
  local nn = non_newlines(tokens)
  eq(nn[1].value, "schema")
  eq(nn[2].value, "users")
  eq(nn[3].value, "do")
  eq(nn[4].value, "field")
  eq(nn[5].value, "name")
  eq(nn[6].value, ":")
  eq(nn[7].value, "text")
  eq(nn[8].value, "required")
  eq(nn[9].value, "unique")
  eq(nn[10].value, "field")
  eq(nn[11].value, "age")
  eq(nn[12].value, ":")
  eq(nn[13].value, "integer")
  eq(nn[14].value, "default")
  eq(nn[15].value, "0")
  eq(nn[16].value, "timestamps")
  eq(nn[17].value, "end")
end)

test("tokenize dump produces output", function()
  local tokens = tokenizer.tokenize("module App\n")
  local d = tokenizer.dump(tokens)
  truthy(d:find("keyword"), "dump should contain keyword")
  truthy(d:find("module"), "dump should contain module")
end)

--------------------------------------------------------------------------------
-- Stream tests
--------------------------------------------------------------------------------

test("stream peek and next", function()
  local s = Stream.new(tokenizer.tokenize("module App do"), "test.fuwa", {})
  eq(s:peek().type, "keyword")
  eq(s:peek().value, "module")
  eq(s:next().value, "module")
  eq(s:peek().type, "identifier")
  eq(s:peek().value, "App")
  eq(s:next().value, "App")
  eq(s:peek().type, "keyword")
  eq(s:peek().value, "do")
end)

test("stream is_done", function()
  local s = Stream.new(tokenizer.tokenize("x"), "test.fuwa", {})
  eq(s:is_done(), false)
  s:next() -- x
  eq(s:is_done(), false)
  s:next() -- trailing newline
  eq(s:is_done(), true)
end)

test("stream expect matches", function()
  local s = Stream.new(tokenizer.tokenize("module App do"), "test.fuwa", {})
  local t = s:expect("keyword", "module")
  eq(t.value, "module")
  t = s:expect("identifier")
  eq(t.value, "App")
  t = s:expect("keyword", "do")
  eq(t.value, "do")
end)

test("stream expect adds diagnostic on mismatch", function()
  local diag = {}
  local s = Stream.new(tokenizer.tokenize("foo"), "test.fuwa", diag)
  s:expect("keyword", "module")
  truthy(#diag > 0, "should have diagnostic")
end)

test("stream maybe matches", function()
  local s = Stream.new(tokenizer.tokenize("module App"), "test.fuwa", {})
  local t = s:maybe("keyword", "module")
  truthy(t, "should match keyword module")
  eq(t.value, "module")
  local t2 = s:maybe("keyword", "schema")
  falsy(t2, "should not match schema")
end)

test("stream skip_blank_lines", function()
  local s = Stream.new(tokenizer.tokenize("\n\n\nmodule App\n"), "test.fuwa", {})
  local skipped = s:skip_blank_lines()
  eq(skipped, 3, "should skip 3 blank lines")
  eq(s:peek().value, "module")
end)

test("stream rest_of_line", function()
  local s = Stream.new(tokenizer.tokenize("Home.index extra stuff\nend\n"), "test.fuwa", {})
  local rest = s:rest_of_line()
  eq(rest, "Home . index extra stuff")
  eq(s:peek().type, "keyword")
  eq(s:peek().value, "end")
end)

test("stream rest_of_line handles empty line", function()
  local s = Stream.new(tokenizer.tokenize("\nend\n"), "test.fuwa", {})
  local rest = s:rest_of_line()
  eq(rest, "")
  eq(s:peek().type, "keyword")
  eq(s:peek().value, "end")
end)

test("stream until_keyword", function()
  local s = Stream.new(tokenizer.tokenize('GET "/" Home.index\nend\n'), "test.fuwa", {})
  local parts = s:until_keyword({ ["end"] = true })
  truthy(parts, "should get tokens until end")
  -- GET, "/", Home, ., index (5 non-newline tokens)
  eq(#parts, 6, "GET, /, Home, ., index, newline = 6 tokens before end")
  eq(parts[1].value, "GET")
  eq(parts[2].value, "/")
  eq(s:peek().value, "end") -- not consumed
end)

test("stream cursor advances", function()
  local s = Stream.new(tokenizer.tokenize("a b c\n"), "test.fuwa", {})
  eq(s:cursor(), 1)
  s:next()
  eq(s:cursor(), 2)
  s:next()
  eq(s:cursor(), 3)
end)

test("stream peek_ahead", function()
  local s = Stream.new(tokenizer.tokenize("module App do\n"), "test.fuwa", {})
  eq(s:peek_ahead(0).value, "module")
  eq(s:peek_ahead(1).value, "App")
  eq(s:peek_ahead(2).value, "do")
  eq(s:peek_ahead(100), nil)
end)

test("stream line from tokens", function()
  local s = Stream.new(tokenizer.tokenize("module App\n"), "test.fuwa", {})
  eq(s:line(), 1)
  s:next() -- module
  eq(s:line(), 1)
  s:next() -- App
  eq(s:line(), 1)
end)

--------------------------------------------------------------------------------
-- Emit tests
--------------------------------------------------------------------------------

test("emit line without format args", function()
  local out = Emit.new()
  out:line("hello world")
  eq(out:build(), "hello world")
end)

test("emit line with format args", function()
  local out = Emit.new()
  out:line("local %s = require(%s)", "foo", '"bar"')
  eq(out:build(), 'local foo = require("bar")')
end)

test("emit blank lines", function()
  local out = Emit.new()
  out:line("first")
  out:blank()
  out:line("second")
  eq(out:build(), "first\n\nsecond")
end)

test("emit indent and dedent", function()
  local out = Emit.new("  ")
  out:line("function foo()")
  out:indent()
  out:line("return 42")
  out:dedent()
  out:line("end")
  eq(out:build(), [[function foo()
  return 42
end]])
end)

test("emit nested indent", function()
  local out = Emit.new("  ")
  out:line("if x then")
  out:indent()
  out:line("if y then")
  out:indent()
  out:line("return z")
  out:dedent()
  out:line("end")
  out:dedent()
  out:line("end")
  eq(out:build(), [[if x then
  if y then
    return z
  end
end]])
end)

test("emit dedent clamped to zero", function()
  local out = Emit.new()
  out:dedent()
  out:dedent()
  out:line("no indent")
  eq(out:build(), "no indent")
end)

test("emit raw text", function()
  local out = Emit.new()
  out:raw("  pre-formatted line")
  out:raw("  another line")
  eq(out:build(), "  pre-formatted line\n  another line")
end)

test("emit count", function()
  local out = Emit.new()
  eq(out:count(), 0)
  out:line("one")
  eq(out:count(), 1)
  out:line("two")
  out:blank()
  eq(out:count(), 3)
end)

test("emit custom indent string", function()
  local out = Emit.new("\t")
  out:line("function foo()")
  out:indent()
  out:line("return 42")
  out:dedent()
  out:line("end")
  eq(out:build(), "function foo()\n\treturn 42\nend")
end)

test("emit schema-like output", function()
  local out = Emit.new("  ")
  out:line("return schema.model(%q, %q, {", "users", "users")
  out:indent()
  out:line("schema.field(%q, %q, {}),", "name", "text")
  out:line("schema.field(%q, %q, { required = true }),", "age", "integer")
  out:line("schema.timestamps(),")
  out:dedent()
  out:line("})")
  local result = out:build()
  truthy(result:find("schema.model"), "should contain schema.model")
  truthy(result:find("schema.field"), "should contain schema.field")
  truthy(result:find("timestamps"), "should contain timestamps")
end)

--------------------------------------------------------------------------------
-- Integration: tokenizer -> stream -> structured parse
--------------------------------------------------------------------------------

test("integration: parse schema with token stream", function()
  local source = [[schema "users" do
  field name :text required
end]]
  local s = Stream.new(tokenizer.tokenize(source), "test.fuwa", {})

  s:skip_blank_lines()
  s:expect("keyword", "schema")
  local table_name = s:expect("string")
  s:expect("keyword", "do")
  eq(table_name.value, "users")

  local fields = {}
  while not s:is_done() do
    s:skip_blank_lines()
    local t = s:peek()
    if not t then break end
    if t.type == "keyword" and t.value == "end" then
      s:next()
      break
    elseif t.type == "keyword" and t.value == "field" then
      s:next()
      local fname = s:expect("identifier")
      s:expect("symbol", ":")
      local ftype = s:expect("identifier")
      local flags = s:rest_of_line()
      fields[#fields + 1] = { name = fname.value, type = ftype.value, flags = flags }
    else
      break
    end
  end

  eq(#fields, 1)
  eq(fields[1].name, "name")
  eq(fields[1].type, "text")
  truthy(fields[1].flags:find("required"), "flags should include required")
end)

test("integration: parse routes with token stream", function()
  local source = [[routes do
  GET "/" Home.index
  POST "/items" Items.create
end]]
  local s = Stream.new(tokenizer.tokenize(source), "test.fuwa", {})

  s:skip_blank_lines()
  s:expect("keyword", "routes")
  s:expect("keyword", "do")

  local routes = {}
  while not s:is_done() do
    s:skip_blank_lines()
    local t = s:peek()
    if not t then break end
    if t.type == "keyword" and t.value == "end" then
      s:next()
      break
    end
    local method = s:expect("identifier")
    local path = s:expect("string")
    local handler = s:rest_of_line()
    routes[#routes + 1] = { method = method.value, path = path.value, handler = handler }
  end

  eq(#routes, 2)
  eq(routes[1].method, "GET")
  eq(routes[1].path, "/")
  eq(routes[2].method, "POST")
  eq(routes[2].path, "/items")
end)

test("integration: parse action with sugar", function()
  local source = [[action greet(name) do
  user = db.users.find(id: 1)?
  render "home", title: "Hello"
end]]
  local s = Stream.new(tokenizer.tokenize(source), "test.fuwa", {})

  s:skip_blank_lines()
  s:expect("keyword", "action")
  local action_name = s:expect("identifier")
  s:expect("symbol", "(")
  local action_arg = s:expect("identifier")
  s:expect("symbol", ")")
  s:expect("keyword", "do")

  eq(action_name.value, "greet")
  eq(action_arg.value, "name")

  local body = {}
  while not s:is_done() do
    s:skip_blank_lines()
    local t = s:peek()
    if not t then break end
    if t.type == "keyword" and t.value == "end" then
      s:next()
      break
    end
    body[#body + 1] = s:rest_of_line()
  end

  eq(#body, 2)
  truthy(body[1]:find("?"), "should contain ? sugar")
  truthy(body[2]:find("render"), "should contain render")
end)

test("integration: parse import block", function()
  local source = [[import
  Home "pages/home"
  Wallet "models/wallet"
end]]
  local s = Stream.new(tokenizer.tokenize(source), "test.fuwa", {})

  s:skip_blank_lines()
  s:expect("keyword", "import")

  local imports = {}
  while not s:is_done() do
    s:skip_blank_lines()
    local t = s:peek()
    if not t then break end
    if t.type == "keyword" and t.value == "end" then
      s:next()
      break
    end
    local alias = s:expect("identifier")
    local path = s:expect("string")
    imports[#imports + 1] = { alias = alias.value, path = path.value }
  end

  eq(#imports, 2)
  eq(imports[1].alias, "Home")
  eq(imports[1].path, "pages/home")
  eq(imports[2].alias, "Wallet")
  eq(imports[2].path, "models/wallet")
end)

--------------------------------------------------------------------------------
-- Report
--------------------------------------------------------------------------------

if results.failed > 0 then
  io.stderr:write(table.concat(results.failures, "\n\n"), "\n")
  os.exit(1)
end

print(string.format("compiler library tests passed (%d tests)", results.passed))
