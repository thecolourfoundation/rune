import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from rune.graph.build import build_graph, read_graph, RUNE_DIR, GRAPH_FILENAME  # noqa: E402
from rune.graph.derive import derive_understanding  # noqa: E402

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "sample-express")
UNDECLARED_EXPRESS_FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "undeclared-express")


def _clean_rune_dir():
    rune_dir = os.path.join(FIXTURE_DIR, RUNE_DIR)
    if os.path.isdir(rune_dir):
        import shutil

        shutil.rmtree(rune_dir)


class ScanTests(unittest.TestCase):
    def tearDown(self):
        _clean_rune_dir()

    def test_detects_express_routes(self):
        graph = build_graph(FIXTURE_DIR)
        routes = [f for f in graph["facts"] if f["type"] == "express_route"]
        methods = sorted(f"{r['method']} {r['routePath']}" for r in routes)
        self.assertIn("GET /health", methods)
        self.assertIn("GET /", methods)
        self.assertIn("POST /", methods)

    def test_detects_react_component_and_hook(self):
        graph = build_graph(FIXTURE_DIR)
        components = [f for f in graph["facts"] if f["type"] == "react_component"]
        self.assertTrue(any(c["name"] == "UserCard" for c in components))
        hooks = [f for f in graph["facts"] if f["type"] == "hook_usage"]
        self.assertTrue(any(h["name"] == "useState" for h in hooks))

    def test_every_derived_node_traceable(self):
        graph = build_graph(FIXTURE_DIR)
        fact_ids = {f["id"] for f in graph["facts"]}
        for node in graph["derived"]:
            for fid in node.get("basedOn", []):
                self.assertIn(fid, fact_ids, f"derived node {node['id']} references unknown fact id {fid}")

    def test_never_scans_dotfiles_like_env_js(self):
        graph = build_graph(FIXTURE_DIR)
        dumped = json.dumps(graph)
        self.assertNotIn("supersecretpassword", dumped, ".env.js secret leaked into the understanding graph")
        self.assertFalse(any(".env" in (f.get("file") or "") for f in graph["facts"]), ".env.js should never be scanned")

    def test_does_not_misdetect_generics_as_jsx(self):
        graph = build_graph(FIXTURE_DIR)
        false_positive = next(
            (f for f in graph["facts"] if f["type"] == "react_component" and f["name"] == "NotAComponent"), None
        )
        self.assertIsNone(false_positive, "generic syntax should not be detected as a JSX-returning component")

    def test_read_graph_returns_none_on_corrupted_json(self):
        rune_dir = os.path.join(FIXTURE_DIR, RUNE_DIR)
        os.makedirs(rune_dir, exist_ok=True)
        graph_path = os.path.join(rune_dir, GRAPH_FILENAME)
        with open(graph_path, "w", encoding="utf-8") as f:
            f.write("{ this is not valid json")

        result = read_graph(FIXTURE_DIR)
        self.assertIsNone(result)

    def test_line_numbers_match_source(self):
        graph = build_graph(FIXTURE_DIR)
        user_card_facts = [f for f in graph["facts"] if f["file"] == os.path.join("components", "UserCard.jsx")]
        import_fact = next((f for f in user_card_facts if f["type"] == "import" and f["target"] == "react"), None)
        self.assertIsNotNone(import_fact)
        self.assertEqual(import_fact["line"], 1)

        component_fact = next(
            (f for f in user_card_facts if f["type"] == "react_component" and f["name"] == "UserCard"), None
        )
        self.assertIsNotNone(component_fact)
        self.assertEqual(component_fact["line"], 3)

    def test_architecture_summary_includes_stack_and_project_name(self):
        graph = build_graph(FIXTURE_DIR)
        summary = next((d for d in graph["derived"] if d["type"] == "architecture_summary"), None)
        self.assertIsNotNone(summary)
        self.assertIn("Express", summary["description"])
        self.assertIn("sample-express-fixture", summary["description"])

    def test_build_graph_raises_on_nonexistent_directory(self):
        with self.assertRaises(ValueError):
            build_graph(os.path.join(os.path.dirname(__file__), "fixtures", "definitely-does-not-exist"))

    def test_fact_ids_unique_and_reset_per_scan(self):
        graph_a = build_graph(FIXTURE_DIR)
        graph_b = build_graph(FIXTURE_DIR)

        ids_a = [f["id"] for f in graph_a["facts"]]
        self.assertEqual(len(set(ids_a)), len(ids_a), "fact ids must be unique within a single scan")

        component_a = next(f for f in graph_a["facts"] if f["type"] == "react_component" and f["name"] == "UserCard")
        component_b = next(f for f in graph_b["facts"] if f["type"] == "react_component" and f["name"] == "UserCard")
        self.assertEqual(component_a["id"], component_b["id"])

    def test_config_ignore_list_excludes_directories(self):
        rune_dir = os.path.join(FIXTURE_DIR, RUNE_DIR)

        before = build_graph(FIXTURE_DIR)
        self.assertTrue(any("UserCard" in (f.get("file") or "") for f in before["facts"]))

        os.makedirs(rune_dir, exist_ok=True)
        with open(os.path.join(rune_dir, "config.json"), "w", encoding="utf-8") as f:
            json.dump({"ignore": ["components"], "version": 1}, f)

        after = build_graph(FIXTURE_DIR)
        self.assertFalse(any("UserCard" in (f.get("file") or "") for f in after["facts"]))

    def test_version_matches_pyproject(self):
        graph = build_graph(FIXTURE_DIR)
        pyproject_path = os.path.join(os.path.dirname(__file__), "..", "pyproject.toml")
        with open(pyproject_path, "r", encoding="utf-8") as f:
            text = f.read()
        expected = None
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("version"):
                expected = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
        self.assertIsNotNone(expected)
        self.assertEqual(graph["meta"]["rune"], expected)

    def test_dependson_deduplicated(self):
        facts = [
            {"id": "import_1", "type": "import", "file": "a.js", "target": "./util"},
            {"id": "import_2", "type": "import", "file": "a.js", "target": "./util"},
        ]
        derived = derive_understanding(facts, {"has_next": False, "has_express": False, "has_react": False, "pkg": {}})
        dep = next(d for d in derived if d["type"] == "file_dependency" and d["file"] == "a.js")
        self.assertEqual(dep["dependsOn"], ["./util"])

    def test_public_api_importable(self):
        import rune

        self.assertTrue(callable(rune.build_graph))
        self.assertTrue(callable(rune.get_version))
        graph = rune.build_graph(FIXTURE_DIR)
        self.assertGreater(len(graph["facts"]), 0)

    def test_detects_express_routes_even_when_package_json_omits_express(self):
        # Discovered via real-world testing, not the curated fixture: a real
        # repo imported express directly without declaring it in
        # package.json. Route extraction used to be gated entirely behind
        # the package.json signal, so this silently produced zero route
        # facts despite real app.get()/app.listen() calls in the source.
        graph = build_graph(UNDECLARED_EXPRESS_FIXTURE_DIR)

        routes = [f for f in graph["facts"] if f["type"] == "express_route"]
        self.assertTrue(any(r["method"] == "GET" and r["routePath"] == "/status" for r in routes))

        summary = next((d for d in graph["derived"] if d["type"] == "architecture_summary"), None)
        self.assertIn("Express", summary["description"])


if __name__ == "__main__":
    unittest.main()
