import path from "node:path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import { confidenceForFile } from "./confidence.js";
const traverse = _traverse.default;

/**
 * AST-based extractor - replaces the regex heuristic in the previous version.
 * Same fact schema as before (id, type, method, routePath, receiver, file,
 * line, evidence), plus a v3 `confidence` field (see confidence.js).
 * Extraction method changed; nothing else did.
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

// Resolve a route-path argument to a plain string. Handles string literals
// and no-substitution template literals (the AST equivalent of the regex's
// ['"`] character class); anything dynamic (template with expressions,
// identifiers, concatenation) is not a route we can name statically.
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
  const confidence = confidenceForFile(relPath);
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
    // Unparseable file - skip silently, same as v1 on garbage input.
    return facts;
  }

  // See facts.js for why traverse() gets its own try/catch: a valid AST can
  // still make traverse() throw on unusual real-world code shapes, and one
  // bad file shouldn't kill the whole repo scan.
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
          confidence,
          evidence: evidenceFor(lines, ln),
        });
      },
    });
  } catch (err) {
    // return partial facts
  }

  return facts;
}
