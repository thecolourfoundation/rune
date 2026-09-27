import path from "node:path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import { confidenceForFile } from "./confidence.js";
import { EVIDENCE_MAX_CHARS } from "./constants.js";
const traverse = _traverse.default;

function evidenceFor(lines, ln) {
  return lines[ln - 1]?.trim().slice(0, EVIDENCE_MAX_CHARS) || "";
}

function containsJSX(outerPath) {
  let found = false;
  outerPath.traverse({
    JSXElement(innerPath) { found = true; innerPath.stop(); },
    JSXFragment(innerPath) { found = true; innerPath.stop(); },
    Function(innerPath) { innerPath.skip(); },
  });
  return found;
}

function enclosingFunctionName(callPath) {
  const fnPath = callPath.getFunctionParent();
  if (!fnPath) return null;
  const node = fnPath.node;
  if (node.type === "FunctionDeclaration" && node.id) return node.id.name;
  if (node.type === "ClassMethod" || node.type === "ObjectMethod") {
    if (node.key && !node.computed && node.key.type === "Identifier") {
      const classPath = fnPath.findParent((p) => p.isClassDeclaration());
      const className = classPath?.node?.id?.name;
      return className ? `${className}.${node.key.name}` : node.key.name;
    }
    return null;
  }
  const parent = fnPath.parentPath;
  if (!parent) return null;
  if (parent.isVariableDeclarator() && parent.node.id.type === "Identifier") return parent.node.id.name;
  if (parent.isObjectProperty() && !parent.node.computed && parent.node.key.type === "Identifier") return parent.node.key.name;
  if (parent.isAssignmentExpression() && parent.node.left.type === "Identifier") return parent.node.left.name;
  return null;
}

export function extractFileFacts(filePath, content, rootDir, nextId) {
  const relPath = path.relative(rootDir, filePath);
  const confidence = confidenceForFile(relPath);
  const facts = [];
  const lines = content.split("\n");

  const ast = parse(content, {
    sourceType: "unambiguous",
    plugins: ["jsx", "typescript", "classProperties", "decorators-legacy"],
    errorRecovery: true,
  });

  const hooksSeen = new Set();

  traverse(ast, {
    ImportDeclaration(path) {
      const ln = path.node.loc?.start.line;
      facts.push({ id: nextId("import"), type: "import", file: relPath, line: ln, target: path.node.source.value, confidence, evidence: evidenceFor(lines, ln) });
    },
    CallExpression(path) {
      const callee = path.node.callee;
      if (callee.type === "Identifier" && callee.name === "require" && path.node.arguments[0]?.type === "StringLiteral") {
        const ln = path.node.loc?.start.line;
        facts.push({ id: nextId("import"), type: "import", file: relPath, line: ln, target: path.node.arguments[0].value, confidence, evidence: evidenceFor(lines, ln) });
        return;
      }
      if (callee.type === "Identifier" && /^use[A-Z]/.test(callee.name)) {
        if (!hooksSeen.has(callee.name)) {
          hooksSeen.add(callee.name);
          const ln = path.node.loc?.start.line;
          facts.push({ id: nextId("hook"), type: "hook_usage", file: relPath, line: ln, name: callee.name, confidence, evidence: evidenceFor(lines, ln) });
        }
        return;
      }
      if (callee.type === "Identifier") {
        const ln = path.node.loc?.start.line;
        facts.push({ id: nextId("call"), type: "function_call", file: relPath, line: ln, caller: enclosingFunctionName(path), callee: callee.name, confidence, evidence: evidenceFor(lines, ln) });
      }
    },
    FunctionDeclaration(path) {
      const name = path.node.id?.name;
      if (!name || !/^[A-Z]/.test(name)) return;
      if (!containsJSX(path)) return;
      const ln = path.node.loc?.start.line;
      facts.push({ id: nextId("component"), type: "react_component", kind: "function", file: relPath, line: ln, name, confidence, evidence: evidenceFor(lines, ln) });
    },
    VariableDeclarator(path) {
      const id = path.node.id;
      const init = path.node.init;
      if (id.type !== "Identifier" || !/^[A-Z]/.test(id.name)) return;
      if (!init || (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression")) return;
      const initPath = path.get("init");
      const hasJSX = init.body.type === "JSXElement" || init.body.type === "JSXFragment" || containsJSX(initPath);
      if (!hasJSX) return;
      const ln = path.node.loc?.start.line;
      facts.push({ id: nextId("component"), type: "react_component", kind: "function", file: relPath, line: ln, name: id.name, confidence, evidence: evidenceFor(lines, ln) });
    },
    ClassDeclaration(path) {
      const superClass = path.node.superClass;
      if (!superClass) return;
      const isComponent =
        (superClass.type === "Identifier" && superClass.name === "Component") ||
        (superClass.type === "MemberExpression" && superClass.object.name === "React" && superClass.property.name === "Component");
      if (!isComponent) return;
      const name = path.node.id?.name;
      if (!name) return;
      const ln = path.node.loc?.start.line;
      facts.push({ id: nextId("component"), type: "react_component", kind: "class", file: relPath, line: ln, name, confidence, evidence: evidenceFor(lines, ln) });
    },
  });

  return facts;
}
