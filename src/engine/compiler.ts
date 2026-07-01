import type { RuntimeDefinition, RuntimeFiles } from './types';

export type BuildLevel = 'error' | 'warning';

export type BuildDiagnostic = {
	level: BuildLevel;
	file: string;
	message: string;
	line?: number;
	snippet?: string;
};

export type BuildManifest = {
	runtimeId: string;
	sourceFiles: string[];
	generatedFiles: string[];
	kind: 'passthrough' | 'fuwa';
};

export type BuildResult = {
	runFiles: RuntimeFiles;
	diagnostics: BuildDiagnostic[];
	manifest: BuildManifest;
};

type ImportDecl = {
	alias: string;
	path: string;
};

type SchemaField = {
	name: string;
	type: string;
	flags: {
		required?: boolean;
		unique?: boolean;
		redact?: boolean;
		default?: string | number | boolean;
	};
};

type SchemaChange = {
	name: string;
	accept: string[];
	require: string[];
};

type SchemaState = {
	name: string;
	tableName: string;
	fields: SchemaField[];
	changes: SchemaChange[];
	hasTimestamps: boolean;
};

type MatchEntry = {
	match: true;
	expr: string;
	whenClauses: Array<{ value: string; expr: string }>;
	elseExpr: string | null;
};

type ActionBodyEntry = {
	line: string;
	lineNumber: number;
	actionName: string;
	match?: MatchEntry;
};

type CompileContext = {
	filename: string;
	lines: string[];
	out: string[];
	errors: BuildDiagnostic[];
	imports: ImportDecl[];
	importsFlushed: boolean;
	actionBootstrapEmitted: boolean;
	hasActions: boolean;
	moduleName: string | null;
	mode: 'schema' | 'routes' | 'action' | null;
};

const RESERVED_WORDS = new Set([
	'and',
	'break',
	'do',
	'else',
	'elseif',
	'end',
	'false',
	'for',
	'function',
	'goto',
	'if',
	'in',
	'local',
	'nil',
	'not',
	'or',
	'repeat',
	'return',
	'then',
	'true',
	'until',
	'while'
]);

function trim(value: string | undefined | null): string {
	return String(value ?? '').trim();
}

function splitLines(source: string): string[] {
	return String(source ?? '')
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.split('\n');
}

function starts(value: string, prefix: string): boolean {
	return value.startsWith(prefix);
}

function quoteLuaString(value: string): string {
	return `"${String(value)
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\r/g, '\\r')
		.replace(/\n/g, '\\n')
		.replace(/\t/g, '\\t')
		.replace(/\f/g, '\\f')
		.replace(/\u0008/g, '\\b')}"`;
}

function emit(out: string[], line: string): void {
	out.push(line);
}

function emitBlank(out: string[]): void {
	out.push('');
}

function addDiagnostic(ctx: CompileContext, lineIndex: number, message: string): void {
	const lineNumber = lineIndex + 1;
	ctx.errors.push({
		level: 'error',
		file: ctx.filename,
		line: lineNumber,
		message,
		snippet: ctx.lines[lineIndex] ?? ''
	});
}

function parseImportBlock(lines: string[], index: number, ctx: CompileContext): number {
	for (let i = index; i < lines.length; i += 1) {
		const line = trim(lines[i]);
		if (line === '' || starts(line, '--')) {
			continue;
		}
		if (line === 'end') {
			return i + 1;
		}

		const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+"([^"]+)"$/);
		if (match) {
			ctx.imports.push({ alias: match[1], path: match[2] });
		} else {
			addDiagnostic(ctx, i, 'Expected: Alias "path/to/module"');
		}
	}

	addDiagnostic(ctx, lines.length - 1, 'Unexpected EOF while parsing import block');
	return lines.length;
}

function emitImports(ctx: CompileContext): void {
	if (ctx.importsFlushed) return;

	for (const imp of ctx.imports) {
		emit(ctx.out, `local ${imp.alias} = require(${quoteLuaString(imp.path.replace(/\//g, '.'))})`);
	}

	if (ctx.imports.length > 0) {
		emitBlank(ctx.out);
	}

	ctx.importsFlushed = true;
}

function parseDefaultValue(raw: string): string | number | boolean {
	const token = trim(raw);
	if (/^-?\d+(\.\d+)?$/.test(token)) {
		return Number(token);
	}
	if (token === 'true') return true;
	if (token === 'false') return false;

	const quoted = token.match(/^"(.*)"$/) ?? token.match(/^'(.*)'$/);
	if (quoted) return quoted[1];

	return token;
}

function formatDefaultValue(value: string | number | boolean): string {
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	return quoteLuaString(value);
}

function parseFieldFlags(rest: string): SchemaField['flags'] {
	const flags: SchemaField['flags'] = {};
	if (rest.includes('required')) flags.required = true;
	if (rest.includes('unique')) flags.unique = true;
	if (rest.includes('redact')) flags.redact = true;

	const defaultMatch = rest.match(/default\s+(.+)$/);
	if (defaultMatch) {
		flags.default = parseDefaultValue(defaultMatch[1]);
	}

	return flags;
}

function parseListValues(raw: string): string[] {
	return raw
		.split(',')
		.map((part) => trim(part))
		.filter((part) => part !== '');
}

function emitSchema(ctx: CompileContext, schema: SchemaState): void {
	emitImports(ctx);
	emit(ctx.out, 'local schema = require("fuwa.runtime.schema")');
	emitBlank(ctx.out);
	emit(
		ctx.out,
		`return schema.model(${quoteLuaString(schema.name)}, ${quoteLuaString(schema.tableName)}, {`
	);

	for (const field of schema.fields) {
		const flags: string[] = [];
		if (field.flags.required) flags.push('required = true');
		if (field.flags.unique) flags.push('unique = true');
		if (field.flags.redact) flags.push('redact = true');
		if (field.flags.default !== undefined) {
			flags.push(`default = ${formatDefaultValue(field.flags.default)}`);
		}

		emit(
			ctx.out,
			`  schema.field(${quoteLuaString(field.name)}, ${quoteLuaString(field.type)}, ${
				flags.length > 0 ? `{ ${flags.join(', ')} }` : '{}'
			}),`
		);
	}

	for (const change of schema.changes) {
		emit(ctx.out, `  schema.change(${quoteLuaString(change.name)}, {`);
		emit(ctx.out, `    accept = { ${change.accept.map(quoteLuaString).join(', ')} },`);
		emit(ctx.out, `    require = { ${change.require.map(quoteLuaString).join(', ')} },`);
		emit(ctx.out, '  }),');
	}

	if (schema.hasTimestamps) {
		emit(ctx.out, '  schema.timestamps(),');
	}

	emit(ctx.out, '})');
}

function parseChangeBlock(lines: string[], index: number, ctx: CompileContext, changeName: string): { nextIndex: number; change: SchemaChange | null } {
	const accept: string[] = [];
	const require: string[] = [];

	for (let i = index; i < lines.length; i += 1) {
		const line = trim(lines[i]);
		if (line === '' || starts(line, '--')) {
			continue;
		}
		if (line === 'end') {
			return {
				nextIndex: i + 1,
				change: {
					name: changeName,
					accept,
					require
				}
			};
		}

		const acceptMatch = line.match(/^accept\s+(.+)$/);
		if (acceptMatch) {
			accept.push(...parseListValues(acceptMatch[1]));
			continue;
		}

		const requireMatch = line.match(/^require\s+(.+)$/);
		if (requireMatch) {
			require.push(...parseListValues(requireMatch[1]));
			continue;
		}

		addDiagnostic(ctx, i, 'Expected: accept FIELDS or require FIELDS');
	}

	addDiagnostic(ctx, lines.length - 1, 'Unexpected EOF while parsing change block');
	return { nextIndex: lines.length, change: null };
}

function compileSchemaBlock(lines: string[], index: number, ctx: CompileContext, tableName: string): number {
	ctx.mode = 'schema';
	const schema: SchemaState = {
		name: ctx.moduleName ?? tableName,
		tableName,
		fields: [],
		changes: [],
		hasTimestamps: false
	};

	for (let i = index; i < lines.length; i += 1) {
		const line = trim(lines[i]);
		if (line === '' || starts(line, '--')) {
			continue;
		}
		if (line === 'end') {
			emitSchema(ctx, schema);
			return i + 1;
		}
		if (line === 'timestamps') {
			schema.hasTimestamps = true;
			continue;
		}

		const changeMatch = line.match(/^change\s+([A-Za-z_][A-Za-z0-9_]*)\s+do$/);
		if (changeMatch) {
			const parsed = parseChangeBlock(lines, i + 1, ctx, changeMatch[1]);
			if (parsed.change) {
				schema.changes.push(parsed.change);
			}
			i = parsed.nextIndex - 1;
			continue;
		}

		const fieldMatch = line.match(/^field\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)(.*)$/);
		if (fieldMatch) {
			schema.fields.push({
				name: fieldMatch[1],
				type: fieldMatch[2],
				flags: parseFieldFlags(trim(fieldMatch[3]))
			});
			continue;
		}

		addDiagnostic(ctx, i, 'Expected: field name: type [required] [unique] [redact] [default VALUE]');
	}

	addDiagnostic(ctx, lines.length - 1, 'Unexpected EOF while parsing schema block');
	return lines.length;
}

function parseRender(line: string): string | null {
	const match = line.match(/^render\s+"([^"]+)"(.*)$/);
	if (!match) return null;

	const view = match[1];
	const rest = trim(match[2]).replace(/^,\s*/, '');
	if (rest === '') {
		return `render(${quoteLuaString(view)}, {})`;
	}

	const parts = parseKeyValueArgs(rest);
	if (!parts) return null;

	return `render(${quoteLuaString(view)}, ${parts})`;
}

function parseRedirect(line: string): string | null {
	const match = line.match(/^redirect\s+(.+)$/);
	if (!match) return null;
	return `redirect(${interpolateLuaExpression(trim(match[1]))})`;
}

function parseFail(line: string): string | null {
	const body = trim(line);
	if (body === '') return null;

	const tail = trim((body.match(/^fail\s+(.+)$/) ?? [null, body])[1] ?? '');
	if (tail === '') return null;

	const atomMatch = tail.match(/^:([A-Za-z_][A-Za-z0-9_]*)(.*)$/);
	if (atomMatch) {
		const rest = trim(atomMatch[2]).replace(/^,\s*/, '');
		if (rest === '') {
			return `fail(${quoteLuaString(atomMatch[1])})`;
		}
		const args = parseKeyValueArgs(rest);
		return args ? `fail(${quoteLuaString(atomMatch[1])}, ${args})` : null;
	}

	const exprMatch = tail.match(/^([^,]+)(.*)$/);
	if (!exprMatch) return null;
	const expr = trim(exprMatch[1]);
	const rest = trim(exprMatch[2]).replace(/^,\s*/, '');
	if (rest === '') {
		return `fail(${expr})`;
	}
	const args = parseKeyValueArgs(rest);
	return args ? `fail(${expr}, ${args})` : null;
}

function applyResponseExpr(expr: string): string {
	if (expr.startsWith('render ')) return parseRender(expr) ?? expr;
	if (expr.startsWith('redirect ')) return parseRedirect(expr) ?? expr;
	if (expr.startsWith('fail ')) return parseFail(expr) ?? expr;
	return expr;
}

function parseKeyValueArgs(raw: string): string | null {
	const trimmed = trim(raw);
	if (trimmed === '') return null;

	const pieces = trimmed.split(',');
	const out: string[] = [];

	for (const piece of pieces) {
		const part = trim(piece);
		if (part === '') continue;
		const match = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
		if (!match) return null;
		out.push(`${match[1]} = ${trim(match[2])}`);
	}

	return out.length > 0 ? `{ ${out.join(', ')} }` : null;
}

function interpolateLuaExpression(raw: string): string {
	const value = trim(raw);
	if (!value.includes('#{')) {
		return value;
	}

	const open = value.slice(0, 1);
	if ((open !== '"' && open !== "'") || value.slice(-1) !== open) {
		return value;
	}

	const inner = value.slice(1, -1);
	const parts: string[] = [];
	let cursor = 0;

	while (cursor < inner.length) {
		const start = inner.indexOf('#{', cursor);
		if (start === -1) {
			const tail = inner.slice(cursor);
			if (tail !== '') {
				parts.push(quoteLuaString(tail));
			}
			break;
		}

		if (start > cursor) {
			parts.push(quoteLuaString(inner.slice(cursor, start)));
		}

		const end = inner.indexOf('}', start + 2);
		if (end === -1) {
			parts.push(quoteLuaString(inner.slice(start)));
			break;
		}

		const expr = trim(inner.slice(start + 2, end));
		parts.push(`tostring(${expr})`);
		cursor = end + 1;
	}

	return parts.length > 0 ? parts.join(' .. ') : value;
}

function parseMatchBlock(lines: string[], index: number, ctx: CompileContext, expr: string): { nextIndex: number; entry: MatchEntry | null } {
	const whenClauses: Array<{ value: string; expr: string }> = [];
	let elseExpr: string | null = null;

	for (let i = index; i < lines.length; i += 1) {
		const line = trim(lines[i]);
		if (line === '' || starts(line, '--')) {
			continue;
		}
		if (line === 'end') {
			return {
				nextIndex: i + 1,
				entry: {
					match: true,
					expr,
					whenClauses,
					elseExpr
				}
			};
		}

		const whenMatch = line.match(/^when\s+(.+)\s*->\s*(.+)$/);
		if (whenMatch) {
			whenClauses.push({
				value: trim(whenMatch[1]),
				expr: trim(whenMatch[2])
			});
			continue;
		}

		const elseMatch = line.match(/^else\s*->\s*(.+)$/);
		if (elseMatch) {
			elseExpr = trim(elseMatch[1]);
			continue;
		}

		addDiagnostic(ctx, i, 'Expected: when VALUE -> EXPR or else -> EXPR');
	}

	addDiagnostic(ctx, lines.length - 1, 'Unexpected EOF while parsing match block');
	return { nextIndex: lines.length, entry: null };
}

function emitActionBodyEntry(out: string[], entry: ActionBodyEntry): void {
	if (entry.match) {
		const parts: string[] = [];
		entry.match.whenClauses.forEach((whenClause, index) => {
			const keyword = index === 0 ? 'if' : 'elseif';
			parts.push(`${keyword} ${entry.match!.expr} == ${whenClause.value} then`);
			parts.push(`  return ${applyResponseExpr(whenClause.expr)}`);
		});
		if (entry.match.elseExpr) {
			parts.push('else');
			parts.push(`  return ${applyResponseExpr(entry.match.elseExpr)}`);
		}
		parts.push('end');
		for (const part of parts) {
			emit(out, `  ${part}`);
		}
		return;
	}

	const transformed = applySugar(entry.line, entry.actionName);
	for (const part of transformed.split('\n')) {
		emit(out, `  ${part}`);
	}
}

function compileActionBlock(lines: string[], index: number, ctx: CompileContext, actionName: string, actionArg: string): number {
	ctx.mode = 'action';
	ctx.hasActions = true;
	actionBootstrap(ctx);

	const body: ActionBodyEntry[] = [];

	for (let i = index; i < lines.length; i += 1) {
		const line = trim(lines[i]);
		if (line === '' || starts(line, '--')) {
			continue;
		}
		if (line === 'end') {
			emit(ctx.out, `function M.${actionName}(${actionArg})`);
			for (const entry of body) {
				emitActionBodyEntry(ctx.out, entry);
			}
			emit(ctx.out, 'end');
			emitBlank(ctx.out);
			return i + 1;
		}

		const matchBlock = line.match(/^match\s+(.+)\s+do$/);
		if (matchBlock) {
			const parsed = parseMatchBlock(lines, i + 1, ctx, trim(matchBlock[1]));
			if (parsed.entry) {
				body.push({ line, lineNumber: i + 1, actionName, match: parsed.entry });
			}
			i = parsed.nextIndex - 1;
			continue;
		}

		body.push({
			line,
			lineNumber: i + 1,
			actionName
		});
	}

	addDiagnostic(ctx, lines.length - 1, 'Unexpected EOF while parsing action block');
	return lines.length;
}

function actionBootstrap(ctx: CompileContext): void {
	if (ctx.actionBootstrapEmitted) return;

	emitImports(ctx);
	emit(ctx.out, 'local web = require("fuwa.runtime.web")');
	emit(ctx.out, 'local render = web.render');
	emit(ctx.out, 'local redirect = web.redirect');
	emit(ctx.out, 'local fail = web.fail');
	emitBlank(ctx.out);
	emit(ctx.out, 'local M = {}');
	emitBlank(ctx.out);
	ctx.actionBootstrapEmitted = true;
}

function applySugar(line: string, actionName: string): string {
	const trimmed = trim(line);

	const guardMatch = trimmed.match(/^if\s+(.+?)\s*->\s*(.+)$/);
	if (guardMatch) {
		return `if ${guardMatch[1]} then\n  return ${applyResponseExpr(guardMatch[2])}\nend`;
	}

	const questionMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*\?$/);
	if (questionMatch && !RESERVED_WORDS.has(questionMatch[1])) {
		const expr = trim(questionMatch[2]);
		const slot = `__r_${questionMatch[1]}`;
		const lines = [
			`local ${slot} = ${expr}`,
			`local ${questionMatch[1]}`,
			`if ${slot} == nil then`,
			'  return fail({ kind = "not_found", message = "not found" }, {',
			`    action = ${quoteLuaString(actionName)},`,
			'    line = 0,',
			`    expr = ${quoteLuaString(expr)}`,
			'  })',
			'end',
			`if (type(${slot}) == "table" or type(${slot}) == "userdata") and ${slot}.ok ~= nil then`,
			`  if not ${slot}.ok then`,
			'    return fail(__ERROR__, {',
			`      action = ${quoteLuaString(actionName)},`,
			'      line = 0,',
			`      expr = ${quoteLuaString(expr)}`,
			'    })',
			'  end',
			`  ${questionMatch[1]} = ${slot}.value`,
			'else',
			`  ${questionMatch[1]} = ${slot}`,
			'end'
		];

		return lines.join('\n').replace(/__ERROR__/g, `${slot}.err`);
	}

	if (trimmed.startsWith('render ')) {
		const rendered = parseRender(trimmed);
		if (rendered) return `return ${rendered}`;
	}

	if (trimmed.startsWith('redirect ')) {
		const redirected = parseRedirect(trimmed);
		if (redirected) return `return ${redirected}`;
	}

	const plainAssignment = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
	if (plainAssignment && !RESERVED_WORDS.has(plainAssignment[1])) {
		return `local ${plainAssignment[1]} = ${plainAssignment[2]}`;
	}

	return trimmed;
}

function compileFuwaModule(source: string, filename: string): BuildResult | null {
	const lines = splitLines(source);
	const ctx: CompileContext = {
		filename,
		lines,
		out: [],
		errors: [],
		imports: [],
		importsFlushed: false,
		actionBootstrapEmitted: false,
		hasActions: false,
		moduleName: null,
		mode: null
	};

	for (let i = 0; i < lines.length; i += 1) {
		const line = trim(lines[i]);
		if (line === '' || starts(line, '--')) {
			continue;
		}

		const moduleMatch = line.match(/^module\s+([A-Za-z_][A-Za-z0-9_]*)$/);
		if (moduleMatch) {
			ctx.moduleName = moduleMatch[1];
			continue;
		}

		const useMatch = line.match(/^use\s+([A-Za-z_][A-Za-z0-9_]*)$/);
		if (useMatch) {
			continue;
		}

		if (line === 'import') {
			i = parseImportBlock(lines, i + 1, ctx) - 1;
			continue;
		}

		const schemaMatch = line.match(/^schema\s+"([^"]+)"\s+do$/);
		if (schemaMatch) {
			if (ctx.mode && ctx.mode !== 'schema') {
				addDiagnostic(ctx, i, 'Mixed block types are not supported in one file');
				continue;
			}
			i = compileSchemaBlock(lines, i + 1, ctx, schemaMatch[1]) - 1;
			continue;
		}

		if (line === 'routes do') {
			if (ctx.mode && ctx.mode !== 'routes') {
				addDiagnostic(ctx, i, 'Mixed block types are not supported in one file');
				continue;
			}
			i = compileRoutesBlock(lines, i + 1, ctx) - 1;
			continue;
		}

		const actionMatch = line.match(/^action\s+([A-Za-z_][A-Za-z0-9_]*)\(([A-Za-z_][A-Za-z0-9_]*)\)\s+do$/);
		if (actionMatch) {
			if (ctx.mode && ctx.mode !== 'action') {
				addDiagnostic(ctx, i, 'Mixed block types are not supported in one file');
				continue;
			}
			i = compileActionBlock(lines, i + 1, ctx, actionMatch[1], actionMatch[2]) - 1;
			continue;
		}

		addDiagnostic(ctx, i, 'Unexpected line at top level');
	}

	if (ctx.hasActions) {
		emit(ctx.out, 'return M');
	}

	if (ctx.errors.length > 0) {
		return null;
	}

	return {
		runFiles: {},
		diagnostics: [],
		manifest: {
			runtimeId: 'lua',
			sourceFiles: [],
			generatedFiles: [],
			kind: 'fuwa'
		}
	};
}

function compileRoutesBlock(lines: string[], index: number, ctx: CompileContext): number {
	ctx.mode = 'routes';
	const routes: string[] = [];

	for (let i = index; i < lines.length; i += 1) {
		const line = trim(lines[i]);
		if (line === '' || starts(line, '--')) {
			continue;
		}
		if (line === 'end') {
			emitImports(ctx);
			emit(ctx.out, 'local web = require("fuwa.runtime.web")');
			emitBlank(ctx.out);
			emit(ctx.out, 'return web.app({');
			for (const route of routes) {
				emit(ctx.out, route);
			}
			emit(ctx.out, '})');
			return i + 1;
		}

		const routeMatch = line.match(/^([A-Za-z]+)\s+"([^"]+)"\s+(.+)$/);
		if (routeMatch) {
			routes.push(`  web.${routeMatch[1]}(${quoteLuaString(routeMatch[2])}, ${routeMatch[3]}),`);
			continue;
		}

		addDiagnostic(ctx, i, 'Expected: METHOD "path" handler.function');
	}

	addDiagnostic(ctx, lines.length - 1, 'Unexpected EOF while parsing routes block');
	return lines.length;
}

function compileActionBlocksOnly(source: string, filename: string): { lua: string; diagnostics: BuildDiagnostic[] } {
	const result = compileFuwaModule(source, filename);
	if (!result) {
		return { lua: '', diagnostics: [] };
	}

	return {
		lua: result.runFiles['__missing__'] ?? '',
		diagnostics: result.diagnostics
	};
}

function buildViewModule(templateSource: string): string {
	const quotedTemplate = quoteLuaString(templateSource);

	return [
		'local view = require("fuwa.runtime.view")',
		'local web = require("fuwa.runtime.web")',
		'',
		'local M = {}',
		'',
		`local template = ${quotedTemplate}`,
		'',
		'function M.render(name, data, opts)',
		'  local html, err = view.render(template, data, opts)',
		'  if html ~= nil then',
		'    return html',
		'  end',
		'',
		'  return web.dev_error_html({',
		'    _type = "error",',
		'    err = {',
		'      kind = err and err.kind or "template_error",',
		'      message = err and err.message or "Template render failed",',
		'    },',
		'    action = name,',
		'    line = err and err.line or nil,',
		'    expr = err and err.snippet or nil,',
		'  })',
		'end',
		'',
		'function M.render_home(data, opts)',
		'  return M.render("gomen", data, opts)',
		'end',
		'',
		'return M',
		''
	].join('\n');
}

function buildMainBootstrap(): string {
	return [
		'local app = require("app")',
		'local view = require("view")',
		'local web = require("fuwa.runtime.web")',
		'',
		'local function render_response(resp, depth)',
		'  depth = depth or 0',
		'  if depth > 8 then',
		'    return web.dev_error_html({',
		'      _type = "crash",',
		'      err = "redirect_loop",',
		'      trace = "Redirect depth exceeded",',
		'    })',
		'  end',
		'',
		'  if resp == nil then',
		'    return web.dev_error_html({',
		'      _type = "crash",',
		'      err = "nil_response",',
		'      trace = "Application returned nil",',
		'    })',
		'  end',
		'',
		'  if resp._type == "render" then',
		'    return view.render(resp.view, resp.data or {}, {})',
		'  end',
		'',
		'  if resp._type == "redirect" then',
		'    return render_response(app.dispatch("GET", resp.path, ""), depth + 1)',
		'  end',
		'',
		'  if resp._type == "error" or resp._type == "crash" then',
		'    return web.dev_error_html(resp)',
		'  end',
		'',
		'  if resp._type == "not_found" then',
		'    return [[<main class="phone-screen phone-screen-scroll" data-phone-title="Fuwa Gomen"><section class="phone-section phone-safe-all"><div class="phone-stack"><h1>Not found</h1><p>The requested route was not found.</p></div></section></main>]]',
		'  end',
		'',
		'  if type(resp) == "string" then',
		'    return resp',
		'  end',
		'',
		'  return tostring(resp)',
		'end',
		'',
		'function handle_request(method, path, body)',
		'  return render_response(app.dispatch(method, path, body))',
		'end',
		'',
		'if not __fuwa_is_request then',
		'  set_html(render_response(app.dispatch("GET", "/", "")))',
		'end',
		''
	].join('\n');
}

function hasFuwaSources(sourceFiles: RuntimeFiles): boolean {
	return Object.keys(sourceFiles).some((name) => name.endsWith('.fuwa'));
}

function hasAppSource(sourceFiles: RuntimeFiles): boolean {
	return Object.prototype.hasOwnProperty.call(sourceFiles, 'app.fuwa');
}

function hasViewSource(sourceFiles: RuntimeFiles): boolean {
	return Object.prototype.hasOwnProperty.call(sourceFiles, 'view.fuwa');
}

function cloneFiles(files: RuntimeFiles): RuntimeFiles {
	return { ...files };
}

function compileModuleSource(source: string, filename: string): { lua: string | null; diagnostics: BuildDiagnostic[] } {
	const lines = splitLines(source);
	const ctx: CompileContext = {
		filename,
		lines,
		out: [],
		errors: [],
		imports: [],
		importsFlushed: false,
		actionBootstrapEmitted: false,
		hasActions: false,
		moduleName: null,
		mode: null
	};

	for (let i = 0; i < lines.length; i += 1) {
		const line = trim(lines[i]);
		if (line === '' || starts(line, '--')) {
			continue;
		}

		const moduleMatch = line.match(/^module\s+([A-Za-z_][A-Za-z0-9_]*)$/);
		if (moduleMatch) {
			ctx.moduleName = moduleMatch[1];
			continue;
		}

		const useMatch = line.match(/^use\s+([A-Za-z_][A-Za-z0-9_]*)$/);
		if (useMatch) {
			continue;
		}

		if (line === 'import') {
			i = parseImportBlock(lines, i + 1, ctx) - 1;
			continue;
		}

		const schemaMatch = line.match(/^schema\s+"([^"]+)"\s+do$/);
		if (schemaMatch) {
			if (ctx.mode && ctx.mode !== 'schema') {
				addDiagnostic(ctx, i, 'Mixed block types are not supported in one file');
				continue;
			}
			i = compileSchemaBlock(lines, i + 1, ctx, schemaMatch[1]) - 1;
			continue;
		}

		if (line === 'routes do') {
			if (ctx.mode && ctx.mode !== 'routes') {
				addDiagnostic(ctx, i, 'Mixed block types are not supported in one file');
				continue;
			}
			i = compileRoutesBlock(lines, i + 1, ctx) - 1;
			continue;
		}

		const actionMatch = line.match(/^action\s+([A-Za-z_][A-Za-z0-9_]*)\(([A-Za-z_][A-Za-z0-9_]*)\)\s+do$/);
		if (actionMatch) {
			if (ctx.mode && ctx.mode !== 'action') {
				addDiagnostic(ctx, i, 'Mixed block types are not supported in one file');
				continue;
			}
			i = compileActionBlock(lines, i + 1, ctx, actionMatch[1], actionMatch[2]) - 1;
			continue;
		}

		addDiagnostic(ctx, i, 'Unexpected line at top level');
	}

	if (ctx.hasActions) {
		emit(ctx.out, 'return M');
	}

	if (ctx.errors.length > 0) {
		return { lua: null, diagnostics: ctx.errors };
	}

	return {
		lua: ctx.out.join('\n'),
		diagnostics: []
	};
}

function compileModuleFile(sourceFiles: RuntimeFiles, fileName: string): { lua: string | null; diagnostics: BuildDiagnostic[] } {
	const source = sourceFiles[fileName];
	if (typeof source !== 'string') {
		return {
			lua: null,
			diagnostics: [
				{
					level: 'error',
					file: fileName,
					message: 'Missing source file'
				}
			]
		};
	}

	return compileModuleSource(source, fileName);
}

function collectSourceFiles(sourceFiles: RuntimeFiles): string[] {
	return Object.keys(sourceFiles).filter((name) => name.endsWith('.fuwa')).sort();
}

function buildPassthroughManifest(runtimeId: string, sourceFiles: RuntimeFiles): BuildManifest {
	return {
		runtimeId,
		sourceFiles: Object.keys(sourceFiles).sort(),
		generatedFiles: [],
		kind: 'passthrough'
	};
}

export function formatBuildDiagnostics(diagnostics: BuildDiagnostic[]): string {
	return diagnostics
		.map((diagnostic) => {
			const location = diagnostic.line != null ? `${diagnostic.file}:${diagnostic.line}` : diagnostic.file;
			const snippet = diagnostic.snippet ? `\n  ${diagnostic.snippet}` : '';
			return `${location}\n  ${diagnostic.message}${snippet}`;
		})
		.join('\n\n');
}

export function buildLuaRuntimeFiles(sourceFiles: RuntimeFiles, definition: RuntimeDefinition): BuildResult {
	const runFiles = cloneFiles(sourceFiles);
	const sourceNames = collectSourceFiles(sourceFiles);
	const manifest: BuildManifest = {
		runtimeId: definition.id,
		sourceFiles: Object.keys(sourceFiles).sort(),
		generatedFiles: [],
		kind: 'passthrough'
	};

	if (definition.id !== 'lua' || sourceNames.length === 0) {
		return {
			runFiles,
			diagnostics: [],
			manifest
		};
	}

	const diagnostics: BuildDiagnostic[] = [];
	const builtFiles: RuntimeFiles = {};

	for (const fileName of Object.keys(sourceFiles).sort()) {
		if (!fileName.endsWith('.fuwa')) {
			builtFiles[fileName] = sourceFiles[fileName];
		}
	}

	for (const fileName of sourceNames) {
		if (fileName === 'view.fuwa') {
			continue;
		}

		const compiled = compileModuleFile(sourceFiles, fileName);
		if (compiled.diagnostics.length > 0) {
			diagnostics.push(...compiled.diagnostics);
			continue;
		}

		const targetName = fileName.replace(/\.fuwa$/, '.lua');
		if (compiled.lua != null) {
			builtFiles[targetName] = compiled.lua;
			manifest.generatedFiles.push(targetName);
		}
	}

	if (!hasAppSource(sourceFiles)) {
		diagnostics.push({
			level: 'error',
			file: 'app.fuwa',
			message: 'Missing app.fuwa entry file'
		});
	} else {
		if (!hasViewSource(sourceFiles)) {
			diagnostics.push({
				level: 'error',
				file: 'view.fuwa',
				message: 'Missing view.fuwa template file'
			});
		} else {
			builtFiles['view.lua'] = buildViewModule(sourceFiles['view.fuwa']);
			manifest.generatedFiles.push('view.lua');
		}

		builtFiles['main.lua'] = buildMainBootstrap();
		manifest.generatedFiles.push('main.lua');
		manifest.kind = 'fuwa';
	}

	return {
		runFiles: diagnostics.some((entry) => entry.level === 'error') ? cloneFiles(sourceFiles) : builtFiles,
		diagnostics,
		manifest
	};
}
