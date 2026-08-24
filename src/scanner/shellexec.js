import path from "node:path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
const traverse = _traverse.default;

const DANGEROUS_EXEC_CALLEES = new Set([
  "exec",
  "execSync",
  "spawn",
  "execFile",
]);

const EVIDENCE_MAX_CHARS = 160;

function evidenceFor(lines, ln) {
  return lines[ln - 1]?.trim().slice(0, EVIDENCE_MAX_CHARS) || "";
}

function isDynamicStringConstruction(node) {
  if (!node) return false;

  if (node.type === "TemplateLiteral") {
    return node.expressions.length > 0;
  }

  if (node.type === "BinaryExpression" && node.operator === "+") {
    const leftDynamic = node.left.type !== "StringLiteral";
    const rightDynamic = node.right.type !== "StringLiteral";
    return leftDynamic || rightDynamic;
  }

  if (node.type === "Identifier") return true;

  if (node.type === "StringLiteral") return false;

  return true;
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

      if (!calleeName || !DANGEROUS_EXEC_CALLEES.has(calleeName)) return;

      const args = path.node.arguments;
      if (args.length === 0) return;

      const firstArg = args[0];
      const dynamic = isDynamicStringConstruction(firstArg);

      if (calleeName === "spawn") {
        const optsArg = args[2];
        const shellTrue = hasShellTrueOption(optsArg);
        if (!shellTrue && !dynamic) return;
      } else if (!dynamic) {
        return;
      }

      const ln = path.node.loc?.start.line;
      findings.push({
        id: nextId("shellexec"),
        type: "security_finding",
        category: "dangerous_shell_exec",
        rule: `Dynamic command passed to ${calleeName}()`,
        severity: "high",
        file: relPath,
        line: ln,
        evidence: evidenceFor(lines, ln),
        confidence: "medium",
      });
    },
  });

  return findings;
}
