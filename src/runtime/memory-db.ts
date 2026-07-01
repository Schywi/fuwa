type DbRow = Record<string, unknown> & { id: number };

type DbTable = {
	rows: DbRow[];
	nextId: number;
};

export type DbCommand = {
	op?: string;
	collection?: string;
	id?: unknown;
	data?: Record<string, unknown> | null;
	where?: Record<string, unknown> | null;
	limit?: unknown;
	order?: unknown;
};

export type DbOkResponse = {
	ok: true;
	value: unknown;
};

export type DbErrResponse = {
	ok: false;
	err: {
		kind: string;
		message: string;
	};
};

export type DbResponse = DbOkResponse | DbErrResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
	if (typeof structuredClone === 'function') {
		return structuredClone(value);
	}

	return JSON.parse(JSON.stringify(value)) as T;
}

function toNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
		return Number(value);
	}
	return null;
}

function compareValues(left: unknown, right: unknown): boolean {
	return String(left ?? '') === String(right ?? '');
}

function matchesWhere(row: DbRow, where: Record<string, unknown>): boolean {
	for (const [key, expected] of Object.entries(where)) {
		if (!compareValues(row[key], expected)) {
			return false;
		}
	}
	return true;
}

function normalizeOrder(order: unknown): { field: string; direction: 'asc' | 'desc' } | null {
	if (typeof order !== 'string') return null;
	const trimmed = order.trim();
	if (!trimmed) return null;

	const parts = trimmed.split(/\s+/);
	const field = parts[0] ?? '';
	if (!field) return null;

	const direction = parts[1]?.toLowerCase() === 'desc' ? 'desc' : 'asc';
	return { field, direction };
}

function sortRows(rows: DbRow[], order: unknown): DbRow[] {
	const spec = normalizeOrder(order);
	if (!spec) return rows.slice();

	return rows.slice().sort((left, right) => {
		const leftValue = left[spec.field];
		const rightValue = right[spec.field];
		if (compareValues(leftValue, rightValue)) return 0;
		if (leftValue == null) return spec.direction === 'asc' ? -1 : 1;
		if (rightValue == null) return spec.direction === 'asc' ? 1 : -1;
		if (typeof leftValue === 'number' && typeof rightValue === 'number') {
			return spec.direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
		}
		return spec.direction === 'asc'
			? String(leftValue).localeCompare(String(rightValue))
			: String(rightValue).localeCompare(String(leftValue));
	});
}

export class MemoryDatabase {
	private readonly tables = new Map<string, DbTable>();

	private table(name: string): DbTable {
		let table = this.tables.get(name);
		if (!table) {
			table = { rows: [], nextId: 1 };
			this.tables.set(name, table);
		}
		return table;
	}

	private ok(value: unknown): DbOkResponse {
		return { ok: true, value: cloneValue(value) };
	}

	private notFound(collection: string, id: unknown): DbErrResponse {
		return {
			ok: false,
			err: {
				kind: 'not_found',
				message: `No row found in ${collection} for id=${String(id)}`
			}
		};
	}

	private badRequest(message: string): DbErrResponse {
		return {
			ok: false,
			err: {
				kind: 'bad_request',
				message
			}
		};
	}

	private nextRowId(table: DbTable, data: Record<string, unknown>): number {
		const provided = toNumber(data.id);
		if (provided != null) {
			table.nextId = Math.max(table.nextId, provided + 1);
			return provided;
		}

		const id = table.nextId;
		table.nextId += 1;
		return id;
	}

	private findRowIndex(table: DbTable, id: unknown): number {
		return table.rows.findIndex((row) => compareValues(row.id, id));
	}

	private filterRows(rows: DbRow[], where: Record<string, unknown> | null | undefined): DbRow[] {
		if (!isRecord(where) || Object.keys(where).length === 0) {
			return rows.slice();
		}

		return rows.filter((row) => matchesWhere(row, where));
	}

	op(command: unknown): DbResponse {
		if (!isRecord(command)) {
			return this.badRequest('DB command must be an object');
		}

		const op = String(command.op ?? '').trim();
		const collection = String(command.collection ?? '').trim();
		if (!op || !collection) {
			return this.badRequest('DB command requires op and collection');
		}

		const table = this.table(collection);

		switch (op) {
			case 'all': {
				const rows = sortRows(table.rows, command.order);
				const limited = Number.isFinite(Number(command.limit))
					? rows.slice(0, Math.max(0, Number(command.limit)))
					: rows;
				return this.ok(limited);
			}

			case 'find': {
				const index = this.findRowIndex(table, command.id);
				if (index < 0) return this.notFound(collection, command.id);
				return this.ok(table.rows[index]);
			}

			case 'find_by': {
				const where = isRecord(command.where) ? command.where : null;
				const matches = this.filterRows(table.rows, where);
				const limited = Number.isFinite(Number(command.limit))
					? matches.slice(0, Math.max(0, Number(command.limit)))
					: matches;
				const queryLabel = where ?? command.id ?? 'query';
				if (limited.length === 0) return this.notFound(collection, queryLabel);
				return this.ok(limited[0]);
			}

			case 'where': {
				const where = isRecord(command.where) ? command.where : null;
				const rows = this.filterRows(table.rows, where);
				const ordered = sortRows(rows, command.order);
				const limited = Number.isFinite(Number(command.limit))
					? ordered.slice(0, Math.max(0, Number(command.limit)))
					: ordered;
				return this.ok(limited);
			}

			case 'create': {
				const data = isRecord(command.data) ? command.data : {};
				const row: DbRow = {
					...cloneValue(data),
					id: this.nextRowId(table, data)
				};
				table.rows.push(row);
				return this.ok(row);
			}

			case 'update': {
				const index = this.findRowIndex(table, command.id);
				if (index < 0) return this.notFound(collection, command.id);
				const current = table.rows[index];
				const patch = isRecord(command.data) ? command.data : {};
				const updated: DbRow = {
					...current,
					...cloneValue(patch),
					id: current.id
				};
				table.rows[index] = updated;
				return this.ok(updated);
			}

			case 'delete': {
				const index = this.findRowIndex(table, command.id);
				if (index < 0) return this.notFound(collection, command.id);
				const [removed] = table.rows.splice(index, 1);
				return this.ok({ deleted: true, collection, id: removed.id });
			}

			default:
				return this.badRequest(`Unsupported DB op: ${op}`);
		}
	}
}
