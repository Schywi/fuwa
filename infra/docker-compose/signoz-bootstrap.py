"""
Minimal SigNoz bootstrap for the local dev stack.
Waits for health, then ensures the seeded dashboard titles exist.
"""
import json
import os
import time
from pathlib import Path
from urllib import error, request

SIGNOZ_URL = os.getenv("SIGNOZ_URL", "http://signoz:8080/dash/signoz")
SEEDS_DIR = Path(os.getenv("SEEDS_DIR", "/seeds/dashboards"))
MARKER_FILE = Path(os.getenv("MARKER_FILE", "/var/lib/signoz-bootstrap/.seeded"))

HEALTH_URL = f"{SIGNOZ_URL}/api/v1/health"
DASHBOARDS_URL = f"{SIGNOZ_URL}/api/v1/dashboards"


def log(message):
    print(f"[bootstrap] {message}", flush=True)


def wait_for_health(timeout=120):
    started = time.time()
    while time.time() - started < timeout:
        try:
            response = request.urlopen(HEALTH_URL, timeout=3)
            if response.status == 200:
                return True
        except Exception:
            pass
        time.sleep(2)
    return False


def fetch_json(url, method="GET", data=None):
    req = request.Request(url, method=method)
    req.add_header("Content-Type", "application/json")
    if data is not None:
        req.data = json.dumps(data).encode()
    try:
        response = request.urlopen(req, timeout=10)
        body = response.read().decode()
        return response.status, json.loads(body)
    except error.HTTPError as err:
        body = err.read().decode()
        try:
            return err.code, json.loads(body)
        except json.JSONDecodeError:
            return err.code, {"error": body}
    except Exception as err:
        return 0, {"error": str(err)}


def existing_titles():
    status, payload = fetch_json(DASHBOARDS_URL)
    if status != 200 or not isinstance(payload, dict):
        return set()
    items = payload.get("data", [])
    titles = set()
    if isinstance(items, list):
        for item in items:
            if isinstance(item, dict):
                data = item.get("data", {})
                title = data.get("title") if isinstance(data, dict) else None
                if isinstance(title, str) and title:
                    titles.add(title)
    return titles


def seed_payloads():
    payloads = []
    for path in sorted(SEEDS_DIR.glob("*.json")):
        try:
            payloads.append(json.loads(path.read_text()))
        except Exception as err:
            log(f"failed to load {path.name}: {err}")
    return payloads


def create_dashboard(seed):
    title = seed.get("title", "")
    payload = {
        "title": title,
        "description": seed.get("description", ""),
        "uploadedGrafana": False,
        "version": "v5",
    }
    status, _data = fetch_json(DASHBOARDS_URL, method="POST", data=payload)
    return status in (200, 201)


def main():
    if MARKER_FILE.exists():
        log("marker present, skipping")
        return
    if not wait_for_health():
        raise SystemExit("signoz health did not become ready")
    titles = existing_titles()
    for seed in seed_payloads():
        title = seed.get("title", "")
        if title and title not in titles:
            create_dashboard(seed)
    MARKER_FILE.parent.mkdir(parents=True, exist_ok=True)
    MARKER_FILE.write_text("seeded\n")


if __name__ == "__main__":
    main()
