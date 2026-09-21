# Rune

**Ask questions about your code. Get answers you can check.**

Rune scans a project into a graph of facts, and every fact points at the exact file and line it came from. Ask a question and you get ranked findings with citations. Your own AI model can then explain them, and Rune throws away any statement the evidence doesn't back.

Real output on the [Express](https://github.com/expressjs/express) repo, with a small local model writing the explanation:

    $ cd express
    $ rune "how does routing work"

    2 insight(s):

    1. lib/application.js
       Why it matters: Loads the external package `router` (var Router = require('router');)
       - logic tied to this name likely lives there, not in this repo.
       Evidence: lib/application.js:26
    ...
    Explanation (written by local / qwen2.5:1.5b; every statement checked against cited evidence)

      - Router is the external package used for routing logic in this project.  [lib/application.js:26, lib/express.js:19]

The answer is short because it's true: Express hands routing to a separate package, and Rune says so and shows the line.

## Why Rune

- **Every claim has a source.** Facts carry a file, a line, the exact snippet and a confidence level. `rune explain <id>` shows the evidence trail behind any fact.
- **Your model, your call.** Use Anthropic, OpenAI, any OpenAI-compatible API, or a local model. Rune has no model of its own.
- **Read-only.** Rune observes and reports. It never modifies your project.
- **Works where you work.** It's an MCP server, so AI clients can use it directly.

## Install

Linux (x64) and macOS (Apple Silicon):

    curl -fsSL https://raw.githubusercontent.com/thecolourfoundation/rune/main/install.sh | sh

Windows: download `rune-windows-x64.exe` from the [latest release](https://github.com/thecolourfoundation/rune/releases/latest) and run it from a terminal.

The installer verifies a SHA-256 checksum and puts `rune` in `~/.local/bin`.

## Use

    cd your-project
    rune "how does routing work"
    rune "give me 5 architectural insights"

The first run scans the project, which takes a few seconds. After that, Rune prints ranked findings with file:line evidence, then your model writes a short explanation from that evidence.

| Command | What it does |
| --- | --- |
| `rune "<question>"` | Ask about the project in the current folder |
| `rune scan [dir]` | Build or rebuild the graph and print a security summary |
| `rune watch [dir]` | Keep the graph current as files change |
| `rune serve [dir]` | Start the MCP server |
| `rune explain <id>` | Show the evidence trail behind a fact |
| `rune verify [dir]` | Check stored facts against the files as they are now |
| `rune memory ...` / `rune experience ...` | Keep project notes and a log of past outcomes |

Run `rune --help` for everything, and see [Docs.md](Docs.md) for detail.

## Bring your own model

    # Anthropic (early support)
    export ANTHROPIC_API_KEY=your-key

    # OpenAI or any OpenAI-compatible API
    export OPENAI_API_KEY=your-key
    export RUNE_LLM_MODEL=model-name

    # Local model with Ollama (no key, nothing leaves your machine)
    export RUNE_LLM_BASE_URL=http://localhost:11434/v1
    export RUNE_LLM_MODEL=model-name

Every statement the model writes must cite evidence Rune retrieved. Rune drops any statement that cites something it didn't retrieve, cites nothing, or quotes text that isn't in the cited evidence, and it tells you how many it dropped.

That checks grounding, not truth: a model can still misread real evidence. Explanation quality depends on the model you choose.

If no model is configured, Rune prints the evidence, then setup help, and exits with code 2. Add `--evidence-only` to skip the model. Set `RUNE_LLM_DEBUG=1` to see the model's raw reply and why any statement was dropped.

## What leaves your machine

Only the evidence for your question goes to the model provider you configured: up to 40 short code snippets, never the whole project. Rune prints how many it is sending before it sends them. Use `--evidence-only`, or a local model, to send nothing.

## Use it from AI tools (MCP)

Rune is an MCP server. Point any MCP client at it:

    {"command": "rune", "args": ["serve", "/absolute/path/to/your-project"]}

The client gets 13 tools, including `rune_agent`, `rune_search`, `rune_explain`, `rune_verify_fact`, `rune_check_drift`, `rune_list_routes` and `rune_get_security_findings`. Answers come back with file, line and snippet citations. No key is needed here, because the client's own model is the model.

Rune is listed in the official MCP Registry as `io.github.thecolourfoundation/rune`. Each release also includes `.mcpb` bundles for one-click install in Claude Desktop. They are new and haven't been tested inside Claude Desktop yet.

## What Rune understands

- **JavaScript and TypeScript:** imports, function calls, React components and hooks, Express routes, Next.js routes, Vue components.
- **Shell, Lua, config files (TOML, YAML, JSON) and markdown.**
- **Security findings:** hardcoded secrets, risky shell execution, GitHub Actions workflow issues and dependency issues.

## How it works

1. **Scan.** Rune parses your files into facts, each with a file, line, snippet and confidence.
2. **Derive.** It builds conclusions from those facts, and each conclusion lists the fact ids it rests on.
3. **Investigate.** For a question, it retrieves the relevant facts, forms hypotheses, checks them against the current files, and ranks them.
4. **Explain, then verify.** Your model writes the explanation, and Rune checks each statement against the evidence.

`rune verify` re-reads the source and tells you which stored facts have drifted since the last scan.

## Good to know

- Best on JavaScript/TypeScript, shell, Lua and config files. Other languages get thinner results for now.
- Rune saves its scan in `.rune/` inside your project. Add `.rune/` to your `.gitignore`.
- The binaries are unsigned, so macOS or Windows may show a security warning. There is no prebuilt binary yet for Intel Macs or Linux on ARM.

## Where it's going

Rune's scanners plug in through an extractor registry, and the graph, evidence and verification layers aren't specific to code. Support for other kinds of sources is planned. Today, Rune understands software projects.

## Contributing

Issues and pull requests are welcome.

## License

MIT. Built by the Colour Foundation.
