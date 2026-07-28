#!/usr/bin/env python3
"""
Spawns `rune serve` as a real child process (the installed console script,
or `python -m rune.cli serve` as a fallback) and drives it through the
actual MCP JSON-RPC handshake over stdio: initialize -> initialized ->
tools/list -> tools/call (several times, including one deliberately
invalid call). This is the one thing that can't be verified by the unit
test suite alone, since it depends on the real `mcp` package actually
being installed and behaving as documented.

Usage:
    python scripts/verify_mcp_server.py [project-dir]

Exits 0 and prints "ALL CHECKS PASSED" if the server completes the full
sequence correctly. Exits 1 on any error, unexpected response shape, or a
15s timeout (e.g. the server hung or crashed silently).
"""
import json
import os
import shutil
import subprocess
import sys
import threading
import time

TIMEOUT_S = 15
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PROJECT_DIR = os.path.join(SCRIPT_DIR, "..", "tests", "fixtures", "sample-express")


def build_command(project_dir: str) -> list[str]:
    rune_bin = shutil.which("rune")
    if rune_bin:
        return [rune_bin, "serve", project_dir]
    # Fall back to running the CLI module directly if the console script
    # isn't on PATH (e.g. an editable install without a rehashed shell).
    return [sys.executable, "-m", "rune.cli", "serve", project_dir]


def main() -> None:
    project_dir = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PROJECT_DIR)
    cmd = build_command(project_dir)
    print(f"[verify] spawning: {' '.join(cmd)}")

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    finished = {"done": False}

    def fail(message: str) -> None:
        if finished["done"]:
            return
        finished["done"] = True
        print(f"\n[verify] FAILED: {message}", file=sys.stderr)
        proc.kill()
        sys.exit(1)

    def ok() -> None:
        finished["done"] = True
        print("\n[verify] ALL CHECKS PASSED — MCP server responds correctly over stdio.")
        proc.kill()
        sys.exit(0)

    def send(obj: dict) -> None:
        proc.stdin.write(json.dumps(obj) + "\n")
        proc.stdin.flush()

    def stream_stderr():
        for line in proc.stderr:
            sys.stderr.write(f"[server stderr] {line}")

    threading.Thread(target=stream_stderr, daemon=True).start()

    def handle_message(msg: dict) -> None:
        print(f"\n[verify] <-- {json.dumps(msg)[:500]}")

        if msg.get("error"):
            fail(f"server returned a JSON-RPC error: {msg['error']}")
            return

        msg_id = msg.get("id")

        if msg_id == 1:  # initialize response
            if not (msg.get("result") or {}).get("serverInfo"):
                return fail("initialize response missing serverInfo")
            send({"jsonrpc": "2.0", "method": "notifications/initialized"})
            print("[verify] --> notifications/initialized")
            send({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
            print("[verify] --> tools/list")

        elif msg_id == 2:  # tools/list response
            tools = (msg.get("result") or {}).get("tools", [])
            names = [t["name"] for t in tools]
            print(f"[verify] server exposes {len(tools)} tool(s): {', '.join(names)}")
            expected = ["rune_get_overview", "rune_search", "rune_explain", "rune_rescan"]
            missing = [n for n in expected if n not in names]
            if missing:
                return fail(f"expected tools missing from tools/list: {', '.join(missing)}")
            send({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                  "params": {"name": "rune_get_overview", "arguments": {}}})
            print("[verify] --> tools/call rune_get_overview")

        elif msg_id == 3:  # rune_get_overview result
            result = msg.get("result") or {}
            if result.get("isError"):
                return fail(f"rune_get_overview returned isError: {result}")
            if not (result.get("content") or [{}])[0].get("text"):
                return fail("rune_get_overview response missing content")
            print("[verify] rune_get_overview OK")
            send({"jsonrpc": "2.0", "id": 4, "method": "tools/call",
                  "params": {"name": "rune_search", "arguments": {"query": "UserCard"}}})
            print("[verify] --> tools/call rune_search { query: 'UserCard' }")

        elif msg_id == 4:  # rune_search result
            result = msg.get("result") or {}
            if result.get("isError"):
                return fail(f"rune_search returned isError: {result}")
            print("[verify] rune_search OK")
            send({"jsonrpc": "2.0", "id": 5, "method": "tools/call",
                  "params": {"name": "rune_search", "arguments": {}}})
            print("[verify] --> tools/call rune_search with missing required 'query' (expecting a clean rejection)")

        elif msg_id == 5:  # rune_search with missing required arg
            result = msg.get("result") or {}
            rejected_cleanly = bool(result.get("isError")) or bool(msg.get("error"))
            if not rejected_cleanly:
                return fail("expected rune_search with a missing required argument to be rejected, but it wasn't")
            print("[verify] invalid input correctly rejected without crashing the server")
            ok()

    def read_stdout():
        buf = ""
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                print(f"[verify] (ignoring non-JSON stdout line: {line})")
                continue
            handle_message(msg)
            if finished["done"]:
                return

    reader = threading.Thread(target=read_stdout, daemon=True)
    reader.start()

    send({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "rune-verify-script", "version": "1.0.0"},
        },
    })
    print("[verify] --> initialize")

    deadline = time.time() + TIMEOUT_S
    while not finished["done"] and time.time() < deadline:
        if proc.poll() is not None:
            fail(f"server process exited early (code={proc.returncode}) before checks completed")
            return
        time.sleep(0.1)

    if not finished["done"]:
        fail(f"did not complete the verification sequence within {TIMEOUT_S}s")


if __name__ == "__main__":
    main()
