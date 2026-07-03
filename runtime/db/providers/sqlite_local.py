#!/usr/bin/env python3

from __future__ import annotations

import json
import re
import sqlite3
import sys
import uuid
from functools import cmp_to_key
from pathlib import Path
from typing import Any

TENANT_KEY = "__local__"
DEFAULT_LIMIT = 100
COLLECTION_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
RESERVED_FIELDS = {"id", "created_at", "updated_at"}


def ok(value: Any) -> dict[str, Any]:
    return {"ok": True, "value": value}


def err(kind: str, message: str, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"kind": kind, "message": message}
    if meta:
        payload["meta"] = meta
    return {"ok": False, "err": payload}


def to_lua(value: Any) -> str:
    if value is None:
        return "nil"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return repr(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "{ " + ", ".join(to_lua(item) for item in value) + " }"
    if isinstance(value, dict):
        parts = []
        for key in sorted(value.keys(), key=lambda item: str(item)):
            parts.append(f"[{to_lua(key)}] = {to_lua(value[key])}")
        return "{ " + ", ".join(parts) + " }"
    raise TypeError(f"cannot encode type {type(value)!r}")


def ensure_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS tenant_documents (
            tenant_key TEXT NOT NULL,
            collection TEXT NOT NULL,
            id TEXT NOT NULL,
            data_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (tenant_key, collection, id)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_tenant_documents_collection_updated_at
            ON tenant_documents (tenant_key, collection, updated_at DESC)
        """
    )
    conn.commit()
    return conn


def is_record(value: Any) -> bool:
    return isinstance(value, dict)


def sanitize_collection_name(collection: Any) -> str:
    if not isinstance(collection, str) or not COLLECTION_RE.match(collection):
        raise ValueError(f"Invalid collection name: {collection!r}")
    return collection


def now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def strip_reserved_fields(data: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in data.items() if key not in RESERVED_FIELDS}


def deep_equal(left: Any, right: Any) -> bool:
    if left is right:
        return True
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        if left.keys() != right.keys():
            return False
        return all(deep_equal(left[key], right[key]) for key in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(deep_equal(a, b) for a, b in zip(left, right))
    return left == right


def values_equal(left: Any, right: Any) -> bool:
    return deep_equal(left, right)


def row_to_record(row: sqlite3.Row) -> dict[str, Any]:
    payload = json.loads(row["data_json"]) if row["data_json"] else {}
    return {
        "id": row["id"],
        **payload,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def load_collection_rows(conn: sqlite3.Connection, collection: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT id, data_json, created_at, updated_at
          FROM tenant_documents
         WHERE tenant_key = ? AND collection = ?
        """,
        (TENANT_KEY, collection),
    ).fetchall()
    return [row_to_record(row) for row in rows]


def compare_values(left: Any, right: Any) -> int:
    if left == right:
        return 0
    if left is None:
        return -1
    if right is None:
        return 1
    if isinstance(left, (int, float)) and isinstance(right, (int, float)) and not isinstance(left, bool) and not isinstance(right, bool):
        return -1 if left < right else 1
    if isinstance(left, bool) and isinstance(right, bool):
        return -1 if int(left) < int(right) else 1
    left_text = str(left)
    right_text = str(right)
    return -1 if left_text < right_text else 1


def normalize_order(order: Any) -> dict[str, str]:
    if isinstance(order, str):
        return {"field": order, "dir": "asc"}
    if not isinstance(order, dict):
        return {"field": "updated_at", "dir": "desc"}
    return {
        "field": str(order.get("field") or "updated_at"),
        "dir": "asc" if order.get("dir") == "asc" else "desc",
    }


def sort_records(records: list[dict[str, Any]], order: Any) -> list[dict[str, Any]]:
    normalized = normalize_order(order)
    field = normalized["field"]
    direction = normalized["dir"]

    def cmp(left: dict[str, Any], right: dict[str, Any]) -> int:
        result = compare_values(left.get(field), right.get(field))
        return result if direction == "asc" else -result

    return sorted(records, key=cmp_to_key(cmp))


def limit_records(records: list[dict[str, Any]], limit: Any) -> list[dict[str, Any]]:
    if isinstance(limit, (int, float)) and limit > 0:
        max_count = int(limit)
    else:
        max_count = DEFAULT_LIMIT
    return [dict(record) for record in records[:max_count]]


def row_matches(row: dict[str, Any], where: dict[str, Any]) -> bool:
    for key, expected in where.items():
        if not values_equal(row.get(key), expected):
            return False
    return True


def filtered_rows(rows: list[dict[str, Any]], where: Any, order: Any, limit: Any) -> list[dict[str, Any]]:
    if not isinstance(where, dict):
        where = {}
    matched = [dict(row) for row in rows if row_matches(row, where)]
    ordered = sort_records(matched, order)
    return limit_records(ordered, limit)


def find_first_row(rows: list[dict[str, Any]], where: Any, order: Any) -> dict[str, Any] | None:
    results = filtered_rows(rows, where, order, 1)
    return results[0] if results else None


def create_document(conn: sqlite3.Connection, collection: str, data: dict[str, Any]) -> dict[str, Any]:
    doc_id = data.get("id")
    doc_id = str(doc_id) if doc_id not in (None, "") else str(uuid.uuid4())
    existing = conn.execute(
        """
        SELECT 1
          FROM tenant_documents
         WHERE tenant_key = ? AND collection = ? AND id = ?
        """,
        (TENANT_KEY, collection, doc_id),
    ).fetchone()

    if existing:
        return err("already_exists", f"Document already exists in {collection}", {"collection": collection, "id": doc_id})

    payload = strip_reserved_fields(data)
    created_at = now_iso()
    row = {
        "id": doc_id,
        **payload,
        "created_at": created_at,
        "updated_at": created_at,
    }
    conn.execute(
        """
        INSERT INTO tenant_documents (tenant_key, collection, id, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (TENANT_KEY, collection, doc_id, json.dumps(payload, ensure_ascii=False), created_at, created_at),
    )
    conn.commit()
    return ok(row)


def update_document(conn: sqlite3.Connection, collection: str, doc_id: str, data: dict[str, Any]) -> dict[str, Any]:
    existing = conn.execute(
        """
        SELECT id, data_json, created_at, updated_at
          FROM tenant_documents
         WHERE tenant_key = ? AND collection = ? AND id = ?
        """,
        (TENANT_KEY, collection, doc_id),
    ).fetchone()

    if not existing:
        return err("not_found", f"Document {doc_id} not found in {collection}", {"collection": collection, "id": doc_id})

    current = row_to_record(existing)
    current_payload = strip_reserved_fields(current)
    next_payload = {**current_payload, **strip_reserved_fields(data)}
    updated_at = now_iso()

    conn.execute(
        """
        UPDATE tenant_documents
           SET data_json = ?, updated_at = ?
         WHERE tenant_key = ? AND collection = ? AND id = ?
        """,
        (json.dumps(next_payload, ensure_ascii=False), updated_at, TENANT_KEY, collection, doc_id),
    )
    conn.commit()
    return ok(
        {
            "id": doc_id,
            **next_payload,
            "created_at": current["created_at"],
            "updated_at": updated_at,
        }
    )


def delete_document(conn: sqlite3.Connection, collection: str, doc_id: str) -> dict[str, Any]:
    existing = conn.execute(
        """
        SELECT 1
          FROM tenant_documents
         WHERE tenant_key = ? AND collection = ? AND id = ?
        """,
        (TENANT_KEY, collection, doc_id),
    ).fetchone()

    if not existing:
        return err("not_found", f"Document {doc_id} not found in {collection}", {"collection": collection, "id": doc_id})

    conn.execute(
        """
        DELETE FROM tenant_documents
         WHERE tenant_key = ? AND collection = ? AND id = ?
        """,
        (TENANT_KEY, collection, doc_id),
    )
    conn.commit()
    return ok(True)


def dispatch(command: dict[str, Any], db_path: Path) -> dict[str, Any]:
    try:
        collection = sanitize_collection_name(command.get("collection"))
        op = command.get("op")

        conn = ensure_db(db_path)
        try:
            if op == "all":
                rows = load_collection_rows(conn, collection)
                return ok(filtered_rows(rows, None, command.get("order"), command.get("limit")))

            if op == "find":
                doc_id = command.get("id")
                doc_id = str(doc_id) if doc_id not in (None, "") else ""
                if not doc_id:
                    return err("invalid_command", "Missing document id")
                row = conn.execute(
                    """
                    SELECT id, data_json, created_at, updated_at
                      FROM tenant_documents
                     WHERE tenant_key = ? AND collection = ? AND id = ?
                    """,
                    (TENANT_KEY, collection, doc_id),
                ).fetchone()
                if not row:
                    return err("not_found", f"Document {doc_id} not found in {collection}", {"collection": collection, "id": doc_id})
                return ok(row_to_record(row))

            if op == "find_by":
                where = command.get("where")
                if not isinstance(where, dict):
                    return err("invalid_command", "Missing where clause")
                row = find_first_row(load_collection_rows(conn, collection), where, command.get("order"))
                if not row:
                    return err("not_found", f"No document matched {collection}", {"collection": collection, "where": where})
                return ok(row)

            if op == "where":
                where = command.get("where")
                if not isinstance(where, dict):
                    return err("invalid_command", "Missing where clause")
                rows = load_collection_rows(conn, collection)
                return ok(filtered_rows(rows, where, command.get("order"), command.get("limit")))

            if op == "create":
                data = command.get("data")
                if not isinstance(data, dict):
                    return err("invalid_command", "Missing data payload")
                return create_document(conn, collection, data)

            if op == "update":
                doc_id = command.get("id")
                doc_id = str(doc_id) if doc_id not in (None, "") else ""
                data = command.get("data")
                if not doc_id or not isinstance(data, dict):
                    return err("invalid_command", "Missing id or data payload")
                return update_document(conn, collection, doc_id, data)

            if op == "delete":
                doc_id = command.get("id")
                doc_id = str(doc_id) if doc_id not in (None, "") else ""
                if not doc_id:
                    return err("invalid_command", "Missing document id")
                return delete_document(conn, collection, doc_id)

            return err("invalid_command", f"Unsupported op {op!r}")
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001
        return err("db_error", str(exc))


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(to_lua(err("invalid_command", "Expected db path and command path")), end="")
        return 0

    db_path = Path(argv[1])
    command_path = Path(argv[2])
    command = json.loads(command_path.read_text())
    response = dispatch(command, db_path)
    print(to_lua(response), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
