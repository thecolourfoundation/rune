import datetime
import json
import os

from ..scanner.walk import walk_source_files, read_file_safe, detect_project_kind
from ..scanner.facts import extract_file_facts
from ..scanner.express import extract_express_routes
from ..scanner.nextjs import extract_next_routes
from ..scanner.id import create_id_generator
from ..version import get_version
from .derive import derive_understanding

RUNE_DIR = ".rune"
GRAPH_FILENAME = "graph.json"
CONFIG_FILENAME = "config.json"


def _read_config(root_dir: str) -> dict:
    """
    Reads .rune/config.json if present (written by `rune init`). Missing or
    malformed config is not an error — it just means default (empty) ignores.
    """
    config_path = os.path.join(root_dir, RUNE_DIR, CONFIG_FILENAME)
    if not os.path.exists(config_path):
        return {"ignore": []}
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            parsed = json.load(f)
        ignore = parsed.get("ignore")
        return {"ignore": ignore if isinstance(ignore, list) else []}
    except (OSError, json.JSONDecodeError) as err:
        print(f"[rune] warning: {config_path} is malformed ({err}). Ignoring it for this scan.")
        return {"ignore": []}


def build_graph(root_dir: str) -> dict:
    if not os.path.isdir(root_dir):
        raise ValueError(f'"{root_dir}" is not a directory. Check the path and try again.')

    config = _read_config(root_dir)
    project_info = detect_project_kind(root_dir)
    files = walk_source_files(root_dir, ignore=config["ignore"])
    next_id = create_id_generator()

    # Route extraction always runs, regardless of what package.json declares.
    # A package.json-only gate here would silently suppress real route facts
    # whenever a codebase uses a framework without declaring it as a direct
    # dependency (e.g. a monorepo where the dependency lives in a different
    # package.json, or code that imports something ahead of updating the
    # manifest). package.json is still read (detect_project_kind) as one
    # signal among several; derive_understanding decides what to report
    # based on the actual facts found, not just the manifest.
    facts: list[dict] = []
    for file_path in files:
        content = read_file_safe(file_path)
        if content is None:
            continue
        facts.extend(extract_file_facts(file_path, content, root_dir, next_id))
        facts.extend(extract_express_routes(file_path, content, root_dir, next_id))

    facts.extend(extract_next_routes(root_dir, next_id))

    derived = derive_understanding(facts, project_info)

    return {
        "meta": {
            "rune": get_version(),
            "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "rootDir": root_dir,
            "fileCount": len(files),
            "stack": {
                "react": project_info["has_react"],
                "next": project_info["has_next"],
                "express": project_info["has_express"],
            },
            "note": (
                "Facts are extracted via heuristic regex-based scanning, not a full AST parser. "
                "Every fact carries file/line/evidence. Every derived node lists the fact ids it is based on."
            ),
        },
        "facts": facts,
        "derived": derived,
    }


def write_graph(root_dir: str, graph: dict) -> str:
    directory = os.path.join(root_dir, RUNE_DIR)
    os.makedirs(directory, exist_ok=True)
    file_path = os.path.join(directory, GRAPH_FILENAME)
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(graph, f, indent=2)
    return file_path


def read_graph(root_dir: str) -> dict | None:
    file_path = os.path.join(root_dir, RUNE_DIR, GRAPH_FILENAME)
    if not os.path.exists(file_path):
        return None
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as err:
        print(f"[rune] warning: {file_path} is corrupted or unreadable ({err}). Run `rune scan` to rebuild it.")
        return None
