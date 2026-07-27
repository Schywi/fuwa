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
import re

CONTAINER_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")
TAIL_LINES = 100
KEEPALIVE_SECS = 15


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
            q.put({"kind": "log", "container": name, "line": line.rstrip("\n")})

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

    if not valid:
        try:
            _write_sse(client_sock, "error",
                       json.dumps({"message": "no valid container names provided"}))
        except ConnectionError:
            pass
        finally:
            try:
                client_sock.close()
            except OSError:
                pass
        return

    try:
        _write_sse(client_sock, "ready", json.dumps({"containers": list(valid)}))
    except ConnectionError:
        try:
            client_sock.close()
        except OSError:
            pass
        return

    q: queue.Queue = queue.Queue()
    stop_event = threading.Event()
    threads: list[threading.Thread] = []
    pending = set(valid)

    for name in valid:
        thread = threading.Thread(
            target=_reader_thread,
            args=(name, q, stop_event),
            daemon=True,
        )
        thread.start()
        threads.append(thread)

    try:
        while pending:
            try:
                msg = q.get(timeout=KEEPALIVE_SECS)
            except queue.Empty:
                _write_sse(client_sock, "status",
                           json.dumps({"container": "", "status": "keepalive"}))
                continue

            kind = msg.get("kind", "")
            if kind in ("status", "log", "error"):
                _write_sse(client_sock, kind, json.dumps(msg))

            if kind == "status" and msg.get("status") == "closed":
                pending.discard(msg.get("container", ""))
            if kind == "error":
                pending.discard(msg.get("container", ""))

        _write_sse(client_sock, "status",
                   json.dumps({"container": "", "status": "done"}))
    except ConnectionError:
        pass
    finally:
        stop_event.set()
        for thread in threads:
            thread.join(timeout=2)
        try:
            client_sock.close()
        except OSError:
            pass
