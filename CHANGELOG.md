# Changelog

All notable changes to Rune are documented here.

## [Unreleased]

### Breaking change

- --explain is now required to send code evidence to your configured LLM provider. Previously, `rune agent "<question>"` sent evidence to whatever provider was configured (ANTHROPIC_API_KEY, OPENAI_API_KEY, or RUNE_LLM_BASE_URL) automatically, with --evidence-only as the only way to opt out. --explain is now the flag that actually turns this on. If you relied on the old default-on behavior, add --explain to your existing invocations.

### Fixed

- Security findings were mostly non-functional: secrets/workflow/dependencies detectors were registered against the wrong file buckets and could never see their real targets. All three now scan the buckets their real targets actually live in; .env files are now scanned for the first time.
- A secret-redaction pattern could leak real characters of a live secret: the AWS Secret Access Key pattern had no capture group, so redaction exposed real trailing characters of the actual secret.
- Shell and doc dependency tracking silently missed most real-world references (source utils.sh, markdown links without ./).
- Parse failures in the JS/TS and Express extractors were invisible -- a file that failed to parse looked identical to one with zero facts.
- The cached graph reader could serve a deleted graph.json forever due to a null-handling bug in its staleness check.
- rune agent (the plain-text CLI path) double-logged every invocation into the experience history, and ran the full agent loop twice per call. Experience is now recorded once.
- Single-word objectives were rejected -- rune "authentication" fell through to "Unknown command" since routing required a space in the input.
- Token budgeting didn't budget the actual output: synthesis.insights passed through completely unbounded regardless of maxTokens.
- rune_search (MCP) couldn't find call-graph facts (fields with only caller/callee, no name/target).
- Next.js optional catch-all routes ([[...slug]]) produced a malformed route pattern.
- Lua's M.foo = function() end assignment style wasn't detected.
- .rune/config.json's ignore list is now respected by vue.js, nextjs.js, and rune watch.
- An explicitly configured RUNE_LLM_BASE_URL now takes precedence over an ambient ANTHROPIC_API_KEY.
- ignore patterns in .rune/config.json now support path-scoped and glob matching, not just exact directory-name matching.
- __fixtures__ directories are now scored low-confidence, matching __tests__/__mocks__.

### Added

- Science and math extractors: Jupyter notebooks (.ipynb), Python (.py), LaTeX (.tex/.bib), Lean (.lean), and R (.r/.rmd).

[Unreleased]: https://github.com/thecolourfoundation/rune/compare/607854d...HEAD
