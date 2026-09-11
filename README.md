# Rune

Most tools scan your codebase once, hand your AI a snapshot, and go stale the moment you save a file. Rune doesn't scan — it runs. Always on, always watching, always up to date.

That's the difference between a photo and a live feed. Your AI isn't looking at what your code used to be five minutes ago — it's looking at what it is right now.

**Rune is a runtime, not a tool you run.** Start it once, and it keeps a living, evidence-backed understanding of your codebase current in the background — for every AI tool you connect, for as long as it's running.

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

Connect your AI tool (Claude Code, Cursor, etc.) to the running `rune serve` process. It now knows your codebase instead of guessing at it — live, not from a snapshot.

## Why it matters

- **Always current, never stale.** `rune watch` updates its understanding the moment you save — no re-scanning, no manual refresh.
- **Trust the answer, don't just hope.** Every claim points to a real file and line — run `rune explain <id>` and see the proof.
- **Catch it before it ships.** Leaked secrets, unsafe scripts, and typosquatted dependencies get flagged automatically.
- **It can look, but it can't touch.** Rune only reads and reports. It never writes to your code — so it's never the thing that silently breaks something.

## Docs

Full setup, CLI reference, and current limitations: [docs](https://github.com/thecolourfoundation/rune/blob/main/DOCS.md)

## License

MIT
