"""
SigNoz workspace bootstrap — runs once on first boot to seed dashboards.

Waits for SigNoz health, checks if seed dashboards exist, and creates any
that are missing. Designed to run as a one-shot compose service with
restart: on-failure.
"""
import json
import os
import sys
import time
from copy import deepcopy
from pathlib import Path
from urllib import request, error
from uuid import uuid4

SIGNOZ_URL = os.getenv("SIGNOZ_URL", "http://signoz:8080/dash/signoz")
SEEDS_DIR = Path(os.getenv("SEEDS_DIR", "/seeds/dashboards"))
MARKER_FILE = Path(os.getenv("MARKER_FILE", "/var/lib/signoz-bootstrap/.seeded"))

HEALTH_URL = f"{SIGNOZ_URL}/api/v1/health"
DASHBOARDS_URL = f"{SIGNOZ_URL}/api/v1/dashboards"
SEEDED_TITLES = {
    "Fuwa Errors",
    "Fuwa Overview",
    "Fuwa Request Latency",
}


def log(msg):
    print(f"[bootstrap] {msg}", flush=True)


def wait_for_health(timeout=120):
    log(f"waiting for health at {HEALTH_URL} ...")
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            resp = request.urlopen(HEALTH_URL, timeout=3)
            if resp.status == 200:
                body = resp.read().decode()
                if '"ok"' in body or body.strip() == '{"status":"ok"}':
                    log("healthy")
                    return True
        except Exception:
            pass
        time.sleep(2)
    log(f"health not ready after {timeout}s")
    return False


def fetch_json(url, method="GET", data=None):
    """Make an HTTP request and return (status, body_dict_or_none)."""
    req = request.Request(url, method=method)
    req.add_header("Content-Type", "application/json")
    if data is not None:
        req.data = json.dumps(data).encode()
    try:
        resp = request.urlopen(req, timeout=10)
        body = resp.read().decode()
        return resp.status, json.loads(body)
    except error.HTTPError as e:
        body = e.read().decode()
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, {"error": body}
    except Exception as e:
        return 0, {"error": str(e)}


def list_dashboards():
    """Return list of existing dashboard dicts."""
    status, data = fetch_json(DASHBOARDS_URL)
    if status != 200:
        log(f"failed to list dashboards: HTTP {status}")
        return []
    # Response format: {"status":"success","data":[...]}
    items = data.get("data", []) if isinstance(data, dict) else data
    return items if isinstance(items, list) else []


def load_seed_dashboards():
    """Load all .json files from the seeds directory."""
    dashboards = []
    if not SEEDS_DIR.is_dir():
        log(f"seeds directory not found: {SEEDS_DIR}")
        return dashboards
    for path in sorted(SEEDS_DIR.glob("*.json")):
        try:
            db = json.loads(path.read_text())
            dashboards.append(db)
            log(f"loaded seed: {path.name}")
        except Exception as e:
            log(f"failed to load {path.name}: {e}")
    return dashboards


def create_dashboard(payload):
    """POST a new dashboard stub to SigNoz. Returns the created dashboard or None."""
    status, data = fetch_json(DASHBOARDS_URL, method="POST", data=payload)
    title = payload.get("title", "?")
    if status in (200, 201):
        log(f"created dashboard: {title}")
        return data
    log(f"failed to create dashboard '{title}': HTTP {status} {data}")
    return None


def update_dashboard(dashboard_id, payload):
    """PUT a full dashboard payload to an existing SigNoz dashboard ID."""
    status, data = fetch_json(f"{DASHBOARDS_URL}/{dashboard_id}", method="PUT", data=payload)
    title = payload.get("title", "?")
    if status == 200:
        log(f"updated dashboard: {title}")
        return data
    log(f"failed to update dashboard '{title}': HTTP {status} {data}")
    return None


def extract_dashboard_body(dashboard):
    if not isinstance(dashboard, dict):
        return {}
    body = dashboard.get("data", {})
    return body if isinstance(body, dict) else {}


def extract_dashboard_title(dashboard):
    body = extract_dashboard_body(dashboard)
    title = body.get("title")
    if isinstance(title, str) and title:
        return title
    nested = body.get("data")
    if isinstance(nested, dict):
        title = nested.get("title")
        if isinstance(title, str) and title:
            return title
    return None


def dashboard_needs_repair(dashboard):
    body = extract_dashboard_body(dashboard)
    if not body:
        return True
    if isinstance(body.get("data"), dict):
        return True
    return not isinstance(body.get("title"), str)


def map_existing_dashboards(existing):
    dashboards_by_title = {}
    for dashboard in existing:
        title = extract_dashboard_title(dashboard)
        if title:
            dashboards_by_title[title] = dashboard
    log(f"existing dashboards: {set(dashboards_by_title.keys())}")
    return dashboards_by_title


def qualify_payload(payload):
    """
    Patch minimal seed payloads with a complete SigNoz dashboard structure.
    
    A JSON seed can be sparse (just title + tags).  This function fills in a 
    sensible default spec if none exists, so seeds don't need to carry the 
    whole schema.
    """
    data = deepcopy(payload.get("data", payload))
    if data.get("widgets") and data.get("layout"):
        qualified = data
    else:
        title = data.get("title", "")
        qualified = build_dashboard_payload(title, data.get("description", ""), data.get("tags", []))

    qualified.setdefault("uploadedGrafana", False)
    qualified.setdefault("version", "v5")
    qualified.setdefault("panelMap", {})
    qualified.setdefault("variables", {})
    qualified.setdefault("dotMigrated", True)
    qualified.setdefault("uuid", str(uuid4()))
    return qualified


def build_create_payload(payload):
    return {
        "title": payload.get("title", ""),
        "description": payload.get("description", ""),
        "uploadedGrafana": False,
        "version": payload.get("version", "v5"),
    }


def _default_filter(include_route: bool = False, error_only: bool = False) -> str:
    filters = ["serviceName EXISTS", "spanKind = 'Server'"]
    if include_route:
        filters.append("httpRoute EXISTS")
    if error_only:
        filters.append("statusCode = 'STATUS_CODE_ERROR'")
    return " AND ".join(filters)


def _widget(panel_type: str, title: str, query_data: list[dict], *,
            width: int, height: int, x: int, y: int,
            y_axis_unit: str = "none") -> tuple[dict, dict]:
    widget_id = str(uuid4())
    widget = {
        "id": widget_id,
        "title": title,
        "description": "",
        "panelTypes": panel_type,
        "timePreferance": "GLOBAL_TIME",
        "yAxisUnit": y_axis_unit,
        "nullZeroValues": "zero",
        "opacity": "1",
        "isStacked": False,
        "mergeAllActiveQueries": False,
        "fillSpans": False,
        "stackedBarChart": False,
        "softMin": 0,
        "softMax": 0,
        "bucketCount": 30,
        "bucketWidth": 0,
        "thresholds": [],
        "selectedLogFields": [
            {"name": "body", "type": "", "dataType": "string"},
            {"name": "timestamp", "type": "", "dataType": "string"},
        ],
        "selectedTracesFields": [
            {"key": "serviceName", "dataType": "string", "isColumn": True, "isJSON": False, "type": "tag"},
            {"key": "name", "dataType": "string", "isColumn": True, "isJSON": False, "type": "tag"},
            {"key": "durationNano", "dataType": "float64", "isColumn": True, "isJSON": False, "type": "tag"},
            {"key": "httpMethod", "dataType": "string", "isColumn": True, "isJSON": False, "type": "tag"},
            {"key": "httpRoute", "dataType": "string", "isColumn": True, "isJSON": False, "type": "tag"},
            {"key": "statusCode", "dataType": "string", "isColumn": True, "isJSON": False, "type": "tag"},
        ],
        "query": {
            "queryType": "builder",
            "id": str(uuid4()),
            "builder": {
                "queryData": query_data,
                "queryFormulas": [],
            },
            "clickhouse_sql": [{"name": "A", "query": "", "legend": "", "disabled": False}],
            "promql": [{"name": "A", "query": "", "legend": "", "disabled": False}],
        },
    }
    layout = {
        "i": widget_id,
        "w": width,
        "h": height,
        "x": x,
        "y": y,
        "moved": False,
        "static": False,
    }
    return widget, layout


def _builder_query(expression: str, legend: str, aggregate: str | None, *,
                   group_by: list[str] | None = None,
                   order_by: list[dict] | None = None,
                   panel_type: str = "graph",
                   limit: int | None = None) -> dict:
    query = {
        "queryName": expression,
        "expression": expression,
        "disabled": False,
        "stepInterval": 60,
        "dataSource": "traces",
        "legend": legend,
        "filters": None,
        "functions": [],
        "limit": limit,
        "offset": 0,
        "pageSize": 10,
        "groupBy": [],
        "orderBy": order_by or [],
        "having": {"expression": ""},
        "filter": {"expression": _default_filter(include_route=bool(group_by))},
    }

    if panel_type != "list":
        query["aggregations"] = [{"expression": aggregate}] if aggregate else []
    if group_by:
        query["groupBy"] = [
            {"key": key, "dataType": "string", "isColumn": True, "isJSON": False, "type": "tag"}
            for key in group_by
        ]

    return query


def build_dashboard_payload(title: str, description: str, tags: list[str]) -> dict:
    widgets = []
    layout = []

    for widget, placement in _widgets_for_title(title):
        widgets.append(widget)
        layout.append(placement)

    return {
        "title": title,
        "description": description,
        "tags": tags,
        "layout": layout,
        "widgets": widgets,
        "panelMap": {},
        "variables": {},
        "dotMigrated": True,
        "uuid": str(uuid4()),
    }


def _widgets_for_title(title: str) -> list[tuple[dict, dict]]:
    """Return usable SigNoz v5 widgets/layout entries for a given dashboard title."""
    title_lower = title.lower()

    if "overview" in title_lower:
        return [
            _widget(
                "graph",
                "Request count",
                [_builder_query("A", "Requests", "count()")],
                width=6,
                height=6,
                x=0,
                y=0,
                y_axis_unit="short",
            ),
            _widget(
                "graph",
                "Average latency",
                [_builder_query("A", "Avg duration", "avg(durationNano)")],
                width=6,
                height=6,
                x=6,
                y=0,
                y_axis_unit="ns",
            ),
            _widget(
                "table",
                "Requests by route",
                [_builder_query(
                    "A",
                    "Count",
                    "count()",
                    group_by=["httpRoute", "httpMethod"],
                    order_by=[{"columnName": "count()", "order": "desc"}],
                    limit=10,
                )],
                width=12,
                height=8,
                x=0,
                y=6,
                y_axis_unit="short",
            ),
        ]
    if "latency" in title_lower:
        return [
            _widget("graph", "p50 latency", [_builder_query("A", "p50", "p50(durationNano)")], width=4, height=6, x=0, y=0, y_axis_unit="ns"),
            _widget("graph", "p95 latency", [_builder_query("A", "p95", "p95(durationNano)")], width=4, height=6, x=4, y=0, y_axis_unit="ns"),
            _widget("graph", "p99 latency", [_builder_query("A", "p99", "p99(durationNano)")], width=4, height=6, x=8, y=0, y_axis_unit="ns"),
        ]
    if "error" in title_lower:
        error_query = _builder_query("A", "Errors", "count()")
        error_query["filter"] = {"expression": _default_filter(include_route=False, error_only=True)}
        error_table = _builder_query(
            "A",
            "Count",
            "count()",
            group_by=["httpRoute", "httpMethod"],
            order_by=[{"columnName": "count()", "order": "desc"}],
            limit=10,
        )
        error_table["filter"] = {"expression": _default_filter(include_route=True, error_only=True)}
        return [
            _widget("graph", "Errors over time", [error_query], width=6, height=6, x=0, y=0, y_axis_unit="short"),
            _widget("table", "Errors by route", [error_table], width=6, height=6, x=6, y=0, y_axis_unit="short"),
        ]
    return []


def mark_seeded():
    """Write a marker file so seeding doesn't run again on restart."""
    MARKER_FILE.parent.mkdir(parents=True, exist_ok=True)
    MARKER_FILE.write_text(json.dumps({"seeded_at": time.time()}))


def already_seeded():
    return MARKER_FILE.exists()


def main():
    if already_seeded():
        log("already seeded (marker found), exiting")
        return 0

    if not wait_for_health():
        log("sigNoz not healthy, aborting")
        return 1

    existing = list_dashboards()
    log(f"found {len(existing)} existing dashboards")

    seeds = load_seed_dashboards()
    if not seeds:
        log("no seed dashboards to create, skipping")
        mark_seeded()
        return 0

    dashboards_by_title = map_existing_dashboards(existing)
    created = 0
    repaired = 0
    failed = 0
    for seed in seeds:
        payload = qualify_payload(seed)
        title = payload.get("title", "?")
        existing_dashboard = dashboards_by_title.get(title)

        if existing_dashboard is None:
            created_dashboard = create_dashboard(build_create_payload(payload))
            if created_dashboard is None:
                failed += 1
                continue
            existing_dashboard = created_dashboard.get("data", created_dashboard)
            created += 1

        dashboard_id = existing_dashboard.get("id")
        if not dashboard_id:
            log(f"dashboard '{title}' is missing an id, skipping")
            failed += 1
            continue

        if update_dashboard(dashboard_id, payload) is None:
            failed += 1
            continue

        if dashboard_needs_repair(existing_dashboard) or title in SEEDED_TITLES:
            repaired += 1

    log(f"created {created} dashboard(s), repaired {repaired} dashboard(s), failed {failed}")
    if failed > 0:
        log("one or more dashboards failed to seed; leaving marker unset")
        return 1
    mark_seeded()
    return 0


if __name__ == "__main__":
    sys.exit(main())
