import path from "node:path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
const traverse = _traverse.default;

/**
 * AST-based extractor - replaces the regex heuristics in the previous version.
 * Same fact schema as before (id, type, file, line, name, evidence), so
 * everything downstream (graph, MCP tools) is unaffected. Extraction method
 * changed; nothing else did.
 */

const EVIDENCE_MAX_CHARS = 160;

function evidenceFor(lines, ln) {
  return lines[ln - 1]?.trim().slice(0, EVIDENCE_MAX_CHARS) || "";
}

// A function/arrow body counts as a component if it contains a JSX element
// or fragment anywhere in its own scope (not nested function scopes).
function containsJSX(outerPath) {
  let found = false;
  outerPath.traverse({
    JSXElement(innerPath) { found = true; innerPath.stop(); },
    JSXFragment(innerPath) { found = true; innerPath.stop(); },
    Function(innerPath) { innerPath.skip(); }, // don't descend into nested functions
  });
  return found;
}

export function extractFileFacts(filePath, content, rootDir, nextId) {
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
    // Unparseable file (syntax error, unsupported dialect) - skip silently,
    // same as the regex version would have produced zero facts for garbage input.
    return facts;
  }

  const hooksSeen = new Set();

  traverse(ast, {
    // Imports: import ... from "x"
    ImportDeclaration(path) {
      const ln = path.node.loc?.start.line;
      facts.push({
        id: nextId("import"),
        type: "import",
        file: relPath,
        line: ln,
        target: path.node.source.value,
        evidence: evidenceFor(lines, ln),
      });
    },

    // require("x")
    CallExpression(path) {
      const callee = path.node.callee;
      if (
        callee.type === "Identifier" &&
        callee.name === "require" &&
        path.node.arguments[0]?.type === "StringLiteral"
      ) {
        const ln = path.node.loc?.start.line;
        facts.push({
          id: nextId("import"),
          type: "import",
          file: relPath,
          line: ln,
          target: path.node.arguments[0].value,
          evidence: evidenceFor(lines, ln),
        });
      }

      // Hook usage: useXxx(...)
      if (callee.type === "Identifier" && /^use[A-Z]/.test(callee.name)) {
        if (!hooksSeen.has(callee.name)) {
          hooksSeen.add(callee.name);
          const ln = path.node.loc?.start.line;
          facts.push({
            id: nextId("hook"),
            type: "hook_usage",
            file: relPath,
            line: ln,
            name: callee.name,
            evidence: evidenceFor(lines, ln),
          });
        }
      }
    },

    // function Foo() { ... } - capitalized name + returns/contains JSX
    FunctionDeclaration(path) {
      const name = path.node.id?.name;
      if (!name || !/^[A-Z]/.test(name)) return;
      if (!containsJSX(path)) return;
      const ln = path.node.loc?.start.line;
      facts.push({
        id: nextId("component"),
        type: "react_component",
        kind: "function",
        file: relPath,
        line: ln,
        name,
        evidence: evidenceFor(lines, ln),
      });
    },

    // const Foo = (...) => { ... } or const Foo = () => <jsx/>
    VariableDeclarator(path) {
      const id = path.node.id;
      const init = path.node.init;
      if (id.type !== "Identifier" || !/^[A-Z]/.test(id.name)) return;
      if (!init || (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression")) return;

      const initPath = path.get("init");
      const hasJSX =
        init.body.type === "JSXElement" ||
        init.body.type === "JSXFragment" ||
        containsJSX(initPath);
      if (!hasJSX) return;

      const ln = path.node.loc?.start.line;
      facts.push({
        id: nextId("component"),
        type: "react_component",
        kind: "function",
        file: relPath,
        line: ln,
        name: id.name,
        evidence: evidenceFor(lines, ln),
      });
    },

    // class Foo extends Component / React.Component
    ClassDeclaration(path) {
      const superClass = path.node.superClass;
      if (!superClass) return;
      const isComponent =
        (superClass.type === "Identifier" && superClass.name === "Component") ||
        (superClass.type === "MemberExpression" &&
          superClass.object.name === "React" &&
          superClass.property.name === "Component");
      if (!isComponent) return;
      const name = path.node.id?.name;
      if (!name) return;
      const ln = path.node.loc?.start.line;
      facts.push({
        id: nextId("component"),
        type: "react_component",
        kind: "class",
        file: relPath,
        line: ln,
        name,
        evidence: evidenceFor(lines, ln),
      });
    },
  });

  return facts;
}
