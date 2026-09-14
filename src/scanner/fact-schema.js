/**
 * Normalized Fact schema layer - Session 1.
 *
 * Additive only: every existing flat field (file, line, target, name, etc.)
 * from facts.js/express.js/nextjs.js/vue.js is preserved as-is so no
 * downstream consumer (derive.js, graph.facts, tests) breaks. This adds
 * four new fields on top: entity, source, location, metadata - the
 * generalized shape the roadmap's evidence model needs going forward.
 *
 * Type-specific entity mapping for known fact types; unknown/future types
 * (nextjs routes, vue components, anything added later) fall back to a
 * generic first-field-that-looks-like-an-identifier search so this does
 * not need updating every time a new parser is added.
 */

const ENTITY_FIELD_BY_TYPE = {
  import: "target",
  hook_usage: "name",
  function_call: "callee",
  react_component: "name",
  express_route: "routePath",
};

const CORE_FIELDS = new Set([
  "id", "type", "file", "line", "column", "confidence", "evidence",
  "entity", "source", "location", "metadata",
]);

function deriveEntity(fact) {
  const mapped = ENTITY_FIELD_BY_TYPE[fact.type];
  if (mapped && fact[mapped] !== undefined) return fact[mapped];
  return fact.name ?? fact.target ?? fact.callee ?? fact.routePath ?? fact.id;
}

function deriveMetadata(fact) {
  const metadata = {};
  for (const key of Object.keys(fact)) {
    if (!CORE_FIELDS.has(key)) metadata[key] = fact[key];
  }
  return metadata;
}

export function normalizeFact(fact) {
  return {
    ...fact,
    entity: deriveEntity(fact),
    source: fact.file,
    location: fact.column !== undefined
      ? { line: fact.line, column: fact.column }
      : { line: fact.line },
    metadata: deriveMetadata(fact),
  };
}

export function normalizeFacts(facts) {
  return facts.map(normalizeFact);
}
