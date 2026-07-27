# Rune

**The Software Intelligence Runtime.**

Rune gives every AI persistent understanding of your software.

No more re-explaining your architecture every session. No more every assistant independently rediscovering the same routes, components, and dependencies. Connect an AI to Rune, and it already understands your codebase — and can show you why.

Rune doesn't generate code. It doesn't replace your coding assistant. It's the layer underneath: the thing every AI you use asks instead of starting from zero.

*Under the hood, Rune continuously builds an evidence-backed understanding of your software and exposes it through MCP — see [How it works](#how-it-works) if you want the internals.*

---

## What Rune does

- **Persistent** — understanding survives past any single session. Scan once, and every AI you connect from then on starts already knowing your software.
- **Shared** — one understanding, many AI clients. Claude, GPT, Gemini, whatever you're running next month — they all ask the same Rune instance instead of maintaining separate, inconsistent mental models of your code.
- **Explainable** — nothing Rune tells an AI is a black box. Ask it to justify any claim and it shows the exact source location behind it.
- **Read-only** — Rune only observes. It never touches your source files.

## How it works

You don't need to think about this to use Rune — it's here for anyone extending or debugging it.

Internally, Rune keeps two distinct layers:

- **Facts** — directly observed things: an import statement, an `app.get(...)` call, a function that returns JSX, a file convention that defines a Next.js route. Every fact records its file, line, and the exact matched source text.
- **Derived understanding** — conclusions built *from* facts: an architecture summary, a unified API surface across Express and Next.js, a component index, file-level dependency relationships. Every conclusion lists exactly which facts it's based on.

Nothing in the derived layer is asserted without a traceable path back to evidence. Call `rune explain <id>` (or the `rune_explain` MCP tool) on anything and get the fact chain behind it. That's the whole trust story: an AI using Rune isn't guessing about your architecture, and neither is Rune.

## Install

```bash
npm install rune
```

*(A Python distribution — `pip install rune` — mirroring this scanner is on the roadmap; v0.1 ships the JS/TS implementation first.)*

## Quickstart

```bash
cd your-project
npx rune init      # sets up Rune in your project
npx rune scan       # builds Rune's understanding of your software
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

## Roadmap

- AST-based extraction (swap-in replacement for the regex scanner)
- Python distribution (`pip install rune`)
- Cross-file route resolution
- Data-flow tracing between frontend calls and backend routes
- Incremental re-scan (watch mode) instead of full re-scan

## License

MIT
