"""
Container log multiplexer — one SSE stream for multiple docker containers.

Usage from dev-server.py:
    from container_logs import handle_container_stream
    handle_container_stream(client_sock, names)

SSE event types:
    ready   — {"containers": [...]}
    status  — {"container": name, "status": "connecting|connected|closed"}
    log     — {"container": name, "line": "..."}
    error   — {"container": name, "message": "..."}
"""

import json
import queue
import socket
import subprocess
import threading
import time
import re

CONTAINER_NAME_RE = re.compile(r'^[A-Za-z0-9_-]+$')
TAIL_LINES = 100
KEEPALIVE_SECS = 15
CONNECT_TIMEOUT = 8


def _validate_names(names: list[str]) -> list[str]:
    """Filter and validate container names against a strict pattern."""
    valid: list[str] = []
    for name in names:
        name = name.strip()
        if name and CONTAINER_NAME_RE.match(name):
            valid.append(name)
    return valid


def _reader_thread(name: str, q: queue.Queue, stop_event: threading.Event) -> None:
    """Run 'docker logs -f --tail N <name>' and push structured messages into the queue."""
    q.put({"kind": "status", "container": name, "status": "connecting"})

    try:
        proc = subprocess.Popen(
            ["docker", "logs", "-f", "--tail", str(TAIL_LINES), name],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except (OSError, FileNotFoundError) as exc:
        q.put({"kind": "error", "container": name, "message": str(exc)})
        return

    q.put({"kind": "status", "container": name, "status": "connected"})

    try:
        for line in proc.stdout:  # type: ignore[union-attr]
            if stop_event.is_set():
                break
            line = line.rstrip("\n")
            q.put({"kind": "log", "container": name, "line": line})

        proc.stdout.close()  # type: ignore[union-attr]
        returncode = proc.wait(timeout=2)
        q.put({
            "kind": "status",
            "container": name,
            "status": "closed",
            "reason": "process exited with code %d" % returncode,
        })
    except Exception as exc:
        q.put({"kind": "error", "container": name, "message": str(exc)})
    finally:
        try:
            proc.kill()
            proc.wait(timeout=1)
        except Exception:
            pass


def _write_sse(sock: socket.socket, event: str, data: str) -> None:
    """Write a single SSE event frame."""
    payload = "event: %s\r\ndata: %s\r\n\r\n" % (event, data)
    try:
        sock.sendall(payload.encode("utf-8"))
    except (OSError, BrokenPipeError):
        raise ConnectionError("client disconnected")


def handle_container_stream(client_sock: socket.socket, names: list[str]) -> None:
    """GET /__dev/containers/live?name=...&name=... — multiplexed SSE stream."""

    valid = _validate_names(names)
    if not valid:
        _write_sse(client_sock, "error",
                   json.dumps({"message": "no valid container names provided"}))
        return

    # --- Send SSE headers ---
    headers = (
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: text/event-stream\r\n"
        "Cache-Control: no-cache\r\n"
        "Connection: keep-alive\r\n"
        "\r\n"
    )
    try:
        client_sock.sendall(headers.encode("utf-8"))
    except (OSError, BrokenPipeError):
        return

    # --- Send ready ---
    try:
        _write_sse(client_sock, "ready",
                   json.dumps({"containers": list(valid)}))
    except ConnectionError:
        return

    # --- Start reader threads ---
    q: queue.Queue = queue.Queue()
    stop_event = threading.Event()
    threads: list[threading.Thread] = []

    for name in valid:
        t = threading.Thread(
            target=_reader_thread,
            args=(name, q, stop_event),
            daemon=True,
        )
        t.start()
        threads.append(t)

    # --- SSE drain loop ---
    pending = set(valid)  # containers that haven't reported closed/error yet
    last_keepalive = time.monotonic()
    connected_start = time.monotonic()

    try:
        while pending:
            elapsed = time.monotonic() - connected_start
            if elapsed > CONNECT_TIMEOUT and not any(
                True for _ in range(1)
            ):
                pass  # keep waiting

            try:
                msg = q.get(timeout=KEEPALIVE_SECS)
            except queue.Empty:
                if time.monotonic() - last_keepalive >= KEEPALIVE_SECS:
                    _write_sse(client_sock, "status",
                               json.dumps({"container": "", "status": "keepalive"}))
                    last_keepalive = time.monotonic()
                continue

            last_keepalive = time.monotonic()
            kind = msg.get("kind", "")
            data_str = json.dumps(msg)

            if kind in ("status", "log", "error"):
                _write_sse(client_sock, kind, data_str)

            if kind == "status":
                status_val = msg.get("status", "")
                container = msg.get("container", "")
                if status_val in ("closed",) or kind == "error":
                    pending.discard(container)
            elif kind == "error":
                pending.discard(msg.get("container", ""))

        # All containers done — send final keepalive then exit
        time.sleep(0.1)
        _write_sse(client_sock, "status",
                   json.dumps({"container": "", "status": "done"}))

    except ConnectionError:
        pass  # client disconnected
    finally:
        stop_event.set()
        for t in threads:
            t.join(timeout=2)
