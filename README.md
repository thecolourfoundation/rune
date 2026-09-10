# Rune

**Stop your AI coding tools from guessing. Give them a codebase they actually understand.**

```bash
npm install -g @pypl100/rune
rune init
```

## The problem

Every session, your AI coding tool re-reads your codebase from zero. It doesn't remember yesterday's refactor. It doesn't know which functions actually call which. It won't catch that a dependency got typosquatted last week. So it guesses — and you pay for the guess in wrong suggestions, wasted tokens, and code you have to double-check anyway.

## What you get

- **An AI that knows your codebase, not just your files.** Rune builds a live, queryable map of what calls what, what depends on what, and what changed — so your AI tool answers from facts instead of re-inferring them every time.
- **Problems caught before they ship.** Hardcoded secrets, unsafe shell-exec patterns, risky CI/CD configs, typosquatted dependencies — flagged automatically, not after a postmortem.
- **Memory that persists, with you in control.** Rune remembers decisions across sessions, but nothing gets written to the graph without your approval.
- **Works with what you already use.** MCP-native — plug it into Cursor, Claude Code, Copilot, or any MCP-compatible tool. No new UI, no workflow change.

## Quick start

```bash
npm install -g @pypl100/rune
cd your-project
rune init
rune serve
```

Then point your MCP-compatible AI tool at Rune's endpoint.

## Status

Early and moving fast. Core indexing is validated on Express.js codebases; broader language and framework support is in progress. Security detectors are live today: secrets, shell-exec, CI/CD risk, typosquatted dependencies.

Found a bug, or did Rune catch something real in your repo? [Open an issue](https://github.com/thecolourfoundation/rune/issues) — real catches make the best case studies.

## License

MIT
