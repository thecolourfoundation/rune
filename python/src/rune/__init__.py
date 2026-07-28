"""Rune — the Software Intelligence Runtime (Python distribution).

Mirrors the JS/TS scanner and MCP server so a project can use Rune via
`pip install rune` without needing Node.js installed.
"""

from .graph.build import build_graph, write_graph, read_graph, RUNE_DIR, GRAPH_FILENAME, CONFIG_FILENAME
from .version import get_version

__all__ = [
    "build_graph",
    "write_graph",
    "read_graph",
    "RUNE_DIR",
    "GRAPH_FILENAME",
    "CONFIG_FILENAME",
    "get_version",
]
