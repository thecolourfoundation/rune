#!/usr/bin/env node
import { runCli } from "../src/cli/index.js";

runCli(process.argv.slice(2)).catch((err) => {
  console.error(`[rune] error: ${err.message}`);
  process.exitCode = 1;
});
