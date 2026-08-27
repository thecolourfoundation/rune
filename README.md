Rune

Persistent codebase intelligence for AI coding agents

Rune continuously maps your codebase and exposes an evidence-backed understanding through MCP, enabling AI agents to work with your software without rebuilding context from scratch.

Claude Code · Cursor · Codex · Claude Desktop · MCP

""License" (https://img.shields.io/badge/license-MIT-blue.svg)" (LICENSE)

---

Why Rune?

AI coding agents are powerful.

But every new session has the same problem:

«They have to rediscover your codebase.»

They read files, reconstruct context, infer relationships, and build a mental model of your project before they can reliably answer questions.

Rune gives AI agents a persistent, queryable understanding of your codebase.

Without Rune| With Rune
AI rereads the repository| AI queries an existing understanding
Context is rebuilt every session| Understanding persists
Each agent builds its own mental model| Agents can query the same project model
Answers can be difficult to verify| Answers can point to source evidence
Manual rescanning| "rune watch" keeps the model current

«One codebase. One persistent understanding. Many AI agents.»

---

See It in Action

Ask your AI agent:

«Where is the "UserCard" component defined?»

Rune can provide:

UserCard
├── type: react_component
├── file: components/UserCard.jsx
├── line: 3
└── evidence:
    export function UserCard({ user }) {

The value isn't only the answer.

It's the evidence behind the answer.

Rune is designed to make code intelligence inspectable rather than blindly trusted.

---

Get Started

Installation

Node.js

npm install -g @pypl100/rune

Python

pip install north-rune

Both distributions provide the "rune" CLI.

«Note: If both distributions are installed globally, your shell will use whichever "rune" executable appears first on your "PATH". Run "which -a rune" to see which executable is being used.»

---

Quickstart

Navigate to your project:

cd your-project

Initialize Rune:

rune init

Start the watcher:

rune watch &

Start the MCP server:

rune serve

Rune will now maintain an understanding of your project and expose it to compatible AI clients through MCP.

One-time scan

Don't need continuous monitoring?

rune scan .

---

How Rune Works

                    YOUR CODEBASE
                         │
                         ▼
                   ┌───────────┐
                   │   Rune    │
                   │  Scanner  │
                   └─────┬─────┘
                         │
                         ▼
                UNDERSTANDING GRAPH
                         │
                  ┌──────┴──────┐
                  │             │
                FACTS        DERIVED
                           UNDERSTANDING
                  │             │
                  └──────┬──────┘
                         │
                         ▼
                    MCP SERVER
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
      Claude Code      Cursor         Codex

Facts → Understanding → Evidence

Rune separates facts from derived understanding.

A fact might look like:

components/UserCard.jsx
line 3
defines UserCard

A derived conclusion can be constructed from multiple facts.

The result is an inspectable chain:

Source
  ↓
Fact
  ↓
Understanding
  ↓
AI answer
  ↓
Evidence

---

AI Agent Integration

Rune is designed for workflows where multiple AI agents need to understand the same codebase.

Supported MCP Clients

- Claude Code
- Cursor
- Codex
- Claude Desktop
- Custom MCP clients

Instead of requiring every agent to reconstruct the repository independently, Rune provides a shared project understanding through MCP.

---

Connect Rune Through MCP

Rune exposes its codebase understanding through the Model Context Protocol.

Example configuration:

{
  "mcpServers": {
    "rune": {
      "command": "npx",
      "args": [
        "-p",
        "@pypl100/rune",
        "rune",
        "serve",
        "/absolute/path/to/your-project"
      ]
    }
  }
}

Once connected, your AI client can query Rune's understanding of the project.

---

What Rune Understands

Rune currently focuses on common JavaScript and TypeScript application structures.

Frameworks

- React
- Next.js
- Express

Code Intelligence

- React components
- Next.js pages
- Next.js App Router routes
- Express routes
- File relationships
- Import relationships
- Codebase facts
- Derived conclusions
- Source evidence

Support is intentionally focused while the project continues to evolve.

---

Evidence-Backed Answers

Most AI systems provide an answer.

Rune aims to provide:

«The answer + the evidence supporting it.»

For example:

Conclusion
──────────
User authentication is handled by the auth middleware.

Evidence
────────
middleware/auth.js:7
middleware/auth.js:18

Matched source
──────────────
export function authenticate(req, res, next) {

This makes it easier to inspect what Rune believes and why.

«Don't just give the AI an answer. Give it the evidence behind the answer.»

---

MCP Tools

Rune exposes tools for querying the project's understanding.

Tool| Purpose
"rune_get_overview"| Get an architecture overview
"rune_list_components"| List detected React components
"rune_list_routes"| List Express and Next.js routes
"rune_search"| Search project facts and derived nodes
"rune_explain"| Inspect the evidence behind a conclusion
"rune_get_file_dependencies"| Inspect file imports/dependencies
"rune_rescan"| Rebuild the understanding after changes

---

CLI Reference

Command| Description
"rune init [dir]"| Initialize Rune in a project
"rune scan [dir]"| Perform a one-time scan
"rune watch [dir]"| Watch for changes and rebuild
"rune serve [dir]"| Start the MCP server
"rune explain <id>"| Show evidence for a node
"rune --version"| Show the installed version

---

Trust & Safety

Read-Only by Design

Rune does not modify your source code.

It maintains its own project data under:

.rune/

Your source remains yours.

Rune's role is simple:

«Read. Understand. Explain.»

If you expose Rune's generated graph or source evidence to an AI client, remember that it may contain information from your codebase.

---

Why Evidence Matters

AI-generated answers can sound convincing even when they're wrong.

Rune's approach is different:

             AI ANSWER
                 │
                 ▼
             CONCLUSION
                 │
                 ▼
              EVIDENCE
                 │
          ┌──────┴──────┐
          ▼             ▼
       FILE            LINE

The goal isn't to make AI magically infallible.

The goal is to make its understanding inspectable.

---

Who Is Rune For?

Rune is built for developers who:

- Use AI coding agents regularly
- Work on large or unfamiliar codebases
- Switch between multiple AI coding tools
- Build MCP-based developer workflows
- Want persistent project context
- Want AI answers that can be traced back to source

Rune Becomes More Useful As Your Project Grows

Project gets bigger
        ↓
Context becomes harder to maintain
        ↓
More AI agents enter the workflow
        ↓
Each agent needs to understand the same code
        ↓
Rune becomes the shared understanding layer

---

What Rune Is Not

Rune is not:

- An autonomous coding agent
- An IDE replacement
- A general-purpose static analyzer
- A compiler
- A full security scanner
- A system that silently modifies your source

Rune focuses on one problem:

«Helping AI agents understand an existing codebase through persistent, inspectable context.»

---

Current Status

Rune is early-stage software.

The scanner currently uses lightweight, heuristic, and regex-based extraction rather than a complete AST parser.

This keeps the system lightweight and fast while preserving file, line, and evidence information.

It also means some unusual code patterns may not yet be detected.

Examples include:

- Components created without recognizable JSX patterns
- Dynamically constructed routes
- Complex re-export chains
- Framework-specific patterns outside current support

If Rune produces an incorrect result, please open an issue.

Real-world codebases are essential to improving the extractor.

---

Roadmap

Intelligence

- [ ] AST-based extraction
- [ ] Deeper cross-file reasoning
- [ ] Cross-file route resolution
- [ ] Frontend → backend data-flow tracing
- [ ] Broader framework support
- [ ] Broader language support

Runtime

- [ ] True incremental rescanning
- [ ] Faster graph updates
- [ ] More MCP query capabilities
- [ ] More client integrations

Trust

- [ ] Richer evidence trails
- [ ] Evidence-backed suggestions
- [ ] Reviewable dependency insights
- [ ] Security-aware codebase analysis

«Read first. Understand. Explain. Never silently modify your code.»

---

Current Limitations

Rune is intentionally early-stage and focused.

Known limitations include:

- Limited framework coverage
- Extraction that relies partly on heuristics
- Cross-file Express route prefixes that are not fully resolved
- "rune watch" currently performs a full rebuild after changes rather than a true incremental diff
- MCP currently uses a single-process stdio transport

These limitations are part of the current development roadmap.

---

Development

Clone

git clone https://github.com/thecolourfoundation/rune.git
cd rune

Install Dependencies

npm install

Run Tests

npm test

Verify MCP

npm run verify:mcp

Or test against a real project:

npm run verify:mcp -- /path/to/your-project

---

Contributing

Rune is early-stage software.

If you're building with AI coding agents, MCP, developer tooling, or code intelligence, real-world feedback is valuable.

Useful Contributions

- Report extraction bugs
- Add tests and fixtures
- Improve framework detection
- Improve MCP tools
- Add evidence-backed queries
- Test Rune against real-world repositories
- Improve documentation

Found something Rune doesn't understand?

Show us the code.

That's how we improve the understanding layer.

---

Philosophy

AI doesn't need another tool that pretends to know everything.

It needs better access to the software it's working on.

Rune is built around a simple idea:

Understand the codebase.
Keep that understanding current.
Make the reasoning inspectable.
Give the evidence to the agent.

Rune is the context layer between your codebase and your AI agents.

---

License

MIT
