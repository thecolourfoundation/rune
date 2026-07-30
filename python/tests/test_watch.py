import json
import os
import shutil
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from rune.graph.build import build_graph, write_graph, create_live_graph_reader, RUNE_DIR, GRAPH_FILENAME  # noqa: E402
from rune.watch import start_watch  # noqa: E402


def _make_temp_project() -> str:
    d = tempfile.mkdtemp(prefix="rune-watch-test-")
    with open(os.path.join(d, "package.json"), "w", encoding="utf-8") as f:
        json.dump({"name": "watch-fixture", "dependencies": {}}, f)
    with open(os.path.join(d, "index.js"), "w", encoding="utf-8") as f:
        f.write("console.log('hello');\n")
    return d


class LiveGraphReaderTests(unittest.TestCase):
    def test_reloads_when_graph_file_mtime_changes(self):
        d = _make_temp_project()
        try:
            graph1 = build_graph(d)
            write_graph(d, graph1)

            get_graph = create_live_graph_reader(d)
            first = get_graph()
            self.assertEqual(first["meta"]["fileCount"], 1)

            with open(os.path.join(d, "second.js"), "w", encoding="utf-8") as f:
                f.write("module.exports = {};\n")
            graph2 = build_graph(d)
            write_graph(d, graph2)
            future = time.time() + 5
            os.utime(os.path.join(d, RUNE_DIR, GRAPH_FILENAME), (future, future))

            second = get_graph()
            self.assertEqual(second["meta"]["fileCount"], 2)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_builds_graph_on_first_call_if_none_exists(self):
        d = _make_temp_project()
        try:
            get_graph = create_live_graph_reader(d)
            graph = get_graph()
            self.assertEqual(graph["meta"]["fileCount"], 1)
            self.assertTrue(os.path.exists(os.path.join(d, RUNE_DIR, GRAPH_FILENAME)))
        finally:
            shutil.rmtree(d, ignore_errors=True)


class WatchModeTests(unittest.TestCase):
    def test_initial_scan_runs_immediately(self):
        d = _make_temp_project()
        rebuilds = []
        handle = start_watch(d, poll_interval=0.1, on_rebuild=rebuilds.append)
        try:
            deadline = time.time() + 3
            while time.time() < deadline and not rebuilds:
                time.sleep(0.05)
            self.assertEqual(len(rebuilds), 1)
            self.assertEqual(rebuilds[0]["reason"], "initial")
            self.assertTrue(rebuilds[0]["ok"])
            self.assertEqual(rebuilds[0]["graph"]["meta"]["fileCount"], 1)
        finally:
            handle.stop()
            shutil.rmtree(d, ignore_errors=True)

    def test_rebuilds_when_a_source_file_changes(self):
        d = _make_temp_project()
        rebuilds = []
        handle = start_watch(d, poll_interval=0.1, on_rebuild=rebuilds.append)
        try:
            deadline = time.time() + 2
            while time.time() < deadline and not rebuilds:
                time.sleep(0.05)

            with open(os.path.join(d, "added.js"), "w", encoding="utf-8") as f:
                f.write("exports.x = 1;\n")

            deadline = time.time() + 5
            while time.time() < deadline and len(rebuilds) < 2:
                time.sleep(0.05)

            self.assertGreaterEqual(len(rebuilds), 2)
            latest = rebuilds[-1]
            self.assertTrue(latest["ok"])
            self.assertEqual(latest["graph"]["meta"]["fileCount"], 2)
        finally:
            handle.stop()
            shutil.rmtree(d, ignore_errors=True)

    def test_stop_actually_stops_further_rebuilds(self):
        d = _make_temp_project()
        rebuilds = []
        handle = start_watch(d, poll_interval=0.1, on_rebuild=rebuilds.append)
        try:
            deadline = time.time() + 2
            while time.time() < deadline and not rebuilds:
                time.sleep(0.05)

            handle.stop()
            count_at_stop = len(rebuilds)

            with open(os.path.join(d, "after-stop.js"), "w", encoding="utf-8") as f:
                f.write("exports.y = 2;\n")
            time.sleep(1)

            self.assertEqual(len(rebuilds), count_at_stop)
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
