# Rune

You've explained your codebase to your AI assistant a hundred times. Tomorrow, you'll do it again — because it forgot the second the session ended.

That's not your AI being dumb. It's amnesia by design. Every tool — Cursor, Claude Code, Copilot — starts from zero, every single time, no matter how many hours you've already spent teaching it your architecture.

**Rune fixes the amnesia.** It runs quietly in the background, keeps a living, evidence-backed understanding of your codebase, and hands that understanding to any AI tool you connect — so it already knows your project before you say a word.

## Install

```
npm install -g @pypl100/rune
```

## Quickstart

```
cd your-project
rune init
rune watch &
rune serve
```

Connect your AI tool (Claude Code, Cursor, etc.) to the running `rune serve` process. It now knows your codebase instead of guessing at it.

## Why it matters

- **Stop repeating yourself.** What your AI learned yesterday, it still knows today.
- **Trust the answer, don't just hope.** Every claim points to a real file and line — run `rune explain <id>` and see the proof.
- **Catch it before it ships.** Leaked secrets, unsafe scripts, and typosquatted dependencies get flagged automatically.
- **It can look, but it can't touch.** Rune only reads and reports. It never writes to your code — so it's never the thing that silently breaks something.

## Docs

Full setup, CLI reference, and current limitations: [docs](https://github.com/thecolourfoundation/rune/blob/main/DOCS.md)

## License

MIT
