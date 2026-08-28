# Rune

**Persistent codebase intelligence for AI coding agents**

Rune continuously maps your codebase and exposes an evidence-backed understanding through MCP, enabling AI agents to work with your software without rebuilding context from scratch.

Claude Code · Cursor · Codex · Claude Desktop · MCP

![License](https://img.shields.io/badge/license-MIT-blue.svg)

---

## Why Rune?

AI coding agents are powerful.

But every new session has the same problem:

**They have to rediscover your codebase.**

They read files, reconstruct context, infer relationships, and build a mental model of your project before they can reliably answer questions.

Rune gives AI agents a persistent, queryable understanding of your codebase.

| Without Rune | With Rune |
|---|---|
| AI rereads the repository | AI queries an existing understanding |
| Context is rebuilt every session | Understanding persists |
| Each agent builds its own mental model | Agents can query the same project model |
| Answers can be difficult to verify | Answers can point to source evidence |
| Manual rescanning | `rune watch` keeps the model current |

**One codebase. One persistent understanding. Many AI agents.**

---

## See It in Action

Ask your AI agent:

**"Where is the `UserCard` component defined?"**

Rune can provide:

```
UserCard
├── type: react_component
├── file: components/UserCard.jsx
├── line: 3
└── evidence:
    export function UserCard({ user }) {
```

The value isn't only the answer. It's the evidence behind the answer.

Rune is designed to make code intelligence inspectable rather than blindly trusted.

---

## Get Started

### Installation

**Node.js**
```bash
npm install -g @moosl/rune
```

**Python**
```bash
pip install north-rune
```

Both distributions provide the `rune` CLI.

> **Note:** If both distributions are installed globally, your shell will use whichever `rune` executable appears first on your `PATH`. Run `which -a rune` to see which executable is being used.

---

## Quickstart

```bash
cd your-project
rune init      # sets up Rune in your project
rune watch &    # keeps the understanding current in the background
rune serve      # starts the MCP server
```

Rune will now maintain an understanding of your project and expose it to compatible AI clients through MCP.

**One-time scan** (no continuous monitoring needed):
```bash
rune scan .
```

---

## How Rune Works

```
                    YOUR CODEBASE
                         |
                         v
                   +-----------+
                   |   Rune    |
                   |  Scanner  |
                   +-----+-----+
                         |
                         v
                UNDERSTANDING GRAPH
                         |
         +---------------+---------------+
         |               |               |
       FACTS         DERIVED         SECURITY
                   UNDERSTANDING      FINDINGS
         |               |               |
         +---------------+---------------+
                         |
                         v
                    MCP SERVER
                         |
          +--------------+--------------+
          v              v              v
      Claude Code      Cursor         Codex
```

### Facts -> Understanding -> Evidence

Rune separates facts from derived understanding.

A fact might look like:
```
components/UserCard.jsx
line 3
defines UserCard
```

A derived conclusion is constructed from multiple facts. The result is an inspectable chain:

```
Source -> Fact -> Understanding -> AI answer -> Evidence
```

Call `rune explain <id>` (or the `rune_explain` MCP tool) on anything and get that chain back.

---

## Security Detectors

Beyond structural understanding, Rune does a static-analysis pass for common security regressions -- same evidence-traced model as everything else: every finding cites file, line, and matched text.

| Detector | Catches | Severity range |
|---|---|---|
| Secret exposure | Hardcoded AWS/GitHub/Stripe/Slack keys, private key blocks | medium - critical |
| Dangerous shell exec | Dynamic command construction reaching `exec`/`execSync`/`spawn` -- not just any use of these functions | high |
| CI/CD workflow risk | Dangerous GitHub Actions permissions, the "pwn request" pattern | medium - critical |
| Dependency typosquat | Package names closely resembling popular packages (e.g. `expres` vs `express`) | medium (static-only) |

All four are deliberately conservative and context-aware: findings inside test/fixture files or a detector's own pattern-definition code are automatically downgraded, never silently hidden. Each detector has its own test suite covering both true- and false-positive cases.

---

## Project Memory

Rune can record durable, project-specific knowledge that survives across sessions, separate from the code-understanding graph:

- **Project memory** -- conventions, required commands, known pitfalls
- **Experience log** -- a history of what was tried on a task and whether it worked

Nothing is trusted automatically. Every new entry starts as `proposed`; a human must explicitly `approve` it before it's surfaced to an AI client as reliable -- enforced in code, not just policy.

```bash
rune memory add "Tests live in test/, not __tests__/"
rune memory approve <id>
rune experience add "Added a field to the user form" --outcome=success
```

---

## AI Agent Integration

Rune is designed for workflows where multiple AI agents need to understand the same codebase.

**Supported MCP Clients:** Claude Code · Cursor · Codex · Claude Desktop · Custom MCP clients

Instead of requiring every agent to reconstruct the repository independently, Rune provides a shared project understanding through MCP.

### Connect Rune Through MCP

```json
{
  "mcpServers": {
    "rune": {
      "command": "npx",
      "args": ["-p", "@moosl/rune", "rune", "serve", "/absolute/path/to/your-project"]
    }
  }
}
```

---

## What Rune Understands

Rune currently focuses on common JavaScript and TypeScript application structures.

**Frameworks:** React · Next.js · Express

**Code Intelligence:**
- React components, hooks, and imports -- extracted via a real AST parser (Babel), not regex
- Express routes and Next.js page/App Router routes -- currently regex/pattern-based; AST extraction for routes is next on the roadmap
- File and import relationships
- Security findings (secrets, shell exec, CI/CD risk, dependency typosquats)
- Derived conclusions and source evidence for all of the above

Support is intentionally focused while the project continues to evolve.

---

## Evidence-Backed Answers

Most AI systems provide an answer. Rune aims to provide:

**The answer + the evidence supporting it.**

```
Conclusion
----------
User authentication is handled by the auth middleware.

Evidence
--------
middleware/auth.js:7
middleware/auth.js:18

Matched source
--------------
export function authenticate(req, res, next) {
```

**Don't just give the AI an answer. Give it the evidence behind the answer.**

---

## MCP Tools

| Tool | Purpose |
|---|---|
| `rune_get_overview` | Architecture summary |
| `rune_list_components` | All detected React components |
| `rune_list_routes` | Express and Next.js routes |
| `rune_search` | Search facts and derived nodes |
| `rune_explain` | Full evidence trail for any id |
| `rune_get_file_dependencies` | Internal import graph for a file |
| `rune_get_memory` | Project conventions and rules (with approval status) |
| `rune_get_experience` | History of past task attempts and outcomes |
| `rune_rescan` | Re-scan on demand after code changes |

---

## CLI Reference

| Command | Description |
|---|---|
| `rune init [dir]` | Initialize Rune in a project |
| `rune scan [dir]` | One-time scan (`--timeout=<seconds>` to bound scan time on very large repos) |
| `rune watch [dir]` | Watch for changes and rebuild |
| `rune serve [dir]` | Start the MCP server |
| `rune explain <id>` | Show evidence for a fact or finding |
| `rune memory add/list/approve/reject` | Manage project memory |
| `rune experience add/list` | Log and review past task outcomes |
| `rune --version` | Show the installed version |

---

## Trust & Safety

### Read-Only by Design

Rune does not modify your source code. It maintains its own project data under `.rune/`. Your source remains yours.

Rune's role is simple: **Read. Understand. Explain. Suggest -- never silently modify.**

If you share Rune's generated graph or memory files with an AI client, remember they may contain information from your codebase -- treat them like any other file that quotes snippets of your source.

### Coverage & Reliability

A single malformed or unusual file can't take down an entire scan -- parsing failures are caught per-file, logged, and the scan continues. Scan results report real coverage (files discovered vs. supported vs. scanned vs. failed), and a repository with no supported source files is reported honestly as such rather than as a clean "no findings."

---

## Who Is Rune For?

Rune is built for developers who:
- Use AI coding agents regularly
- Work on large or unfamiliar codebases
- Switch between multiple AI coding tools
- Build MCP-based developer workflows
- Want AI answers that can be traced back to source

---

## What Rune Is Not

Rune is not:
- An autonomous coding agent
- An IDE replacement
- A general-purpose static analyzer or compiler
- A comprehensive security scanner with a live CVE database (today's dependency check is static-only, by design)
- A system that silently modifies your source or auto-trusts what it learns

Rune focuses on one problem: **helping AI agents understand an existing codebase through persistent, inspectable context** -- with a security layer built on the same evidence-first principle.

---

## Current Status & Limitations

Rune is early-stage software, under active, test-driven development.

- **Extraction:** component/import/hook detection uses a real AST parser (Babel). Route detection (Express, Next.js) is still regex/pattern-based -- the next piece moving to AST.
- **Security detectors are static-analysis only** -- no live CVE feed, no runtime observation.
- **No cross-file Express route-prefix resolution** yet.
- **Memory is recorded manually** via CLI/MCP calls today; automatic pattern proposal from accumulated experience is designed but not yet built.
- **Single-process, stdio MCP transport** -- no multi-client daemon yet.
- **`rune watch`** performs a full rebuild on every change, not a true incremental diff.

If Rune produces an incorrect result, please open an issue -- real-world codebases are what improve the extractor and detectors.

---

## Roadmap

- AST-based extraction for route detection (Express, Next.js)
- Cross-file route resolution
- Frontend -> backend data-flow tracing
- True incremental re-scan
- Additional security detectors: authN/authZ weakening, disabled security checks, dangerous config values, live CVE/registry-backed dependency checks
- Automatic memory pattern detection -- proposing new rules from accumulated experience, always requiring human approval

---

## Development

```bash
git clone https://github.com/thecolourfoundation/rune.git
cd rune
npm install
npm test
npm run verify:mcp
# or against a real project:
npm run verify:mcp -- /path/to/your-project
```

---

## Contributing

Rune is early-stage software. If you're building with AI coding agents, MCP, developer tooling, or code intelligence, real-world feedback is valuable.

**Useful contributions:** report extraction/detection bugs, add tests and fixtures, improve framework detection, test Rune against real-world repositories, improve documentation.

Found something Rune gets wrong? Show us the code -- that's how the understanding layer improves.

---

## Philosophy

AI doesn't need another tool that pretends to know everything. It needs better access to the software it's working on.

Rune is built around a simple idea:

Understand the codebase. Keep that understanding current. Make the reasoning inspectable. Give the evidence to the agent.

Rune is the context layer between your codebase and your AI agents.

---

## License

MIT

---

If you want to support the circus: ETH `0xbc0979dde621c353737d21f6d7b4eb361f7bc11f`
