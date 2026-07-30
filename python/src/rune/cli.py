import argparse
import json
import os
import sys

from .graph.build import build_graph, write_graph, read_graph, RUNE_DIR, GRAPH_FILENAME, CONFIG_FILENAME
from .version import get_version


def _resolve_dir(dir_arg: str | None) -> str:
    return os.path.abspath(dir_arg or os.getcwd())


def _assert_dir_exists(directory: str) -> None:
    """
    Raises a clear, actionable error if `directory` isn't a real directory,
    instead of letting downstream calls either silently no-op (a missing
    path scanning as "0 files" as if it succeeded) or silently create it.
    """
    if not os.path.isdir(directory):
        raise ValueError(f'"{directory}" is not a directory. Check the path and try again.')


def cmd_init(args: argparse.Namespace) -> None:
    directory = _resolve_dir(args.dir)
    _assert_dir_exists(directory)

    rune_dir = os.path.join(directory, RUNE_DIR)
    os.makedirs(rune_dir, exist_ok=True)

    config_path = os.path.join(rune_dir, CONFIG_FILENAME)
    if not os.path.exists(config_path):
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump({"ignore": [], "version": 1}, f, indent=2)

    gitignore_path = os.path.join(directory, ".gitignore")
    rune_ignore_line = f"{RUNE_DIR}/{GRAPH_FILENAME}"
    ignore_block = f"\n# Rune understanding graph (regenerate with `rune scan`)\n{rune_ignore_line}\n"
    if os.path.exists(gitignore_path):
        with open(gitignore_path, "r", encoding="utf-8") as f:
            content = f.read()
        if rune_ignore_line not in content:
            with open(gitignore_path, "a", encoding="utf-8") as f:
                f.write(ignore_block)
    else:
        with open(gitignore_path, "w", encoding="utf-8") as f:
            f.write(ignore_block.lstrip() + "\n")

    print(f"[rune] initialized at {rune_dir}")
    print(f'[rune] edit {config_path} to add ignore patterns (e.g. "legacy", "vendor").')
    print("[rune] run `rune scan` to build the understanding graph.")


def cmd_scan(args: argparse.Namespace) -> None:
    import time

    directory = _resolve_dir(args.dir)
    _assert_dir_exists(directory)

    start = time.time()
    graph = build_graph(directory)
    file_path = write_graph(directory, graph)
    ms = int((time.time() - start) * 1000)

    print(f"[rune] scanned {graph['meta']['fileCount']} file(s) in {ms}ms")
    print(f"[rune] facts: {len(graph['facts'])}, derived conclusions: {len(graph['derived'])}")
    print(f"[rune] graph written to {file_path}")


def cmd_watch(args: argparse.Namespace) -> None:
    import signal
    import threading

    directory = _resolve_dir(args.dir)
    _assert_dir_exists(directory)

    from .watch import start_watch

    print(f"[rune] watching {directory} for changes (Ctrl+C to stop)...")

    def on_rebuild(result):
        if result["ok"]:
            graph = result["graph"]
            print(f"[rune] rescanned ({result['reason']}) — {len(graph['facts'])} facts, {len(graph['derived'])} derived")
        else:
            print(f"[rune] rescan failed ({result['reason']}): {result['error']}", file=sys.stderr)

    handle = start_watch(directory, on_rebuild=on_rebuild)
    stop_flag = threading.Event()

    def _on_sigint(signum, frame):
        print("\n[rune] stopping watch mode.")
        stop_flag.set()

    signal.signal(signal.SIGINT, _on_sigint)

    while not stop_flag.is_set():
        stop_flag.wait(0.2)

    handle.stop()


def cmd_serve(args: argparse.Namespace) -> None:
    directory = _resolve_dir(args.dir)
    _assert_dir_exists(directory)

    existing = read_graph(directory)
    if not existing:
        print(f"[rune] no graph found — scanning {directory} first...")
        write_graph(directory, build_graph(directory))

    try:
        from .mcp.server import start_server
    except ImportError as err:
        print(f"[rune] a required dependency is missing ({err}). Run `pip install rune` (or `pip install -e .` "
              f"from source) again, then try `rune serve` once more.", file=sys.stderr)
        sys.exit(1)

    start_server(directory)


def cmd_explain(args: argparse.Namespace) -> None:
    directory = _resolve_dir(args.dir)
    _assert_dir_exists(directory)

    graph = read_graph(directory)
    if not graph:
        print("[rune] no graph found. Run `rune scan` first.")
        sys.exit(1)

    fact = next((f for f in graph["facts"] if f["id"] == args.id), None)
    if fact:
        print(json.dumps({"kind": "fact", **fact}, indent=2))
        return

    derived_node = next((d for d in graph["derived"] if d["id"] == args.id), None)
    if derived_node:
        based_on = derived_node.get("basedOn") or []
        evidence_chain = [f for f in (
            next((f for f in graph["facts"] if f["id"] == fid), None) for fid in based_on
        ) if f is not None]
        print(json.dumps({"kind": "derived", **derived_node, "evidenceChain": evidence_chain}, indent=2))
        return

    print(f'[rune] no fact or derived node found with id "{args.id}"')
    sys.exit(1)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="rune", description="Rune — the Software Intelligence Runtime")
    parser.add_argument("--version", action="version", version=get_version())

    subparsers = parser.add_subparsers(dest="command")

    p_init = subparsers.add_parser("init", help="Set up Rune in the current (or given) project")
    p_init.add_argument("dir", nargs="?", default=None)
    p_init.set_defaults(func=cmd_init)

    p_scan = subparsers.add_parser("scan", help="Build (or rebuild) the understanding graph, once")
    p_scan.add_argument("dir", nargs="?", default=None)
    p_scan.set_defaults(func=cmd_scan)

    p_watch = subparsers.add_parser("watch", help="Keep the understanding graph current as files change")
    p_watch.add_argument("dir", nargs="?", default=None)
    p_watch.set_defaults(func=cmd_watch)

    p_serve = subparsers.add_parser("serve", help="Start the MCP server so AI clients can query it")
    p_serve.add_argument("dir", nargs="?", default=None)
    p_serve.set_defaults(func=cmd_serve)

    p_explain = subparsers.add_parser("explain", help="Show the evidence trail behind a fact or conclusion")
    p_explain.add_argument("id")
    p_explain.add_argument("dir", nargs="?", default=None)
    p_explain.set_defaults(func=cmd_explain)

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not getattr(args, "command", None):
        parser.print_help()
        return

    try:
        args.func(args)
    except ValueError as err:
        print(f"[rune] error: {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
