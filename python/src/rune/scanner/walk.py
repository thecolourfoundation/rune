import json
import os

DEFAULT_IGNORES = {
    "node_modules",
    ".git",
    ".rune",
    "dist",
    "build",
    ".next",
    "coverage",
    ".turbo",
    ".cache",
}

CODE_EXTENSIONS = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}


def walk_source_files(root_dir: str, ignore: list[str] | None = None) -> list[str]:
    """
    Recursively walks a directory, returning absolute paths of source files.

    Security invariant: dotfiles and dot-directories (.env, .env.*.js, .git,
    .ssh, editor config, etc.) are ALWAYS skipped, with no exceptions. A
    config file like `.env.js` would otherwise pass the CODE_EXTENSIONS
    check and have its contents (including secrets) embedded as evidence
    snippets in the understanding graph.

    Symlinks are never traversed, so a symlink pointing outside the project
    root can't pull external files into the scan.
    """
    ignore_set = set(DEFAULT_IGNORES) | set(ignore or [])
    results: list[str] = []

    def walk(directory: str) -> None:
        try:
            entries = list(os.scandir(directory))
        except OSError:
            return

        for entry in entries:
            name = entry.name

            if name.startswith("."):
                continue
            if name in ignore_set:
                continue
            if entry.is_symlink():
                continue

            if entry.is_dir(follow_symlinks=False):
                walk(entry.path)
            elif entry.is_file(follow_symlinks=False):
                _, ext = os.path.splitext(name)
                if ext in CODE_EXTENSIONS:
                    results.append(entry.path)

    walk(root_dir)
    return results


def read_file_safe(file_path: str) -> str | None:
    try:
        with open(file_path, "r", encoding="utf-8", errors="strict") as f:
            return f.read()
    except (OSError, UnicodeDecodeError):
        return None


_NEXT_CONFIG_FILES = ["next.config.js", "next.config.ts", "next.config.mjs"]


def detect_project_kind(root_dir: str) -> dict:
    pkg_path = os.path.join(root_dir, "package.json")
    pkg = {}
    try:
        with open(pkg_path, "r", encoding="utf-8") as f:
            pkg = json.load(f)
    except (OSError, json.JSONDecodeError):
        pass  # no package.json, or unreadable — proceed with empty deps

    deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}

    has_next = bool(deps.get("next")) or any(
        os.path.exists(os.path.join(root_dir, f)) for f in _NEXT_CONFIG_FILES
    )
    has_express = bool(deps.get("express"))
    has_react = bool(deps.get("react"))

    return {"pkg": pkg, "deps": deps, "has_next": has_next, "has_express": has_express, "has_react": has_react}
