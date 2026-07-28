"""
Single source of truth for Rune's version, mirroring src/version.js on the
JS side: every place that needs the version (graph meta, the MCP server's
reported version, `rune --version`) calls this instead of hardcoding a
string that would silently drift from what's actually installed/published.
"""

import pathlib

_cached = None


def get_version() -> str:
    global _cached
    if _cached is not None:
        return _cached

    # Installed via pip: read from package metadata (works for both a real
    # install and an editable/dev install).
    try:
        from importlib.metadata import version, PackageNotFoundError

        try:
            _cached = version("rune")
            return _cached
        except PackageNotFoundError:
            pass
    except ImportError:
        pass

    # Running from source without an install: fall back to reading
    # pyproject.toml directly.
    try:
        pyproject_path = pathlib.Path(__file__).resolve().parents[2] / "pyproject.toml"
        text = pyproject_path.read_text(encoding="utf-8")
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("version"):
                _cached = line.split("=", 1)[1].strip().strip('"').strip("'")
                return _cached
    except OSError:
        pass

    _cached = "0.0.0"
    return _cached
