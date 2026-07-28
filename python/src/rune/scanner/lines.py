"""
Precomputes line-start offsets once per file so individual regex matches
can resolve a line number in O(log n) via bisect instead of re-slicing and
re-splitting the whole file per match (which is O(file size) per match —
quadratic overall on files with many matches). Mirrors scanner/lines.js.
"""

import bisect


def build_line_index(content: str) -> list[int]:
    offsets = [0]
    for i, ch in enumerate(content):
        if ch == "\n":
            offsets.append(i + 1)
    return offsets


def line_number_at(line_offsets: list[int], index: int) -> int:
    """Returns the 1-indexed line number containing character offset `index`."""
    pos = bisect.bisect_right(line_offsets, index) - 1
    return pos + 1
