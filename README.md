# Rune

**The Software Intelligence Runtime.**

Git gave software memory. Docker gave software portability. Kubernetes gave software orchestration. MCP standardized how AI connects to tools.

Rune gives software **persistent, explainable understanding** — so every AI you connect stops rediscovering your codebase from zero and starts asking Rune instead.

Rune doesn't generate code. It doesn't replace your coding assistant. It gives every AI you use a shared, continuously-updated model of your software's architecture, routes, components, and dependencies.

---

## What Rune does

Rune scans your project and builds an **understanding graph** with two distinct layers:

- **Facts** — directly observed things: an import statement, an `app.get(...)` call, a function that returns JSX, a file convention that defines a Next.js route. Every fact records its file, line, and the exact matched source text.
- **Derived understanding** — conclusions built *from* facts: an architecture summary, a unified API surface across Express and Next.js, a component index, file-level dependency relationships. Every derived conclusion lists exactly which facts it's based on.

Nothing in the derived layer is asserted without a traceable path back to evidence. Call `rune explain <id>` (or the `rune_explain` MCP tool) on anything and get the fact chain behind it.

## Install

```bash
npm install rune
```

*(A Python distribution — `pip install rune` — mirroring this scanner is on the roadmap; v0.1 ships the JS/TS implementation first.)*

## Quickstart

```bash
cd your-project
npx rune init      # sets up .rune/ in your project
npx rune scan       # builds the understanding graph
npx rune serve      # starts an MCP server exposing it to any AI client
```

Then point any MCP-compatible client (Claude Desktop, Claude Code, custom agents, etc.) at the `rune serve` process. Every connected AI now shares the same understanding instead of re-deriving it per session.

Example MCP client config entry:

```json
{
  "mcpServers": {
    "rune": {
      "command": "npx",
      "args": ["rune", "serve", "/absolute/path/to/your-project"]
    }
  }
}
```

## CLI

| Command | What it does |
|---|---|
| `rune init` | Sets up `.rune/` in the current project |
| `rune scan [dir]` | Builds (or rebuilds) the understanding graph |
| `rune serve [dir]` | Starts the MCP server |
| `rune explain <id>` | Prints the evidence trail behind any fact or conclusion |

## MCP tools exposed

| Tool | Purpose |
|---|---|
| `rune_get_overview` | Architecture summary — start here |
| `rune_list_components` | All detected React components |
| `rune_list_routes` | Unified Express + Next.js route list |
| `rune_search` | Find facts/derived nodes by name, file, or route substring |
| `rune_explain` | Full evidence trail for any id |
| `rune_get_file_dependencies` | Internal import graph for a file |
| `rune_rescan` | Re-scan on demand after code changes |

## v0.1 scope and honest limitations

Rune v0.1 is intentionally narrow:

- **Framework support:** React, Next.js (pages + app router), Express. Everything else gets generic file/import scanning only.
- **Extraction method:** heuristic, regex-based pattern matching — not a full AST parser. This keeps v0.1 dependency-free and fast, and every fact still carries file/line/matched-text evidence, but it will miss unusual code shapes (e.g. components returned via `React.createElement` with no JSX, dynamically constructed route strings, deeply re-exported components). A real AST-based extractor is the natural v0.2 upgrade — the fact schema is designed so extraction method can be swapped without touching anything downstream.
- **No cross-file route-prefix resolution:** an Express route mounted via `app.use('/api', router)` in one file and defined in another isn't stitched into a single path yet.
- **Read-only:** Rune never writes to your source files. It only ever writes its own graph to `.rune/graph.json`.
- **Single-process, stdio MCP transport** in v0.1 — no multi-client daemon yet.

## Why "read-only" and "explainable" are load-bearing, not marketing

Two properties determine whether an AI can trust what Rune tells it:

1. **Read-only** — Rune observes and reasons; it never mutates your code. You stay in control of every change.
2. **Explainable** — every derived conclusion is traceable to the raw facts it came from. If Rune says "this is a Next.js app router project with 12 API routes," you can ask it to show its work.

## Roadmap

- AST-based extraction (swap-in replacement for the regex scanner)
- Python distribution (`pip install rune`)
- Cross-file route resolution
- Data-flow tracing between frontend calls and backend routes
- Incremental re-scan (watch mode) instead of full re-scan

## License

MIT
