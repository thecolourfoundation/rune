Rune

Persistent codebase intelligence for AI coding agents.

Rune continuously maps your codebase and exposes an evidence-backed understanding through MCP — so AI agents can understand your software without starting from zero every session.

Claude Code · Cursor · Codex · Claude Desktop · MCP

---

Why Rune?

AI coding agents are powerful.

But every new session has the same problem:

They have to rediscover your codebase.

They read files. Rebuild context. Guess relationships. And sometimes give you an answer without making it obvious where that answer came from.

Rune gives your agents a persistent, queryable understanding of your codebase.

Without Rune| With Rune
AI rereads the repository| AI queries an existing understanding
Context is rebuilt every session| Understanding persists
Agents can build different mental models| Agents query the same project model
Answers can be difficult to verify| Answers can point to source evidence
Manual rescanning| "rune watch" keeps the model current

«One codebase. One persistent understanding. Many AI agents.»

---

See it in action

Ask your AI agent:

«"Where is the UserCard component defined?"»

Rune can provide:

UserCard
├── type: react_component
├── file: components/UserCard.jsx
├── line: 3
└── evidence:
    export function UserCard({ user }) {

The important part isn't just the answer.

It's the evidence behind the answer.

Rune is designed so that code intelligence can be inspected instead of blindly trusted.

---

Install

Node.js

npm install -g @pypl100/rune

Python

pip install north-rune

Both distributions expose the "rune" CLI.

«Note: If you install both distributions globally, your shell will use whichever "rune" executable appears first on your "PATH". Use "which -a rune" to see which one is being executed.»

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

That's it.

Rune now maintains an understanding of your project and can expose it to compatible AI clients through MCP.

One-time scan

If you don't need a watcher:

rune scan .

---

How it works

                YOUR CODEBASE
                     │
                     ▼
               ┌───────────┐
               │    Rune   │
               │  Scanner  │
               └─────┬─────┘
                     │
                     ▼
            Understanding Graph
                     │
             ┌───────┴───────┐
             │               │
           Facts          Derived
                         understanding
             │               │
             └───────┬───────┘
                     │
                     ▼
                MCP Server
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
    Claude Code    Cursor       Codex

Rune separates facts from derived understanding.

A fact might be:

components/UserCard.jsx
line 3
defines UserCard

A derived conclusion can be built from multiple facts.

The result is an inspectable chain from:

source → fact → understanding → answer

---

Built for AI coding agents

Rune is designed for workflows where multiple AI agents need to understand the same codebase.

Compatible with MCP clients

- Claude Code
- Cursor
- Codex
- Claude Desktop
- Custom MCP clients

Instead of every agent rebuilding its own mental model, Rune provides a shared project understanding.

---

Connect Rune through MCP

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

What Rune understands

Rune currently focuses on common JavaScript/TypeScript application structures.

Frameworks

- React
- Next.js
- Express

Code intelligence

- React components
- Next.js pages
- Next.js App Router routes
- Express routes
- File relationships
- Import relationships
- Codebase facts
- Derived conclusions
- Source evidence

Support is intentionally focused while the project is still evolving.

---

Evidence-backed answers

Most AI systems give you an answer.

Rune aims to give you:

the answer + the evidence behind it.

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

MCP tools

Rune currently exposes tools for querying the project understanding.

Tool| Purpose
"rune_get_overview"| Get an architecture overview
"rune_list_components"| List detected React components
"rune_list_routes"| List Express and Next.js routes
"rune_search"| Search project facts and derived nodes
"rune_explain"| Inspect the evidence behind a conclusion
"rune_get_file_dependencies"| Inspect file imports/dependencies
"rune_rescan"| Rebuild the understanding after changes

---

CLI

Command| Description
"rune init [dir]"| Initialize Rune in a project
"rune scan [dir]"| Perform a one-time scan
"rune watch [dir]"| Watch for changes and rebuild
"rune serve [dir]"| Start the MCP server
"rune explain <id>"| Show evidence for a node
"rune --version"| Show the installed version

---

Read-only by design

Rune does not modify your source code.

It maintains its own project data under:

.rune/

Your source remains yours.

Rune's job is to read, understand, and explain.

If you expose Rune's generated graph or source evidence to an AI client, remember that it can contain information from your codebase.

---

Who is Rune for?

Rune is built for developers who:

- Use AI coding agents regularly
- Work on large or unfamiliar codebases
- Switch between multiple AI coding tools
- Build MCP-based developer workflows
- Want persistent project context
- Want AI answers that can be traced back to source

Rune is especially useful when:

Your project gets bigger
        ↓
Your context gets harder to maintain
        ↓
You use more AI agents
        ↓
Each agent needs to understand the same code
        ↓
Rune becomes the shared understanding layer

---

What Rune is not

Rune is not:

- An autonomous coding agent
- An IDE replacement
- A general-purpose static analyzer
- A compiler
- A full security scanner
- A system that silently modifies your source

Rune focuses on one problem:

«Helping AI agents understand an existing codebase with persistent, inspectable context.»

---

Current status

Rune is early-stage software.

Today, the scanner uses lightweight heuristic and regex-based extraction rather than a complete AST parser.

That keeps the system lightweight and fast, while preserving file, line, and evidence information.

It also means some unusual code patterns may not be detected yet.

For example:

- Components created without recognizable JSX patterns
- Dynamically constructed routes
- Complex re-export chains
- Framework-specific patterns outside current support

If Rune gets something wrong, please open an issue.

Real-world codebases are exactly how the extractor gets better.

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

The principle stays the same:

«Read first. Understand. Explain. Never silently modify your code.»

---

Current limitations

Rune is intentionally early and focused.

Known limitations include:

- Limited framework coverage
- Some extraction relies on heuristics
- Cross-file Express route prefixes are not fully resolved
- "rune watch" currently performs a full rebuild after changes rather than a true incremental diff
- MCP currently uses a single-process stdio transport

These limitations are part of the current development roadmap.

---

Development

Clone the repository:

git clone https://github.com/thecolourfoundation/rune.git
cd rune

Install dependencies:

npm install

Run tests:

npm test

Verify MCP:

npm run verify:mcp

Or test against a real project:

npm run verify:mcp -- /path/to/your-project

---

Contributing

Rune is early.

If you're building with AI coding agents, MCP, developer tooling, or code intelligence, real-world feedback is valuable.

Useful contributions include:

- Reporting extraction bugs
- Adding tests and fixtures
- Improving framework detection
- Improving MCP tools
- Adding new evidence-backed queries
- Testing Rune against real-world repositories
- Improving documentation

If you find something Rune doesn't understand:

Show us the code.

That's how we make the understanding layer better.

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

MIT3
