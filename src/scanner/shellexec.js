import path from "node:path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
const traverse = _traverse.default;

/**
 * Dangerous shell-exec detector — AST-based.
 *
 * v2: recalibrated after benchmark evidence showed severe over-flagging
 * (83% of all security findings across a 25-repo benchmark were shell-exec,
 * heavily dominated by ordinary, safe process-spawning code like
 * `spawn(binaryPath, args)`). Root cause: v1 treated every bare identifier
 * argument as "dynamic" and therefore automatically HIGH severity, with no
 * distinction between:
 *   - exec/execSync, which always invoke a shell (real injection risk if
 *     the command string is attacker-influenced)
 *   - spawn/execFile WITHOUT shell:true, which do NOT invoke a shell by
 *     default -- args are passed directly to the OS, so string-injection
 *     via shell metacharacters isn't possible even with a dynamic argument
 *
 * The corrected model:
 *   - exec/execSync: shell is always invoked. A dynamically-constructed
 *     command (template interpolation, concatenation) is HIGH. A bare
 *     identifier alone is MEDIUM -- plausible risk, but we can't prove the
 *     value is externally influenced vs. an internally-controlled path.
 *   - spawn/execFile with shell:true: same shell-invocation risk as
 *     exec -- treated the same as exec/execSync above.
 *   - spawn/execFile WITHOUT shell:true: no shell metacharacter risk.
 *     Only flagged (LOW) if the command itself is dynamically constructed
 *     via template/concatenation, since that's still worth a human glance;
 *     a bare identifier here is NOT flagged at all -- this is the standard,
 *     safe way to spawn a subprocess with a variable path.
 */

const SHELL_ALWAYS_CALLEES = new Set(["exec", "execSync"]);
const CONDITIONAL_SHELL_CALLEES = new Set(["spawn", "execFile"]);

const EVIDENCE_MAX_CHARS = 160;

function evidenceFor(lines, ln) {
  return lines[ln - 1]?.trim().slice(0, EVIDENCE_MAX_CHARS) || "";
}

function classifyConstruction(node) {
  if (!node) return "identifier";

  if (node.type === "TemplateLiteral") {
    return node.expressions.length > 0 ? "interpolated" : "static";
  }

  if (node.type === "BinaryExpression" && node.operator === "+") {
    const leftIsStatic = node.left.type === "StringLiteral";
    const rightIsStatic = node.right.type === "StringLiteral";
    return leftIsStatic && rightIsStatic ? "static" : "interpolated";
  }

  if (node.type === "StringLiteral") return "static";

  if (node.type === "Identifier") return "identifier";

  return "identifier";
}

function hasShellTrueOption(argsNode) {
  if (!argsNode || argsNode.type !== "ObjectExpression") return false;
  return argsNode.properties.some(
    (p) =>
      p.type === "ObjectProperty" &&
      p.key?.name === "shell" &&
      p.value?.type === "BooleanLiteral" &&
      p.value.value === true
  );
}

export function extractShellExecFindings(filePath, content, rootDir, nextId) {
  const relPath = path.relative(rootDir, filePath);
  const findings = [];
  const lines = content.split("\n");

  let ast;
  try {
    ast = parse(content, {
      sourceType: "unambiguous",
      plugins: ["jsx", "typescript", "classProperties", "decorators-legacy"],
      errorRecovery: true,
    });
  } catch {
    return findings;
  }

  let importsChildProcess = false;
  traverse(ast, {
    ImportDeclaration(p) {
      if (/^(node:)?child_process$/.test(p.node.source.value)) importsChildProcess = true;
    },
    CallExpression(p) {
      const callee = p.node.callee;
      if (
        callee.type === "Identifier" &&
        callee.name === "require" &&
        p.node.arguments[0]?.type === "StringLiteral" &&
        /^(node:)?child_process$/.test(p.node.arguments[0].value)
      ) {
        importsChildProcess = true;
      }
    },
  });

  if (!importsChildProcess) return findings;

  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;

      let calleeName = null;
      if (callee.type === "Identifier") {
        calleeName = callee.name;
      } else if (callee.type === "MemberExpression" && callee.property?.type === "Identifier") {
        calleeName = callee.property.name;
      }

      const isShellAlways = calleeName && SHELL_ALWAYS_CALLEES.has(calleeName);
      const isConditionalShell = calleeName && CONDITIONAL_SHELL_CALLEES.has(calleeName);
      if (!isShellAlways && !isConditionalShell) return;

      const args = path.node.arguments;
      if (args.length === 0) return;

      const construction = classifyConstruction(args[0]);
      if (construction === "static") return;

      let shellInvoked = isShellAlways;
      if (isConditionalShell) {
        const optsArg = args[2] ?? args[1];
        shellInvoked = hasShellTrueOption(optsArg);
      }

      let severity;
      let ruleSuffix;

      if (shellInvoked) {
        if (construction === "interpolated") {
          severity = "high";
          ruleSuffix = "dynamically-constructed command";
        } else {
          severity = "medium";
          ruleSuffix = "variable command (unverified source)";
        }
      } else {
        if (construction === "interpolated") {
          severity = "low";
          ruleSuffix = "dynamically-constructed command (no shell invoked)";
        } else {
          return;
        }
      }

      const ln = path.node.loc?.start.line;
      findings.push({
        id: nextId("shellexec"),
        type: "security_finding",
        category: "dangerous_shell_exec",
        rule: `${calleeName}() called with ${ruleSuffix}`,
        severity,
        file: relPath,
        line: ln,
        evidence: evidenceFor(lines, ln),
        confidence: severity === "high" ? "medium" : "low",
      });
    },
  });

  return findings;
}
