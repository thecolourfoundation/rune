import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildGraph } from "../src/graph/build.js";

test("app.get('setting') is not a route, real routes still are", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-route-"));
  fs.writeFileSync(path.join(dir, "app.js"), [
    "const express = require('express');",
    "const app = express();",
    "const etag = app.get('etag fn');",
    "app.get('/users', (req, res) => res.send('ok'));",
    "app.post('/users', handler);",
    "app.listen(3000);",
    "",
  ].join("\n"));
  const graph = buildGraph(dir);
  const routes = graph.facts.filter((f) => f.type === "express_route");
  assert.deepEqual(
    routes.map((r) => `${r.method} ${r.routePath}`).sort(),
    ["GET /users", "POST /users"]
  );
});
