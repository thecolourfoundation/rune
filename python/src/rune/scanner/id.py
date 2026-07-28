"""
Scoped id generator, mirroring scanner/id.js on the JS side. Each
build_graph() run creates its own generator, so ids reset per scan instead
of growing unbounded across repeated scans in a long-lived `rune serve`
process, and there's exactly one implementation of "prefix + counter"
shared by every extractor.
"""


def create_id_generator():
    counter = {"n": 0}

    def next_id(prefix: str) -> str:
        counter["n"] += 1
        return f"{prefix}_{counter['n']:x}"

    return next_id
