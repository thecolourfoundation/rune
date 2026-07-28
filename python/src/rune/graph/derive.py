from ..scanner.id import create_id_generator

"""
Derived understanding is always computed FROM facts, and every derived node
records which fact ids it is based on (`based_on`), so a conclusion can be
traced back to the evidence that produced it.
"""


def derive_understanding(facts: list[dict], project_info: dict) -> list[dict]:
    derived: list[dict] = []
    next_id = create_id_generator()

    components = [f for f in facts if f["type"] == "react_component"]
    express_routes = [f for f in facts if f["type"] == "express_route"]
    next_page_routes = [f for f in facts if f["type"] == "next_page_route"]
    next_api_routes = [f for f in facts if f["type"] == "next_api_route"]
    imports = [f for f in facts if f["type"] == "import"]

    # --- Architecture summary ---
    frameworks = []
    if project_info["has_next"]:
        frameworks.append("Next.js")
    if project_info["has_express"]:
        frameworks.append("Express")
    if project_info["has_react"] and not project_info["has_next"]:
        frameworks.append("React")

    project_name = (project_info.get("pkg") or {}).get("name")
    name_prefix = f'"{project_name}" — ' if project_name else ""

    if frameworks:
        description = (
            f"{name_prefix}Detected stack: {', '.join(frameworks)}. {len(components)} React component(s), "
            f"{len(express_routes)} Express route(s), {len(next_page_routes)} Next.js page route(s), "
            f"{len(next_api_routes)} Next.js API route(s) across the scanned source tree."
        )
        confidence = "high"
    else:
        description = (
            f"{name_prefix}No first-class framework (React/Next.js/Express) confirmed from package.json. "
            f"{len(components)} component-like function(s) detected heuristically."
        )
        confidence = "medium"

    derived.append({
        "id": next_id("derived"),
        "type": "architecture_summary",
        "description": description,
        "basedOn": [
            *[c["id"] for c in components],
            *[r["id"] for r in express_routes],
            *[r["id"] for r in next_page_routes],
            *[r["id"] for r in next_api_routes],
        ],
        "confidence": confidence,
    })

    # --- File -> internal import graph (relationships) ---
    imports_by_file: dict[str, list[dict]] = {}
    for imp in imports:
        if not imp["target"].startswith("."):
            continue  # external package, skip for relationship graph
        imports_by_file.setdefault(imp["file"], []).append(imp)

    for file, file_imports in imports_by_file.items():
        seen_targets = []
        for i in file_imports:
            if i["target"] not in seen_targets:
                seen_targets.append(i["target"])
        derived.append({
            "id": next_id("derived"),
            "type": "file_dependency",
            "file": file,
            "dependsOn": seen_targets,
            "basedOn": [i["id"] for i in file_imports],
            "confidence": "high",
        })

    # --- API surface (unified view across Express + Next) ---
    api_surface = [
        {"method": r["method"], "path": r["routePath"], "file": r["file"], "factId": r["id"]}
        for r in express_routes
    ] + [
        {"method": "ANY", "path": r["routePath"], "file": r["file"], "factId": r["id"]}
        for r in next_api_routes
    ]
    if api_surface:
        derived.append({
            "id": next_id("derived"),
            "type": "api_surface",
            "description": f"{len(api_surface)} API endpoint(s) discovered across Express and Next.js route conventions.",
            "routes": api_surface,
            "basedOn": [r["factId"] for r in api_surface],
            "confidence": "high",
        })

    # --- Component index ---
    if components:
        derived.append({
            "id": next_id("derived"),
            "type": "component_index",
            "description": f"{len(components)} React component(s) identified by declaration pattern + JSX-return heuristic.",
            "components": [
                {"name": c["name"], "file": c["file"], "line": c["line"], "kind": c["kind"], "factId": c["id"]}
                for c in components
            ],
            "basedOn": [c["id"] for c in components],
            "confidence": "medium",
        })

    return derived
