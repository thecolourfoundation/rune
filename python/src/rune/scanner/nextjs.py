import os

IGNORED_PAGE_FILES = {"_app", "_document", "_error", "middleware"}
PAGE_EXTENSIONS = (".js", ".jsx", ".ts", ".tsx")
# Files the app router treats as special per-segment conventions but that
# are not themselves routes (layout/loading/error/etc). Only "page" and
# "route" define a navigable route or endpoint.
APP_ROUTER_ROUTE_BASENAMES = {"page", "route"}


def _transform_dynamic_segment(segment: str) -> str:
    """
    Converts one path segment into its route-pattern form, e.g.
    "[id]" -> ":id", "[...slug]" -> ":slug*", anything else -> itself.
    Shared by both the pages router and the app router so the bracket-syntax
    rule is defined in exactly one place.
    """
    if segment.startswith("[...") and segment.endswith("]"):
        return f":{segment[4:-1]}*"
    if segment.startswith("[") and segment.endswith("]"):
        return f":{segment[1:-1]}"
    return segment


def _segments_to_route_path(segments: list[str]) -> str:
    return "/" + "/".join(_transform_dynamic_segment(s) for s in segments)


def extract_next_routes(root_dir: str, next_id) -> list[dict]:
    """Detects Next.js routes from directory conventions (pages/ and app/ routers)."""
    facts: list[dict] = []

    pages_dir = None
    for candidate in (os.path.join(root_dir, "pages"), os.path.join(root_dir, "src", "pages")):
        if os.path.isdir(candidate):
            pages_dir = candidate
            break
    if pages_dir:
        _walk_pages(pages_dir, root_dir, facts, next_id)

    app_dir = None
    for candidate in (os.path.join(root_dir, "app"), os.path.join(root_dir, "src", "app")):
        if os.path.isdir(candidate):
            app_dir = candidate
            break
    if app_dir:
        _walk_app_router(app_dir, root_dir, facts, next_id, [])

    return facts


def _walk_pages(pages_dir: str, root_dir: str, facts: list[dict], next_id) -> None:
    for entry in os.scandir(pages_dir):
        if entry.name.startswith("."):
            continue
        full = entry.path
        if entry.is_dir(follow_symlinks=False):
            _walk_pages(full, root_dir, facts, next_id)
            continue

        base, ext = os.path.splitext(entry.name)
        if ext not in PAGE_EXTENSIONS:
            continue
        if base in IGNORED_PAGE_FILES:
            continue

        rel_to_pages_with_ext = os.path.relpath(full, pages_dir)
        rel_to_pages = rel_to_pages_with_ext[: -len(ext)]
        is_api = rel_to_pages == "api" or rel_to_pages.startswith(f"api{os.sep}")
        segments = [p for p in rel_to_pages.split(os.sep) if p != "index"]
        route_path = _segments_to_route_path(segments)

        facts.append({
            "id": next_id("nextroute"),
            "type": "next_api_route" if is_api else "next_page_route",
            "router": "pages",
            "routePath": route_path,
            "file": os.path.relpath(full, root_dir),
            "line": 1,
            "evidence": f"file convention: pages/{rel_to_pages_with_ext}",
        })


def _walk_app_router(directory: str, root_dir: str, facts: list[dict], next_id, segments: list[str]) -> None:
    for entry in os.scandir(directory):
        if entry.name.startswith("."):
            continue
        full = entry.path
        if entry.is_dir(follow_symlinks=False):
            is_route_group = entry.name.startswith("(") and entry.name.endswith(")")
            next_segments = segments if is_route_group else [*segments, entry.name]
            _walk_app_router(full, root_dir, facts, next_id, next_segments)
            continue

        base, ext = os.path.splitext(entry.name)
        if ext not in PAGE_EXTENSIONS:
            continue
        if base not in APP_ROUTER_ROUTE_BASENAMES:
            continue

        route_path = _segments_to_route_path(segments)
        facts.append({
            "id": next_id("nextroute"),
            "type": "next_page_route" if base == "page" else "next_api_route",
            "router": "app",
            "routePath": route_path,
            "file": os.path.relpath(full, root_dir),
            "line": 1,
            "evidence": f"file convention: app/{'/'.join(segments)}/{base}{ext}",
        })
