import path from "node:path";
import fs from "node:fs";

/**
 * Shell script intelligence — line-based regex extraction.
 *
 * Shell has no practical AST parser available without a heavy new
 * dependency, and its grammar is irregular enough (quoting, here-docs,
 * subshells) that a full parser is out of scope for this pass. This
 * extracts a deliberately narrow, high-confidence slice:
 *
 *   - function definitions:      name() { ... }  or  function name { ... }
 *   - sourced files:             source file.sh   or   . file.sh
 *   - package-manager invocations: apt/apt-get/yum/dnf/brew/npm/pip/pacman
 *   - top-level command invocations: first word of a non-comment,
 *     non-assignment line, when it looks like a real command name
 *
 * Deliberately excluded (documented limitation, same spirit as the
 * function_call scope note in facts.js): pipelines, conditionals, loops,
 * subshells, heredocs, variable expansion inside commands, and any command
 * embedded inside a string. These would require real shell parsing to do
 * safely; a regex guess here would produce confident wrong answers, which
 * is worse than not extracting the fact at all.
 */

const PACKAGE_MANAGERS = new Set([
  "apt", "apt-get", "yum", "dnf", "brew", "npm", "pip", "pip3", "pacman", "yarn", "pnpm", "cargo", "gem",
]);

const FUNCTION_DEF_RE = /^\s*(?:function\s+)?([a-zA-Z_][a-zA-Z0-9_-]*)\s*\(\)\s*\{?/;
const FUNCTION_DEF_KEYWORD_RE = /^\s*function\s+([a-zA-Z_][a-zA-Z0-9_-]*)\s*\{?/;
const SOURCE_RE = /^\s*(?:source|\.)\s+["']?([^\s"']+)["']?/;
const COMMENT_RE = /^\s*#/;
const ASSIGNMENT_RE = /^\s*[a-zA-Z_][a-zA-Z0-9_]*=/;
const FIRST_WORD_RE = /^\s*([a-zA-Z_][a-zA-Z0-9_.\/-]*)/;

const EVIDENCE_MAX_CHARS = 160;

function evidenceFor(lines, ln) {
  return lines[ln - 1]?.trim().slice(0, EVIDENCE_MAX_CHARS) || "";
}

export function extractShellFacts(filePath, content, rootDir, nextId) {
  const relPath = path.relative(rootDir, filePath);
  const facts = [];
  const lines = content.split("\n");

  lines.forEach((rawLine, idx) => {
    const ln = idx + 1;
    const line = rawLine;

    if (COMMENT_RE.test(line) || line.trim() === "") return;

    // Function definitions
    let m = line.match(FUNCTION_DEF_KEYWORD_RE) || line.match(FUNCTION_DEF_RE);
    if (m && m[1]) {
      facts.push({
        id: nextId("shell_function"),
        type: "shell_function_def",
        file: relPath,
        line: ln,
        name: m[1],
        confidence: "high",
        evidence: evidenceFor(lines, ln),
      });
      return;
    }

    // Sourced files
    m = line.match(SOURCE_RE);
    if (m && m[1]) {
      facts.push({
        id: nextId("shell_source"),
        type: "shell_source",
        file: relPath,
        line: ln,
        target: m[1],
        confidence: "high",
        evidence: evidenceFor(lines, ln),
      });
      return;
    }

    // Skip variable assignments -- not a command invocation
    if (ASSIGNMENT_RE.test(line)) return;

    // Top-level command invocation (first word of the line)
    m = line.match(FIRST_WORD_RE);
    if (m && m[1]) {
      const word = m[1];
      // Skip shell keywords/control-flow -- these aren't commands.
      const SKIP_WORDS = new Set([
        "if", "then", "else", "elif", "fi", "for", "while", "do", "done",
        "case", "esac", "function", "return", "exit", "echo", "export",
        "local", "readonly", "set", "unset", "shift", "trap",
      ]);
      if (SKIP_WORDS.has(word)) return;

      const isPackageManager = PACKAGE_MANAGERS.has(word);
      facts.push({
        id: nextId(isPackageManager ? "shell_pkg_cmd" : "shell_cmd"),
        type: isPackageManager ? "shell_package_manager_call" : "shell_command",
        file: relPath,
        line: ln,
        name: word,
        confidence: isPackageManager ? "high" : "low",
        evidence: evidenceFor(lines, ln),
      });
    }
  });

  return facts;
}
