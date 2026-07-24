#!/usr/bin/env python3
"""
fuwa dev server — single-process replacement for socat + inotifywait.

Start with:  ./dev.sh           (wrapper)
         or:  python3 runtime/dev-server.py

- Auto-port: kills old fuwa on the port, or picks the next free port.
- Live reload: polls for file changes; SSE endpoint handled by fuwa-dev.lua.
- Observability: reads __VECTOR__ lines from Lua stderr into a ring buffer for /__dev/traces.
- Clean shutdown: Ctrl+C kills everything immediately.
- Foreground only: closing the terminal kills the server.
"""

import json
import os
import sys
import signal
import socket
import subprocess
import threading
import time
import queue
from collections import deque
from pathlib import Path


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LUA_BIN = os.environ.get("LUA_BIN", "lua5.4")
DEFAULT_PORT = int(os.environ.get("PORT", "8080"))
WATCH_DIR = os.path.join(ROOT_DIR, "payloads", "current")
DEV_DIR = os.path.join(ROOT_DIR, ".fuwa-dev")
RELOAD_TOKEN = os.path.join(DEV_DIR, "reload-token")
POLL_INTERVAL = 0.5

_running = True

# ── Observability state (shared across connections) ─────────────────────────

_trace_buffer: deque[str] = deque(maxlen=200)
_trace_lock = threading.Lock()
_trace_subscribers: list[queue.Queue[str]] = []
_trace_subscribers_lock = threading.Lock()



# ── Port discovery ──────────────────────────────────────────────────────────

def find_port(start: int = DEFAULT_PORT) -> int:
    """Kill any process on the port, then bind.  Fall forward if busy."""
    for port in range(start, start + 100):
        try:
            result = subprocess.run(
                ["lsof", "-tiTCP:%d" % port, "-sTCP:LISTEN"],
                capture_output=True, text=True, timeout=2,
            )
            for pid_s in result.stdout.strip().split("\n"):
                pid_s = pid_s.strip()
                if not pid_s:
                    continue
                try:
                    os.kill(int(pid_s), signal.SIGTERM)
                    print("Killed pid %s on port %d" % (pid_s, port))
                except (ProcessLookupError, PermissionError, ValueError):
                    pass
            if result.stdout.strip():
                time.sleep(0.3)
        except FileNotFoundError:
            pass
        except subprocess.TimeoutExpired:
            pass

        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(("127.0.0.1", port))
            s.close()
            return port
        except OSError:
            continue

    print("Error: no free port in range %d–%d" % (start, start + 99),
          file=sys.stderr)
    sys.exit(1)


# ── Dev-directory setup ────────────────────────────────────────────────────

def setup_dev_dir() -> None:
    os.makedirs(DEV_DIR, exist_ok=True)
    os.makedirs(WATCH_DIR, exist_ok=True)
    Path(RELOAD_TOKEN).touch()

    state_path = os.path.join(DEV_DIR, "state.lua")
    if not os.path.exists(state_path):
        Path(state_path).write_text("return {}\n")

    lock_path = os.path.join(DEV_DIR, "state.lua.lock")
    if not os.path.exists(lock_path):
        Path(lock_path).touch()


# ── File watcher (polling) ─────────────────────────────────────────────────

def file_watcher() -> None:
    """Touch the reload token whenever any file under WATCH_DIR changes."""
    last_mtimes: dict[str, int] = {}

    while _running:
        try:
            current: dict[str, int] = {}
            watch = Path(WATCH_DIR)
            if watch.exists():
                for f in watch.rglob("*"):
                    if f.is_file():
                        try:
                            current[str(f)] = f.stat().st_mtime_ns
                        except OSError:
                            pass

            if last_mtimes and current != last_mtimes:
                Path(RELOAD_TOKEN).touch()

            last_mtimes = current
        except Exception:
            pass

        time.sleep(POLL_INTERVAL)


# ── Observability pipeline ─────────────────────────────────────────────────

def add_trace(event_json: str) -> None:
    """Push trace into the ring buffer and fan out to SSE subscribers."""
    with _trace_lock:
        _trace_buffer.append(event_json)
    with _trace_subscribers_lock:
        subscribers = list(_trace_subscribers)
    for subscriber in subscribers:
        try:
            subscriber.put_nowait(event_json)
        except queue.Full:
            try:
                subscriber.get_nowait()
            except queue.Empty:
                pass
            try:
                subscriber.put_nowait(event_json)
            except queue.Full:
                pass


def _stderr_reader(proc: subprocess.Popen) -> None:
    """Read Lua stderr line-by-line.  __VECTOR__ lines → ring buffer.
    Everything else → terminal stderr."""
    try:
        for line in proc.stderr:  # type: ignore[union-attr]
            line_str = line.decode("utf-8", errors="replace").rstrip("\r\n")
            if line_str.startswith("__VECTOR__"):
                add_trace(line_str[len("__VECTOR__"):])
            else:
                if line_str:
                    sys.stderr.write(line_str + "\n")
                    sys.stderr.flush()
    except (OSError, ValueError):
        pass


# ── HTTP helpers ────────────────────────────────────────────────────────────

def _read_http_request(
    client_sock: socket.socket,
) -> tuple[str, str, dict[str, str], bytes, bytes] | None:
    """Read HTTP request line + headers + body.  Returns (method, path, headers, raw, body)
    or None if the client disconnected."""
    raw = b""
    client_sock.settimeout(10)
    while b"\r\n\r\n" not in raw:
        try:
            chunk = client_sock.recv(65536)
        except socket.timeout:
            return None
        if not chunk:
            return None
        raw += chunk
        if len(raw) > 131072:  # 128 KB max headers
            return None

    header_end = raw.index(b"\r\n\r\n") + 4
    header_bytes = raw[:header_end]
    body_bytes = raw[header_end:]

    header_str = header_bytes.decode("utf-8", errors="replace")
    lines = header_str.split("\r\n")
    if not lines:
        return None

    first_line = lines[0]
    parts = first_line.split(" ", 2)
    if len(parts) < 2:
        return None

    method = parts[0]
    path = parts[1]

    headers: dict[str, str] = {}
    for line in lines[1:]:
        if ":" in line:
            name, value = line.split(":", 1)
            headers[name.strip().lower()] = value.strip()

    cl = int(headers.get("content-length", "0"))
    while len(body_bytes) < cl:
        try:
            chunk = client_sock.recv(min(65536, cl - len(body_bytes)))
        except socket.timeout:
            break
        if not chunk:
            break
        body_bytes += chunk

    return method, path, headers, raw, body_bytes


def _send_response(
    client_sock: socket.socket,
    status: str,
    content_type: str,
    body: bytes | str,
) -> None:
    """Send a minimal HTTP response and close the socket."""
    body_bytes = body if isinstance(body, bytes) else body.encode("utf-8")
    response = (
        "HTTP/1.1 %s\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %d\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Connection: close\r\n"
        "\r\n"
    ) % (status, content_type, len(body_bytes))
    try:
        client_sock.sendall(response.encode("ascii") + body_bytes)
    except OSError:
        pass
    finally:
        try:
            client_sock.close()
        except OSError:
            pass


# ── Dev API routes ──────────────────────────────────────────────────────────

def _handle_dev_traces(client_sock: socket.socket) -> None:
    """GET /__dev/traces — return ring buffer as JSON array."""
    with _trace_lock:
        traces: list[object] = []
        for t in _trace_buffer:
            try:
                traces.append(json.loads(t))
            except json.JSONDecodeError:
                traces.append({"raw": t})
    body = json.dumps({"traces": traces})
    _send_response(client_sock, "200 OK", "application/json", body)


def _handle_dev_traces_post(client_sock: socket.socket, body_bytes: bytes) -> None:
    """POST /__dev/traces — ingest Wasmoon trace events into the ring buffer."""
    try:
        payload = json.loads(body_bytes.decode("utf-8"))
        events = payload.get("events", [])
        count = 0
        for event in events:
            add_trace(json.dumps(event))
            count += 1
        _send_response(client_sock, "200 OK", "application/json",
                       json.dumps({"ok": True, "ingested": count}))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        _send_response(client_sock, "400 Bad Request", "application/json",
                       json.dumps({"ok": False, "error": str(e)}))


def _handle_dev_trace_stream(client_sock: socket.socket) -> None:
    """GET /__dev/traces/live — SSE stream of trace events."""
    subscriber: queue.Queue[str] = queue.Queue(maxsize=200)
    with _trace_subscribers_lock:
        _trace_subscribers.append(subscriber)

    response = (
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: text/event-stream\r\n"
        "Cache-Control: no-cache\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Connection: keep-alive\r\n"
        "\r\n"
    )

    try:
        client_sock.sendall(response.encode("ascii"))
        client_sock.sendall(b"event: ready\ndata: {\"ok\":true}\n\n")
        while _running:
            try:
                event_json = subscriber.get(timeout=5)
                payload = f"event: trace\ndata: {event_json}\n\n".encode("utf-8")
            except queue.Empty:
                payload = b": keepalive\n\n"
            client_sock.sendall(payload)
    except OSError:
        pass
    finally:
        with _trace_subscribers_lock:
            if subscriber in _trace_subscribers:
                _trace_subscribers.remove(subscriber)
        try:
            client_sock.close()
        except OSError:
            pass


# ── Connection handler ─────────────────────────────────────────────────────

def handle_connection(client_sock: socket.socket) -> None:
    """Parse HTTP request, intercept /__dev/ routes, forward everything else to Lua."""

    parsed = _read_http_request(client_sock)
    if parsed is None:
        try:
            client_sock.close()
        except OSError:
            pass
        return

    method, path, _headers, raw, body = parsed

    # ── /__dev/ API routes ──────────────────────────────────────────────
    if path == "/__dev/traces":
        if method == "POST":
            _handle_dev_traces_post(client_sock, body)
        else:
            _handle_dev_traces(client_sock)
        return

    if path == "/__dev/traces/live":
        _handle_dev_trace_stream(client_sock)
        return

    # ── Forward to Lua ──────────────────────────────────────────────────
    try:
        proc = subprocess.Popen(
            [LUA_BIN, "runtime/fuwa-dev.lua"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=ROOT_DIR,
        )
    except FileNotFoundError:
        _send_response(client_sock, "500 Internal Server Error", "text/plain",
                       "Lua binary not found: %s" % LUA_BIN)
        return

    # Background thread: drain stderr → observability pipeline + terminal
    stderr_thread = threading.Thread(target=_stderr_reader, args=(proc,), daemon=True)
    stderr_thread.start()

    # Feed the full HTTP request (raw + body) to Lua stdin
    try:
        proc.stdin.write(raw)  # type: ignore[union-attr]
        proc.stdin.write(body)  # type: ignore[union-attr]
        proc.stdin.close()      # type: ignore[union-attr]
    except (OSError, BrokenPipeError):
        pass

    # Stream Lua stdout back to client
    try:
        while True:
            data = proc.stdout.read(65536)  # type: ignore[union-attr]
            if not data:
                break
            try:
                client_sock.sendall(data)
            except OSError:
                break
    except (OSError, BrokenPipeError, ValueError):
        pass
    finally:
        try:
            client_sock.close()
        except OSError:
            pass

    # Reap the Lua process
    try:
        proc.terminate()
        proc.wait(timeout=2)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


# ── Main ────────────────────────────────────────────────────────────────────

def _on_signal(sig: int, frame: object) -> None:
    global _running
    print("\nShutting down...")
    _running = False


def main() -> None:
    global _running

    os.chdir(ROOT_DIR)
    port = find_port()
    setup_dev_dir()

    threading.Thread(target=file_watcher, daemon=True, name="file-watcher").start()

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", port))
    server.listen(128)
    server.settimeout(1.0)

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    print("fuwa dev -> http://localhost:%d" % port)
    print("Press Ctrl+C to stop.")

    while _running:
        try:
            client, _addr = server.accept()
            threading.Thread(
                target=handle_connection,
                args=(client,),
                daemon=True,
                name="conn",
            ).start()
        except socket.timeout:
            continue
        except OSError:
            if _running:
                raise

    server.close()
    print("fuwa dev server stopped.")


if __name__ == "__main__":
    main()
