# Rune

Ask questions about a codebase. Rune finds the evidence, your own AI model explains it, and every statement is checked against the code before you see it.

## Install

Linux (x64) and macOS (Apple Silicon):

    curl -fsSL https://raw.githubusercontent.com/thecolourfoundation/rune/main/install.sh | sh

Windows: download `rune-windows-x64.exe` from the [latest release](https://github.com/thecolourfoundation/rune/releases/latest) and run it from a terminal.

The installer verifies a SHA-256 checksum and puts `rune` in `~/.local/bin`.

## Use

    cd your-project
    rune "how does routing work"

The first run scans the project (a few seconds). Rune prints ranked findings with file:line evidence, then your model writes a short explanation from that evidence. Any statement that cites evidence Rune didn't retrieve, or quotes text that isn't there, is dropped and counted.

`rune explain <id>` shows the evidence trail behind any fact, and `rune verify` checks the stored understanding against the code as it is now.

## Bring your own model

Rune has no model of its own. Point it at yours with environment variables:

    # Anthropic (early support)
    export ANTHROPIC_API_KEY=your-key

    # OpenAI or any OpenAI-compatible API
    export OPENAI_API_KEY=your-key
    export RUNE_LLM_MODEL=model-name

    # Local model with Ollama (no key, nothing leaves your machine)
    export RUNE_LLM_BASE_URL=http://localhost:11434/v1
    export RUNE_LLM_MODEL=model-name

If no model is configured, Rune prints the evidence, then setup help, and exits with code 2. Add `--evidence-only` to skip the model entirely. Set `RUNE_LLM_DEBUG=1` to see the model's raw reply and why any statement was dropped.

## What leaves your machine

Only the evidence for your question goes to the model provider you configured: up to 40 short code snippets, never the whole project. Rune prints how many it is sending before it sends them. Use `--evidence-only`, or a local model, to send nothing.

## Use it from an AI client (MCP)

Rune is an MCP server. Point any MCP client at it:

    {"command": "rune", "args": ["serve", "/absolute/path/to/your-project"]}

The client gets tools such as `rune_agent`, `rune_search`, `rune_explain`, `rune_verify_fact` and `rune_check_drift`, with file, line and snippet citations. No key is needed here: the client's own model is the model.

## Good to know

- Rune is read-only. It observes and reports; it never modifies your project.
- Best on JavaScript/TypeScript, shell, Lua, and config files. Other languages get thinner results for now.
- Explanation quality depends on your model. Small local models write plain, short explanations.
- Rune saves its scan in `.rune/` inside your project. Add `.rune/` to your `.gitignore`.
- Binaries are unsigned, so macOS or Windows may show a security warning. There is no prebuilt binary yet for Intel Macs or Linux on ARM.

Run `rune --help` for all commands. More detail: [Docs.md](Docs.md).

## License

MIT
