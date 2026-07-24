package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local util = require("runtime.util")

local results = { passed = 0, failed = 0, failures = {} }

local function test(name, fn)
  local ok, err = pcall(fn)
  if ok then results.passed = results.passed + 1
  else results.failed = results.failed + 1; results.failures[#results.failures + 1] = name .. "\n  " .. tostring(err)
  end
end

local function eq(actual, expected, label)
  if actual ~= expected then
    error(string.format("%s: expected %q, got %q", label or "eq", tostring(expected), tostring(actual)), 2)
  end
end
local function truthy(v, l) if not v then error(l or "expected truthy", 2) end end
local function falsy(v, l) if v then error(l or "expected falsy", 2) end end

--------------------------------------------------------------------------------
-- dirname
--------------------------------------------------------------------------------
test("dirname: path with directory", function()
  eq(util.dirname("a/b/c"), "a/b")
  eq(util.dirname("/a/b/c"), "/a/b")
  eq(util.dirname("a/b/"), "a/b")
end)
test("dirname: single component", function()
  eq(util.dirname("a"), ".")
  eq(util.dirname("/a"), "")
end)
test("dirname: nil/empty", function()
  eq(util.dirname(nil), ".")
  eq(util.dirname(""), ".")
end)

--------------------------------------------------------------------------------
-- file_exists
--------------------------------------------------------------------------------
test("file_exists: existing file", function()
  truthy(util.file_exists("runtime/util.lua"))
end)
test("file_exists: nonexistent file", function()
  falsy(util.file_exists("runtime/nonexistent_xyz.lua"))
end)

--------------------------------------------------------------------------------
-- read_all / write_all / ensure_path
--------------------------------------------------------------------------------
test("read_all: reads file contents", function()
  local contents = util.read_all("runtime/util.lua")
  truthy(contents, "should read file")
  truthy(#contents > 0, "should have content")
  truthy(contents:find("Shared utility functions"), "should contain header")
end)
test("read_all: nonexistent returns nil", function()
  eq(util.read_all("nonexistent_abc.lua"), nil)
end)
test("write_all: creates file", function()
  local path = "/tmp/fuwa_test_write_all.txt"
  util.write_all(path, "hello world")
  eq(util.read_all(path), "hello world")
  os.remove(path)
end)
test("ensure_path: creates if missing", function()
  local path = "/tmp/fuwa_test_ensure.txt"
  os.remove(path) -- ensure clean
  util.ensure_path(path)
  truthy(util.file_exists(path))
  eq(util.read_all(path), "")
  os.remove(path)
end)
test("ensure_path: does not overwrite", function()
  local path = "/tmp/fuwa_test_ensure2.txt"
  util.write_all(path, "keep me")
  util.ensure_path(path, "do not write")
  eq(util.read_all(path), "keep me")
  os.remove(path)
end)

--------------------------------------------------------------------------------
-- shell_quote
--------------------------------------------------------------------------------
test("shell_quote: plain string", function()
  eq(util.shell_quote("hello"), "'hello'")
end)
test("shell_quote: string with single quote", function()
  local result = util.shell_quote("it's")
  truthy(result:find("'"), "should contain quotes")
  truthy(result:find("it"), "should contain the word")
end)
test("shell_quote: number input", function()
  eq(util.shell_quote(42), "'42'")
end)

--------------------------------------------------------------------------------
-- deep_copy
--------------------------------------------------------------------------------
test("deep_copy: primitives pass through", function()
  eq(util.deep_copy(42), 42)
  eq(util.deep_copy("hello"), "hello")
  eq(util.deep_copy(true), true)
  eq(util.deep_copy(nil), nil)
end)
test("deep_copy: shallow table copy", function()
  local original = { a = 1, b = "x" }
  local copy = util.deep_copy(original)
  eq(copy.a, 1)
  eq(copy.b, "x")
  copy.a = 99
  eq(original.a, 1, "original should be unchanged")
end)
test("deep_copy: nested tables", function()
  local original = { x = { y = { z = 42 } } }
  local copy = util.deep_copy(original)
  eq(copy.x.y.z, 42)
  copy.x.y.z = 99
  eq(original.x.y.z, 42, "nested original should be unchanged")
end)
test("deep_copy: array-like tables", function()
  local original = { 10, 20, 30 }
  local copy = util.deep_copy(original)
  eq(copy[1], 10)
  eq(copy[2], 20)
  eq(copy[3], 30)
  copy[1] = 99
  eq(original[1], 10)
end)

--------------------------------------------------------------------------------
-- is_array
--------------------------------------------------------------------------------
test("is_array: empty table is array", function()
  local ok, count = util.is_array({})
  truthy(ok)
  eq(count, 0)
end)
test("is_array: integer-keyed table", function()
  local ok, count = util.is_array({ "a", "b", "c" })
  truthy(ok)
  eq(count, 3)
end)
test("is_array: non-integer keys", function()
  falsy(util.is_array({ a = 1, b = 2 }))
end)
test("is_array: mixed keys", function()
  falsy(util.is_array({ [1] = "a", b = "x" }))
end)
test("is_array: sparse array", function()
  falsy(util.is_array({ [1] = "a", [3] = "c" }))
end)
test("is_array: zero-indexed", function()
  falsy(util.is_array({ [0] = "a", [1] = "b" }))
end)
test("is_array: non-table input", function()
  falsy(util.is_array("hello"))
  falsy(util.is_array(42))
  falsy(util.is_array(nil))
end)

--------------------------------------------------------------------------------
-- escape_html
--------------------------------------------------------------------------------
test("escape_html: plain text passes through", function()
  eq(util.escape_html("hello"), "hello")
end)
test("escape_html: escapes special chars", function()
  eq(util.escape_html("<div class=\"x\">"), "&lt;div class=&quot;x&quot;&gt;")
end)
test("escape_html: ampersand", function()
  eq(util.escape_html("a & b"), "a &amp; b")
end)
test("escape_html: single quote", function()
  truthy(util.escape_html("'") == "&#39;")
end)
test("escape_html: nil input", function()
  eq(util.escape_html(nil), "")
end)

--------------------------------------------------------------------------------
-- validate_payload_id
--------------------------------------------------------------------------------
test("validate_payload_id: valid ids", function()
  eq(util.validate_payload_id("my-app"), "my-app")
  eq(util.validate_payload_id("hello_world"), "hello_world")
  eq(util.validate_payload_id("abc123"), "abc123")
end)
test("validate_payload_id: invalid ids", function()
  eq(util.validate_payload_id("my app"), nil)
  eq(util.validate_payload_id("../etc"), nil)
  eq(util.validate_payload_id(""), nil)
end)
test("validate_payload_id: non-string input", function()
  eq(util.validate_payload_id(42), nil)
  eq(util.validate_payload_id(nil), nil)
end)

--------------------------------------------------------------------------------
-- humanize_payload_id
--------------------------------------------------------------------------------
test("humanize_payload_id: hyphenated", function()
  eq(util.humanize_payload_id("my-app"), "My app")
end)
test("humanize_payload_id: underscored", function()
  eq(util.humanize_payload_id("hello_world"), "Hello world")
end)
test("humanize_payload_id: nil defaults to current", function()
  eq(util.humanize_payload_id(nil), "Current")
end)
test("humanize_payload_id: already capitalized", function()
  eq(util.humanize_payload_id("Already-Done"), "Already Done")
end)

--------------------------------------------------------------------------------
-- encode_json
--------------------------------------------------------------------------------
test("encode_json: nil -> null", function()
  eq(util.encode_json(nil), "null")
end)
test("encode_json: booleans", function()
  eq(util.encode_json(true), "true")
  eq(util.encode_json(false), "false")
end)
test("encode_json: numbers", function()
  eq(util.encode_json(42), "42")
  eq(util.encode_json(3.14), "3.14")
  eq(util.encode_json(0), "0")
  eq(util.encode_json(-1), "-1")
end)
test("encode_json: plain string", function()
  eq(util.encode_json("hello"), '"hello"')
end)
test("encode_json: string with escapes", function()
  eq(util.encode_json('say "hello"'), '"say \\"hello\\""')
  eq(util.encode_json("line1\nline2"), '"line1\\nline2"')
  eq(util.encode_json("tab\there"), '"tab\\there"')
  eq(util.encode_json("back\\slash"), '"back\\\\slash"')
end)
test("encode_json: empty array", function()
  eq(util.encode_json({}), "[]")
end)
test("encode_json: array with values", function()
  eq(util.encode_json({1, "two", true}), '[1,"two",true]')
end)
test("encode_json: empty object", function()
  eq(util.encode_json({a = 1}), '{"a":1}')
end)
test("encode_json: nested structure", function()
  local result = util.encode_json({name = "test", items = {1, 2}})
  truthy(result:find('"name":"test"', 1, true))
  truthy(result:find('"items":[1,2]', 1, true))
end)

--------------------------------------------------------------------------------
-- Report
--------------------------------------------------------------------------------
if results.failed > 0 then
  io.stderr:write(table.concat(results.failures, "\n\n"), "\n")
  os.exit(1)
end
print(string.format("util tests passed (%d tests)", results.passed))
