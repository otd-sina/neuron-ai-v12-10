from datetime import datetime
from backend.db.helpers import (
    db_set,
    db_get,
    db_delete,
    db_list_by_prefix,
    db_keys_by_prefix,
    next_counter,
)


SECONDS_PER_DAY = 24 * 60 * 60


def _assignment_ttl(duration_days: int) -> int:
    return duration_days * SECONDS_PER_DAY


def _remove_assignment_from_class(class_id: int, assignment_id: int) -> None:
    class_assignments: list = db_get(f"class:{class_id}:assignments", default=[])
    if assignment_id not in class_assignments:
        return
    class_assignments = [aid for aid in class_assignments if aid != assignment_id]
    db_set(f"class:{class_id}:assignments", class_assignments)


def create_assignment(class_id: int, title: str, description: str, duration_days: int) -> dict:
    assignment_id = next_counter("assignment")
    assignment = {
        "id": assignment_id,
        "class_id": class_id,
        "title": title,
        "description": description,
        "duration_days": duration_days,
        "created_at": datetime.utcnow().isoformat(),
    }
    db_set(
        f"assignment:{assignment_id}:info",
        assignment,
        expire=_assignment_ttl(duration_days),
    )

    class_assignments: list = db_get(f"class:{class_id}:assignments", default=[])
    if assignment_id not in class_assignments:
        class_assignments.append(assignment_id)
    db_set(f"class:{class_id}:assignments", class_assignments)

    return assignment


def get_assignment(assignment_id: int) -> dict | None:
    return db_get(f"assignment:{assignment_id}:info")


def delete_assignment(assignment_id: int) -> bool:
    assignment = get_assignment(assignment_id)
    if assignment is None:
        return False
    class_id = assignment.get("class_id")
    db_delete(f"assignment:{assignment_id}:info")
    if isinstance(class_id, int):
        _remove_assignment_from_class(class_id, assignment_id)
    return True


def list_assignments(class_id: int | None = None) -> list:
    assignments = sorted(
        [item for item in db_list_by_prefix("assignment:") if isinstance(item, dict) and "id" in item],
        key=lambda a: a["id"],
    )
    valid = []
    class_assignment_map: dict[int, set] = {}
    for item in assignments:
        item_class_id = item.get("class_id")
        if item_class_id is None:
            continue
        class_assignment_map.setdefault(item_class_id, set()).add(item["id"])
        if class_id is not None and item_class_id != class_id:
            continue
        valid.append(item)

    # Keep class assignment indexes in sync after TTL expiration.
    if class_id is not None:
        class_ids = [class_id]
    else:
        class_ids = []
        for key in db_keys_by_prefix("class:"):
            if not key.endswith(":assignments"):
                continue
            try:
                cid = int(key.split(":")[1])
                class_ids.append(cid)
            except (IndexError, ValueError):
                continue
    for cid in class_ids:
        stored_ids: list = db_get(f"class:{cid}:assignments", default=[])
        live_ids = class_assignment_map.get(cid, set())
        cleaned_ids = [aid for aid in stored_ids if aid in live_ids]
        if cleaned_ids != stored_ids:
            db_set(f"class:{cid}:assignments", cleaned_ids)

    return valid


def get_class_assignments(class_id: int) -> list:
    assignment_ids: list = db_get(f"class:{class_id}:assignments", default=[])
    assignments = []
    changed = False
    for aid in assignment_ids:
        assignment = get_assignment(aid)
        if assignment:
            assignments.append(assignment)
            continue
        changed = True

    if changed:
        db_set(f"class:{class_id}:assignments", [a["id"] for a in assignments])

    return sorted(assignments, key=lambda a: a["id"])
