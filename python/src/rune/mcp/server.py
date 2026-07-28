"""
Starts an MCP server (stdio transport, FastMCP's default) exposing the
current project's understanding as tools any MCP-compatible AI client can
call.

Deliberately uses explicit @mcp.tool()-decorated functions rather than a
dynamically-built list of tool definitions (which is how the JS side's
tools.js works) — the officially documented decorator pattern is the most
version-stable API surface for the Python SDK, and this is the one part of
the Python port that can't be checked without a real `pip install` and a
live MCP client, so it deliberately takes the safest, best-documented path.
"""

from mcp.server.fastmcp import FastMCP

from ..graph.build import read_graph, build_graph, write_graph
from ..version import get_version


def create_server(root_dir: str) -> FastMCP:
    mcp = FastMCP("rune")

    state = {"graph": read_graph(root_dir)}

    def get_graph() -> dict:
        if state["graph"] is None:
            state["graph"] = build_graph(root_dir)
            write_graph(root_dir, state["graph"])
        return state["graph"]

    @mcp.tool()
    def rune_get_overview() -> dict:
        """Get a high-level architecture summary of the software: detected
        stack, component count, route count. Start here."""
        graph = get_graph()
        summary = next((d for d in graph["derived"] if d["type"] == "architecture_summary"), None)
        return {"meta": graph["meta"], "summary": summary}

    @mcp.tool()
    def rune_list_components() -> dict:
        """List all React components Rune has identified, with file
        location and detection kind (function/class)."""
        graph = get_graph()
        index = next((d for d in graph["derived"] if d["type"] == "component_index"), None)
        return {"components": (index or {}).get("components", [])}

    @mcp.tool()
    def rune_list_routes() -> dict:
        """List all API/page routes Rune has identified across Express and
        Next.js (pages + app router)."""
        graph = get_graph()
        surface = next((d for d in graph["derived"] if d["type"] == "api_surface"), None)
        page_routes = [f for f in graph["facts"] if f["type"] == "next_page_route"]
        return {
            "apiRoutes": (surface or {}).get("routes", []),
            "pageRoutes": [{"path": r["routePath"], "file": r["file"]} for r in page_routes],
        }

    @mcp.tool()
    def rune_search(query: str) -> dict:
        """Search facts and derived understanding by name, file path, or
        route path substring. Use this to find where something lives
        before reading files directly."""
        if not query or not query.strip():
            raise ValueError("query must not be empty")
        graph = get_graph()
        q = query.lower()

        def matches(f: dict) -> bool:
            for key in ("name", "file", "routePath", "target"):
                v = f.get(key)
                if isinstance(v, str) and q in v.lower():
                    return True
            return False

        match_facts = [f for f in graph["facts"] if matches(f)]
        return {"matches": match_facts[:50], "totalMatches": len(match_facts)}

    @mcp.tool()
    def rune_explain(id: str) -> dict:
        """Given a fact or derived-conclusion id (as returned by other
        rune_ tools), return the full evidence trail: the raw fact(s) it's
        based on, file, line, and matched source text."""
        if not id or not id.strip():
            raise ValueError("id must not be empty")
        graph = get_graph()

        fact = next((f for f in graph["facts"] if f["id"] == id), None)
        if fact:
            return {"kind": "fact", **fact}

        derived_node = next((d for d in graph["derived"] if d["id"] == id), None)
        if derived_node:
            based_on = derived_node.get("basedOn") or []
            evidence_chain = [f for f in (
                next((f for f in graph["facts"] if f["id"] == fid), None) for fid in based_on
            ) if f is not None]
            return {"kind": "derived", **derived_node, "evidenceChain": evidence_chain}

        return {"error": f'No fact or derived node found with id "{id}"'}

    @mcp.tool()
    def rune_get_file_dependencies(file: str) -> dict:
        """Get the internal (relative-import) dependency list for a given
        file path, as recorded in the understanding graph."""
        if not file or not file.strip():
            raise ValueError("file must not be empty")
        graph = get_graph()
        node = next(
            (d for d in graph["derived"] if d["type"] == "file_dependency" and d["file"] == file), None
        )
        return node or {"file": file, "dependsOn": [], "note": "No recorded internal dependencies for this file."}

    @mcp.tool()
    def rune_rescan() -> dict:
        """Re-scan the project from disk and refresh Rune's understanding
        graph. Call this after significant code changes."""
        state["graph"] = build_graph(root_dir)
        write_graph(root_dir, state["graph"])
        return {"status": "rescanned", "fileCount": state["graph"]["meta"]["fileCount"]}

    return mcp


def start_server(root_dir: str) -> None:
    server = create_server(root_dir)
    server.run()  # stdio transport by default
