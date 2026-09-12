import path from "node:path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
const traverse = _traverse.default;

/**
 * AST-based extractor - replaces the regex heuristic in the previous version.
 * Same fact schema as before (id, type, method, routePath, receiver, file,
 * line, evidence), so downstream consumers are unaffected. Extraction method
 * changed; nothing else did.
 *
 * Still matches the same receiver names as the regex version ("app" /
 * "router") rather than tracing express() / express.Router() call sites
 * to their variable bindings - a natural follow-up if we want to
 * catch renamed routers (e.g. userRouter.get(...)), but out of scope here
 * to keep behavior parity with v1.
 */

const HTTP_METHODS = new Set(["get", "post", "put", "delete", "patch", "use", "all"]);
const RECEIVER_NAMES = new Set(["app", "router"]);
const EVIDENCE_MAX_CHARS = 160;

function evidenceFor(lines, ln) {
  return lines[ln - 1]?.trim().slice(0, EVIDENCE_MAX_CHARS) || "";
}

function staticStringValue(argNode) {
  if (!argNode) return null;
  if (argNode.type === "StringLiteral") return argNode.value;
  if (argNode.type === "TemplateLiteral" && argNode.expressions.length === 0) {
    return argNode.quasis.map((q) => q.value.cooked).join("");
  }
  return null;
}

export function extractExpressRoutes(filePath, content, rootDir, nextId) {
  const relPath = path.relative(rootDir, filePath);
  const facts = [];
  const lines = content.split("\n");

  let ast;
  try {
    ast = parse(content, {
      sourceType: "unambiguous",
      plugins: ["jsx", "typescript", "classProperties", "decorators-legacy"],
      errorRecovery: true,
    });
  } catch (err) {
    return facts;
  }

  try {
    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.object.type !== "Identifier") return;
        if (callee.property.type !== "Identifier") return;

        const receiver = callee.object.name;
        const method = callee.property.name;
        if (!RECEIVER_NAMES.has(receiver) || !HTTP_METHODS.has(method)) return;

        const routePath = staticStringValue(path.node.arguments[0]);
        if (routePath === null) return;
        if (method === "use" && !routePath.startsWith("/")) return;

        const ln = path.node.loc?.start.line;
        facts.push({
          id: nextId("route"),
          type: "express_route",
          method: method.toUpperCase(),
          routePath,
          receiver,
          file: relPath,
          line: ln,
          evidence: evidenceFor(lines, ln),
        });
      },
    });
  } catch (err) {
    // return partial facts
  }

  return facts;
}
