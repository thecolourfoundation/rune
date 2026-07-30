"""
Continuous watch mode, mirroring watch/index.js on the JS side. Rebuilds
the understanding graph whenever source files change, instead of requiring
a manual `rune scan` after every edit -- this is what makes Rune a
persistent runtime rather than a CLI you have to remember to re-run.

Implemented as polling rather than OS-level file-system events: Python's
standard library has no portable recursive watch API (unlike Node's
fs.watch), and pulling in a dependency like `watchdog` just for this felt
like the wrong tradeoff for v1. Polling is simple, dependency-free, and
correct -- just less immediate than event-based watching. The poll
interval is the practical equivalent of the JS side's debounce window.
"""

import os
import threading
import time

from .graph.build import build_graph, write_graph
from .scanner.walk import walk_source_files


def _compute_signature(root_dir: str) -> tuple:
    """
    A cheap fingerprint of the watched tree's state: every watchable file's
    path plus its mtime. Comparing this between polls is how changes
    (edits, additions, deletions) are detected without needing OS-level
    file-system event support.
    """
    files = walk_source_files(root_dir)
    entries = []
    for f in files:
        try:
            entries.append((f, os.path.getmtime(f)))
        except OSError:
            continue  # file may have been deleted between listing and stat
    return tuple(sorted(entries))


def start_watch(root_dir: str, poll_interval: float = 0.5, on_rebuild=None):
    """
    Starts a background thread that polls the project directory and
    rebuilds the understanding graph whenever the file signature changes.

    Returns an object with a .stop() method to end the watch loop cleanly.
    """
    stop_event = threading.Event()

    def rebuild(reason: str):
        try:
            graph = build_graph(root_dir)
            write_graph(root_dir, graph)
            if on_rebuild:
                on_rebuild({"ok": True, "graph": graph, "reason": reason})
        except Exception as err:  # noqa: BLE001 - deliberately broad: report, don't crash the watch loop
            if on_rebuild:
                on_rebuild({"ok": False, "error": err, "reason": reason})

    def loop():
        rebuild("initial")
        last_signature = _compute_signature(root_dir)
        while not stop_event.is_set():
            stop_event.wait(poll_interval)
            if stop_event.is_set():
                break
            signature = _compute_signature(root_dir)
            if signature != last_signature:
                last_signature = signature
                rebuild("change")

    thread = threading.Thread(target=loop, daemon=True)
    thread.start()

    class WatchHandle:
        def stop(self):
            stop_event.set()
            thread.join(timeout=poll_interval * 4 + 2)

    return WatchHandle()
