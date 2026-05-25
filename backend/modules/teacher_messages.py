from __future__ import annotations

from datetime import datetime
from typing import Any

from backend.db.helpers import db_get, db_set, next_counter


def _utcnow_iso() -> str:
    return datetime.utcnow().isoformat()


def _msg_key(message_id: int) -> str:
    return f"teacher_message:{message_id}:info"


def _student_index_key(student_id: int) -> str:
    return f"student:{student_id}:teacher_messages"


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def list_student_messages(student_id: int) -> list[dict]:
    ids = db_get(_student_index_key(student_id), default=[])
    if not isinstance(ids, list):
        return []

    rows: list[dict] = []
    for raw_id in ids:
        if not isinstance(raw_id, int):
            continue
        record = db_get(_msg_key(raw_id))
        if isinstance(record, dict):
            rows.append(record)

    rows.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return rows


def create_teacher_message(
    student_id: int,
    message_text: str,
    teacher_id: int | None = None,
    author_name: str | None = None,
) -> dict:
    message_id = next_counter("teacher_message")
    payload = {
        "id": message_id,
        "student_id": student_id,
        "teacher_id": teacher_id,
        "author": _normalize_text(author_name) or "Teacher",
        "message_text": _normalize_text(message_text),
        "created_at": _utcnow_iso(),
        "is_read": False,
    }

    db_set(_msg_key(message_id), payload)
    ids = db_get(_student_index_key(student_id), default=[])
    if not isinstance(ids, list):
        ids = []
    if message_id not in ids:
        ids.append(message_id)
    db_set(_student_index_key(student_id), ids)
    return payload
