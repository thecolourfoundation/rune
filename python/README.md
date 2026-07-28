# Rune (Python distribution)

The same Software Intelligence Runtime as the [JS/TS package](../README.md), packaged for `pip install` — for teams whose tooling lives in Python (CI, monorepo scripts, internal tooling) who'd rather not require Node.js just to run Rune against a JS/TS/React/Next.js/Express codebase.

Feature parity with the JS version in v0.1: same fact/derived-understanding model, same React/Next.js/Express detection, same MCP tool surface, same documented limitations (heuristic regex-based extraction, no cross-file Express route-prefix resolution, dotfiles/secrets never scanned).

## ⚠️ Package name

This is currently named `rune` in `pyproject.toml` to match the JS package, but the plain `rune` name is very likely already taken or contested on PyPI (there's a cluster of similarly-named packages — `rune-code`, `rune-512`, `runes`, `runeq` — suggesting the exact name isn't free). **Check availability before publishing** and be ready to rename (e.g. `rune-intel`, `software-rune`) if it's taken.

## Install

```bash
pip install rune   # once published — see the naming note above
```

For local development from source:

```bash
cd python
pip install -e .
```

## Quickstart

```bash
cd your-project
rune init
rune scan
rune serve
```

Same CLI shape as the JS version: `rune init [dir]`, `rune scan [dir]`, `rune serve [dir]`, `rune explain <id>`, `rune --version`.

## Requirements

- Python 3.10+
- The `mcp` package (installed automatically as a dependency) for `rune serve`

## Testing

No `pytest` dependency required — the suite runs on Python's built-in `unittest`:

```bash
python -m unittest tests.test_scan -v
```

To verify the live MCP server (the one thing the unit tests can't cover, since it needs the real `mcp` package installed and a real subprocess handshake):

```bash
pip install -e .
python scripts/verify_mcp_server.py
# or against a real project:
python scripts/verify_mcp_server.py /path/to/your-project
```

## Differences from the JS version worth knowing

- The Python `mcp` SDK's tools are defined as explicit `@mcp.tool()`-decorated functions (`src/rune/mcp/server.py`), not a dynamically-built list like the JS side's `tools.js`. This was a deliberate choice: the decorator pattern is the most version-stable, best-documented part of the Python MCP SDK's API, which matters most for the one part of this port that couldn't be tested without a real install.
- ID formatting differs cosmetically (hex counters, same scheme) but the scoping guarantee is identical: ids reset per scan and are unique within a scan.
