/**
 * Precomputes line-start byte offsets once per file so individual matches can
 * resolve a line number in O(log n) instead of re-slicing and re-splitting
 * the whole file per match (which is O(file size) per match — quadratic
 * overall on files with many matches).
 */
export function buildLineIndex(content) {
  const offsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) offsets.push(i + 1);
  }
  return offsets;
}

/**
 * Returns the 1-indexed line number containing byte offset `index`.
 */
export function lineNumberAt(lineOffsets, index) {
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineOffsets[mid] <= index) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo + 1;
}
