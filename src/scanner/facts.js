import path from "node:path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import { confidenceForFile } from "./confidence.js";
const traverse = _traverse.default;

/**
 * AST-based extractor - replaces the regex heuristics in the previous version.
 * Same fact schema as before (id, type, file, line, name, evidence), so
 * everything downstream (graph, MCP tools) is unaffected. Extraction method
 * changed; nothing else did.
 *
 * v3 additions: every fact now carries a `confidence` field (see
 * confidence.js), and this file also records a shallow function-call graph
 * (see enclosingFunctionName + the function_call fact type below).
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

// Resolves the name of the function/method enclosing a call site, used to
// build a (deliberately shallow) call graph. Handles the common binding
// shapes: named function declarations, class/object methods, and
// function/arrow expressions bound to a variable, property, or assignment.
// Returns null for genuinely anonymous call sites (top-level script code,
// inline callbacks with no binding) rather than guessing - a missing
// caller is honest, a wrong one is worse than useless for a call graph.
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

  // FunctionExpression / ArrowFunctionExpression: name comes from how it's bound.
  const parent = fnPath.parentPath;
  if (!parent) return null;
  if (parent.isVariableDeclarator() && parent.node.id.type === "Identifier") {
    return parent.node.id.name;
  }
  if (parent.isObjectProperty() && !parent.node.computed && parent.node.key.type === "Identifier") {
    return parent.node.key.name;
  }
  if (parent.isAssignmentExpression() && parent.node.left.type === "Identifier") {
    return parent.node.left.name;
  }
  return null;
}

export function extractFileFacts(filePath, content, rootDir, nextId) {
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
    // Unparseable file (syntax error, unsupported dialect) - skip silently,
    // same as the regex version would have produced zero facts for garbage input.
    return facts;
  }

  const hooksSeen = new Set();

  // traverse() is wrapped separately from parse() -- a syntactically valid
  // AST can still cause traverse() itself to throw (e.g. unusual real-world
  // code shapes Babel's visitor logic doesn't expect). A benchmark run
  // against large real repos (VS Code, Next.js) hit exactly this: parse()
  // succeeded, traverse() threw, and the exception propagated uncaught all
  // the way up through build.js, killing the entire repository scan over
  // one file. Catching it here means one problematic file loses its own
  // facts, not the whole scan.
  try {
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
          confidence,
          evidence: evidenceFor(lines, ln),
        });
      },

      // require("x"), hook usage, and a shallow call graph
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
            confidence,
            evidence: evidenceFor(lines, ln),
          });
          return;
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
              confidence,
              evidence: evidenceFor(lines, ln),
            });
          }
          return;
        }

        // Shallow call graph: direct calls to a named function by identifier
        // only. Deliberately excludes member-expression calls (obj.method())
        // and computed calls -- including those would flood every scan with
        // a fact for every array/console/library method call in the
        // codebase, which is noise, not a call graph. This is the simplest,
        // lowest-noise slice: "does function A call function B by name in
        // the same file's lexical scope." Cross-file resolution, method
        // calls, and re-exports are out of scope for this pass -- documented
        // limitation, same spirit as express.js's receiver-name scope note.
        if (callee.type === "Identifier") {
          const ln = path.node.loc?.start.line;
          facts.push({
            id: nextId("call"),
            type: "function_call",
            file: relPath,
            line: ln,
            caller: enclosingFunctionName(path),
            callee: callee.name,
            confidence,
            evidence: evidenceFor(lines, ln),
          });
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
          confidence,
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
          confidence,
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
          confidence,
          evidence: evidenceFor(lines, ln),
        });
      },
    });
  } catch (err) {
    // traverse() threw on an otherwise-parseable file -- return whatever
    // facts were collected before the failure rather than nothing. The
    // caller (build.js) wraps this whole call too and is responsible for
    // recording that this file didn't fully complete.
  }

  return facts;
}
