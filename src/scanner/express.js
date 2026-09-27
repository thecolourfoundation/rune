import path from "node:path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import { confidenceForFile } from "./confidence.js";
import { EVIDENCE_MAX_CHARS } from "./constants.js";
const traverse = _traverse.default;

const HTTP_METHODS = new Set(["get", "post", "put", "delete", "patch", "use", "all"]);
const RECEIVER_NAMES = new Set(["app", "router"]);

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
  const confidence = confidenceForFile(relPath);
  const facts = [];
  const lines = content.split("\n");

  const ast = parse(content, {
    sourceType: "unambiguous",
    plugins: ["jsx", "typescript", "classProperties", "decorators-legacy"],
    errorRecovery: true,
  });

  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (callee.type !== "MemberExpression" || callee.computed) return;
      if (callee.object.type !== "Identifier") return;
      if (callee.property.type !== "Identifier") return;
      const receiver = callee.object.name;
      const method = callee.property.name;
      if (!RECEIVER_NAMES.has(receiver) || !HTTP_METHODS.has(method)) return;
      if (path.node.arguments.length < 2) return;
      const routePath = staticStringValue(path.node.arguments[0]);
      if (routePath === null) return;
      if (method === "use" && !routePath.startsWith("/")) return;
      const ln = path.node.loc?.start.line;
      facts.push({ id: nextId("route"), type: "express_route", method: method.toUpperCase(), routePath, receiver, file: relPath, line: ln, confidence, evidence: evidenceFor(lines, ln) });
    },
  });

  return facts;
}
