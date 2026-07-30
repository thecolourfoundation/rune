# Rune (Python distribution)

The same Software Intelligence Runtime as the [JS/TS package](../README.md), packaged for `pip install` — for teams whose tooling lives in Python (CI, monorepo scripts, internal tooling) who'd rather not require Node.js just to run Rune against a JS/TS/React/Next.js/Express codebase.

Feature parity with the JS version in v0.1: same fact/derived-understanding model, same React/Next.js/Express detection, same MCP tool surface, same documented limitations (heuristic regex-based extraction, no cross-file Express route-prefix resolution, dotfiles/secrets never scanned).

## Package name

Published on PyPI as `north-rune`. (`rune` itself and short variants like `rune-sdk`/`runesdk` are unavailable — `runesdk` was rejected outright by PyPI as too similar to the existing `runeq` package.) The CLI command itself is still `rune` — only the package name you `pip install` differs, same as the JS side installs as `@pypl100/rune` but runs as `rune`.

## Install

```bash
pip install north-rune
```

> **Installing both this and the JS package** (`@pypl100/rune` via npm globally) on the same machine means only one `rune` command ends up on your `PATH` — whichever your shell finds first, not whichever you installed most recently. Run `which -a rune` to see if you have both; if so, invoke the one you want by its full path rather than relying on the bare `rune` command.

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
