/**
 * Intent layer: parses a raw objective string into a structured intent
 * object BEFORE anything touches the graph. This is the seam that fixes
 * the v0 bug where the raw prompt was treated as both the hypothesis
 * subject and the retrieval query.
 */

const INSTRUCTION_VOCAB = new Set([
  "analyze", "analysis", "explain", "identify", "give", "cite", "list",
  "show", "describe", "summarize", "insight", "insights", "evidence",
  "confidence", "architectural", "architecture", "dependency", "dependencies",
  "hotspot", "hotspots", "component", "components", "relate", "relates",
  "relationship", "exactly", "major", "important", "using", "graph",
  "matters", "top", "overview", "takeaway", "takeaways",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
]);

const STOPWORDS = new Set([
  "the", "is", "are", "why", "what", "how", "this", "that", "with", "for",
  "and", "does", "do", "a", "an", "in", "on", "of", "to", "it", "its",
  "each",
]);

const TASK_PATTERNS = [
  { taskType: "architecture-overview", pattern: /architect\w*|major component|how.*relate/i },
  { taskType: "dependency-trace", pattern: /depend(s|ency|encies)? on|what uses|impact of/i },
  { taskType: "hotspot-analysis", pattern: /hotspot|risk(iest)?|complexity/i },
  { taskType: "bug-investigation", pattern: /why does|fails?|broken|error/i },
  // Last on purpose: generic insight requests, so specific task types win.
  { taskType: "architecture-overview", pattern: /\b(insights?|overview|takeaways?)\b/i },
];

function classifyTaskType(objective) {
  for (const { taskType, pattern } of TASK_PATTERNS) {
    if (pattern.test(objective)) return taskType;
  }
  return "entity-lookup";
}

function extractTargetEntities(objective) {
  return [...new Set(
    objective
      .toLowerCase()
      .replace(/[^a-z0-9_./-]+/g, " ")
      .split(" ")
      .map((word) => word.replace(/^[._-]+|[._-]+$/g, ""))
      .filter((word) =>
        word.length > 2 &&
        !STOPWORDS.has(word) &&
        !INSTRUCTION_VOCAB.has(word)
      )
  )];
}

function extractOutputConstraints(objective) {
  const constraints = {};
  const exactCount = objective.match(/exactly (\d+)/i);
  if (exactCount) constraints.exactCount = parseInt(exactCount[1], 10);
  if (!constraints.exactCount) {
    const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const m = objective.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:[a-z-]+\s+){0,2}?(?:insights?|findings?|hypothes[ei]s|areas?|components?|modules?|issues?|risks?|takeaways?|points?)\b/i);
    if (m) {
      const v = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : WORDS[m[1].toLowerCase()];
      if (v > 0) constraints.exactCount = v;
    }
  }
  const maxWords = objective.match(/(?:under|max(?:imum)?)\s+(\d+)\s+words?/i);
  if (maxWords) constraints.maxWords = parseInt(maxWords[1], 10);
  const maxEvidence = objective.match(/max(?:imum)?\s+(\d+)\s+evidence/i);
  if (maxEvidence) constraints.maxEvidenceRefs = parseInt(maxEvidence[1], 10);
  if (/no file enumeration/i.test(objective)) constraints.noFileEnumeration = true;
  return constraints;
}

export function parseIntent(objective) {
  if (!objective || typeof objective !== "string") {
    throw new Error("parseIntent requires a non-empty objective string");
  }
  return {
    rawObjective: objective,
    taskType: classifyTaskType(objective),
    targetEntities: extractTargetEntities(objective),
    outputConstraints: extractOutputConstraints(objective),
  };
}
