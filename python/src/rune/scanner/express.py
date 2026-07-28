import os
import re

from .lines import build_line_index, line_number_at

ROUTE_RE = re.compile(r"""\b(app|router)\.(get|post|put|delete|patch|use|all)\(\s*['"`]([^'"`]+)['"`]""")


def extract_express_routes(file_path: str, content: str, root_dir: str, next_id) -> list[dict]:
    """
    Extracts Express route facts from a file's raw content.
    Heuristic: matches `app.<method>('/path', ...)` and `router.<method>('/path', ...)`.
    Does not resolve router mount prefixes across files in v1 (documented limitation).
    """
    rel_path = os.path.relpath(file_path, root_dir)
    facts: list[dict] = []
    lines = content.split("\n")
    line_offsets = build_line_index(content)

    for m in ROUTE_RE.finditer(content):
        receiver, method, route_path = m.group(1), m.group(2), m.group(3)
        if method == "use" and not route_path.startswith("/"):
            continue
        ln = line_number_at(line_offsets, m.start())
        evidence = lines[ln - 1].strip()[:160] if 1 <= ln <= len(lines) else ""
        facts.append({
            "id": next_id("route"),
            "type": "express_route",
            "method": method.upper(),
            "routePath": route_path,
            "receiver": receiver,
            "file": rel_path,
            "line": ln,
            "evidence": evidence,
        })
    return facts
