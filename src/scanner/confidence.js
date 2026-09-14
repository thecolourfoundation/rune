// Shared confidence scoring for extracted facts. A fact inside a test,
// spec, or fixture file is still a real match in that file, but it is not
// necessarily reflective of production code -- e.g. a "component" defined
// inside a snapshot fixture, or a helper only ever called from a test
// double. Downstream consumers (security findings already carry a
// confidence field for the same reason) can use this to weight a fact
// rather than discard it outright.
const LOW_CONFIDENCE_DIR_RE = /(^|[\\/])(tests?|__tests__|__mocks__|mocks|fixtures?|spec)([\\/]|$)/i;
const LOW_CONFIDENCE_FILE_RE = /\.(test|spec)\.[^./\\]+$/i;

export function confidenceForFile(relPath) {
  if (LOW_CONFIDENCE_DIR_RE.test(relPath) || LOW_CONFIDENCE_FILE_RE.test(relPath)) {
    return "low";
  }
  return "high";
}
