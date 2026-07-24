#!/usr/bin/env python3
"""
fuwa dev server — single-process replacement for socat + inotifywait.

Start with:  ./dev.sh           (wrapper)
         or:  python3 runtime/dev-server.py

- Auto-port: kills old fuwa on the port, or picks the next free port.
- Live reload: polls for file changes; SSE endpoint handled by fuwa-dev.lua.
- Clean shutdown: Ctrl+C kills everything immediately.
- Foreground only: closing the terminal kills the server.
"""

import os
import sys
import signal
import socket
import subprocess
import threading
import time
from pathlib import Path


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LUA_BIN = os.environ.get("LUA_BIN", "lua5.4")
DEFAULT_PORT = int(os.environ.get("PORT", "8080"))
WATCH_DIR = os.path.join(ROOT_DIR, "payloads", "current")
DEV_DIR = os.path.join(ROOT_DIR, ".fuwa-dev")
RELOAD_TOKEN = os.path.join(DEV_DIR, "reload-token")
POLL_INTERVAL = 0.5

_running = True


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


# ── Connection handler ─────────────────────────────────────────────────────

def handle_connection(client_sock: socket.socket) -> None:
    """Forward one TCP connection to a fresh lua5.4 fuwa-dev.lua process."""

    try:
        proc = subprocess.Popen(
            [LUA_BIN, "runtime/fuwa-dev.lua"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=None,
            cwd=ROOT_DIR,
        )
    except FileNotFoundError:
        msg = (
            b"HTTP/1.1 500 Internal Server Error\r\n"
            b"Content-Type: text/plain\r\n"
            b"Content-Length: %d\r\n"
            b"\r\n"
            b"Lua binary not found: %s" % (LUA_BIN.encode())
        )
        try:
            client_sock.sendall(msg)
        except OSError:
            pass
        finally:
            client_sock.close()
        return

    def client_to_lua() -> None:
        try:
            while True:
                data = client_sock.recv(65536)
                if not data:
                    break
                proc.stdin.write(data)  # type: ignore[union-attr]
                proc.stdin.flush()      # type: ignore[union-attr]
        except (OSError, BrokenPipeError, ValueError):
            pass
        finally:
            try:
                proc.stdin.close()  # type: ignore[union-attr]
            except Exception:
                pass

    def lua_to_client() -> None:
        try:
            while True:
                data = proc.stdout.read(65536)  # type: ignore[union-attr]
                if not data:
                    break
                client_sock.sendall(data)
        except (OSError, BrokenPipeError, ValueError):
            pass
        finally:
            try:
                client_sock.close()
            except Exception:
                pass

    t1 = threading.Thread(target=client_to_lua, daemon=True)
    t2 = threading.Thread(target=lua_to_client, daemon=True)
    t1.start()
    t2.start()

    t1.join(timeout=60)
    t2.join(timeout=5)

    try:
        proc.terminate()
        proc.wait(timeout=2)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
    finally:
        try:
            client_sock.close()
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
