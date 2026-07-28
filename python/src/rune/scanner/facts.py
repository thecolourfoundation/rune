import os
import re

from .lines import build_line_index, line_number_at

"""
IMPORTANT — this is a heuristic, regex-based extractor, not a full AST parser.
Every fact records the exact line + matched text as evidence, so conclusions
stay inspectable even though extraction is approximate. Swapping in a real
parser later is a drop-in replacement for this module — the fact schema is
what the rest of Rune depends on, not the method used to produce it.
"""

# Bounded ({0,300}) so a pathological file with many "import"-like substrings
# and no matching "from" can't force long backtracking scans per attempt.
IMPORT_RE = re.compile(r"""import\s+(?:type\s+)?(?:[\w*${}\s,]{0,300}?\s+from\s+)?['"]([^'"]+)['"]""")
REQUIRE_RE = re.compile(r"""require\(\s*['"]([^'"]+)['"]\s*\)""")
FUNCTION_COMPONENT_RE = re.compile(r"""(?:export\s+(?:default\s+)?)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(""")
ARROW_COMPONENT_RE = re.compile(r"""(?:export\s+(?:default\s+)?)?const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:\([^)]*\)|[\w]+)\s*=>""")
CLASS_COMPONENT_RE = re.compile(r"""class\s+([A-Z][A-Za-z0-9_]*)\s+extends\s+(?:React\.)?Component""")
# Requires an actual tag shape (letter followed eventually by whitespace, "/",
# or ">") AND that the "<" isn't immediately preceded by an identifier
# character — which is what distinguishes JSX `<Item>` from a generic type
# `Array<Item>`, since both otherwise look identical to a regex.
JSX_TAG_RE = re.compile(r"""(?<![\w>])<([A-Za-z][\w.]*)[\s/>]""")
HOOK_USAGE_RE = re.compile(r"""\b(use[A-Z][A-Za-z0-9_]*)\s*\(""")

JSX_LOOKAHEAD_WINDOW_LINES = 40
EVIDENCE_MAX_CHARS = 160


def extract_file_facts(file_path: str, content: str, root_dir: str, next_id) -> list[dict]:
    rel_path = os.path.relpath(file_path, root_dir)
    facts: list[dict] = []
    lines = content.split("\n")
    line_offsets = build_line_index(content)

    def line_of(index: int) -> int:
        return line_number_at(line_offsets, index)

    def evidence_at(ln: int) -> str:
        if 1 <= ln <= len(lines):
            return lines[ln - 1].strip()[:EVIDENCE_MAX_CHARS]
        return ""

    # Imports (ESM `import` and CJS `require`)
    for pattern in (IMPORT_RE, REQUIRE_RE):
        for m in pattern.finditer(content):
            ln = line_of(m.start())
            facts.append({
                "id": next_id("import"),
                "type": "import",
                "file": rel_path,
                "line": ln,
                "target": m.group(1),
                "evidence": evidence_at(ln),
            })

    # React components: function declarations and arrow-function assignments
    for pattern in (FUNCTION_COMPONENT_RE, ARROW_COMPONENT_RE):
        for m in pattern.finditer(content):
            ln = line_of(m.start())
            window_text = "\n".join(lines[ln - 1: ln + JSX_LOOKAHEAD_WINDOW_LINES])
            if JSX_TAG_RE.search(window_text):
                facts.append({
                    "id": next_id("component"),
                    "type": "react_component",
                    "kind": "function",
                    "file": rel_path,
                    "line": ln,
                    "name": m.group(1),
                    "evidence": evidence_at(ln),
                })

    # React components: classes
    for m in CLASS_COMPONENT_RE.finditer(content):
        ln = line_of(m.start())
        facts.append({
            "id": next_id("component"),
            "type": "react_component",
            "kind": "class",
            "file": rel_path,
            "line": ln,
            "name": m.group(1),
            "evidence": evidence_at(ln),
        })

    # Hook usage — one fact per distinct hook name per file, not per call site.
    hooks_seen: set[str] = set()
    for m in HOOK_USAGE_RE.finditer(content):
        hook_name = m.group(1)
        if hook_name in hooks_seen:
            continue
        hooks_seen.add(hook_name)
        ln = line_of(m.start())
        facts.append({
            "id": next_id("hook"),
            "type": "hook_usage",
            "file": rel_path,
            "line": ln,
            "name": hook_name,
            "evidence": evidence_at(ln),
        })

    return facts
