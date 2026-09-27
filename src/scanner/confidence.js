// FIXED (#21): __fixtures__ (a dunder-wrapped segment, same pattern as
// __tests__/__mocks__ which WERE already covered) was missing from the
// low-confidence path regex despite "fixture" being named explicitly in
// this file's own doc comment as one of the three cases this exists for.
const LOW_CONFIDENCE_DIR_RE = /(^|[\\/])(tests?|__tests__|__mocks__|__fixtures__|mocks|fixtures?|spec)([\\/]|$)/i;
const LOW_CONFIDENCE_FILE_RE = /\.(test|spec)\.[^./\\]+$/i;

export function confidenceForFile(relPath) {
  if (LOW_CONFIDENCE_DIR_RE.test(relPath) || LOW_CONFIDENCE_FILE_RE.test(relPath)) {
    return "low";
  }
  return "high";
}
