from __future__ import annotations

from datetime import date, datetime
from typing import Any

from backend.db.helpers import db_delete, db_get, db_keys_by_prefix, db_set, next_counter
from backend.modules.classes import get_class, get_class_students, list_classes
from backend.modules.students import get_student

ALLOWED_ATTENDANCE_STATUSES = {"absent", "late", "left_early", "excused"}
PARTICIPATION_MIN_SCORE = 0.0
PARTICIPATION_MAX_SCORE = 5.0


def _utcnow_iso() -> str:
    return datetime.utcnow().isoformat()


def _safe_parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _normalize_date_token(raw_value: Any) -> str | None:
    if isinstance(raw_value, date):
        return raw_value.isoformat()

    text = _normalize_text(raw_value)
    if not text:
        return datetime.utcnow().date().isoformat()

    if len(text) == 10:
        try:
            return datetime.strptime(text, "%Y-%m-%d").date().isoformat()
        except ValueError:
            return None

    parsed = _safe_parse_datetime(text)
    if parsed is None:
        return None

    return parsed.date().isoformat()


def _to_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = _normalize_text(value)
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _to_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if value.is_integer():
            return int(value)
        return None
    text = _normalize_text(value)
    if not text:
        return None
    if text.isdigit():
        return int(text)
    return None


def _normalize_attendance_status(raw_status: Any) -> str:
    status = _normalize_text(raw_status).lower()
    if not status:
        return "present"
    if status in ALLOWED_ATTENDANCE_STATUSES:
        return status
    if status == "present":
        return "present"
    return "present"


def _record_key(record_id: int) -> str:
    return f"gradebook:record:{record_id}:info"


def _class_record_index_key(class_id: int) -> str:
    return f"class:{class_id}:gradebook_records"


def _student_record_index_key(student_id: int) -> str:
    return f"student:{student_id}:gradebook_records"


def _attendance_key(class_id: int, attendance_date: str) -> str:
    return f"gradebook:attendance:{class_id}:{attendance_date}:exceptions"


def _attendance_dates_key(class_id: int) -> str:
    return f"class:{class_id}:attendance_dates"


def _attendance_student_record_key(student_id: int, attendance_date: str) -> str:
    return f"gradebook:attendance:student:{student_id}:{attendance_date}:record"


def _attendance_student_dates_key(student_id: int) -> str:
    return f"student:{student_id}:attendance_dates"


def _participation_key(class_id: int, participation_date: str) -> str:
    return f"gradebook:participation:{class_id}:{participation_date}:scores"


def _participation_dates_key(class_id: int) -> str:
    return f"class:{class_id}:participation_dates"


def _ensure_int_list(key: str) -> list[int]:
    values = db_get(key, default=[])
    if not isinstance(values, list):
        return []

    normalized: list[int] = []
    for item in values:
        value = _to_int(item)
        if value is not None and value not in normalized:
            normalized.append(value)
    return normalized


def _ensure_date_list(key: str) -> list[str]:
    values = db_get(key, default=[])
    if not isinstance(values, list):
        return []

    normalized: list[str] = []
    for item in values:
        token = _normalize_date_token(item)
        if token and token not in normalized:
            normalized.append(token)
    return normalized


def _append_unique_value(key: str, value: int | str) -> None:
    values = db_get(key, default=[])
    if not isinstance(values, list):
        values = []
    if value not in values:
        values.append(value)
    db_set(key, values)


def _remove_value_from_index(key: str, value: int | str) -> None:
    values = db_get(key, default=[])
    if not isinstance(values, list):
        return

    cleaned = [item for item in values if item != value]
    if cleaned:
        db_set(key, cleaned)
        return

    db_delete(key)


def _get_class_student_map(class_id: int) -> tuple[dict[int, dict], str | None]:
    class_info = get_class(class_id)
    if class_info is None:
        return {}, "class_not_found"

    students = get_class_students(class_id)
    by_id: dict[int, dict] = {}
    for student in students:
        student_id = student.get("id")
        if isinstance(student_id, int):
            by_id[student_id] = student

    return by_id, None


def _build_percentage(score: float, max_score: float) -> float:
    if max_score <= 0:
        return 0.0
    return round((score / max_score) * 100, 2)


def get_grade_record(record_id: int) -> dict | None:
    record = db_get(_record_key(record_id))
    if isinstance(record, dict):
        return record
    return None


def create_grade_record(
    class_id: int,
    student_id: int,
    subject: str,
    title: str,
    assessment_type: str,
    score: float,
    max_score: float,
    weight: float = 1.0,
    recorded_at: str | None = None,
    term: str | None = None,
    notes: str | None = None,
) -> tuple[dict | None, str | None]:
    class_info = get_class(class_id)
    if class_info is None:
        return None, "کلاس موردنظر پیدا نشد."

    student = get_student(student_id)
    if student is None:
        return None, "دانش‌آموز موردنظر پیدا نشد."

    if student.get("class_id") != class_id:
        return None, "دانش‌آموز انتخاب‌شده در این کلاس عضو نیست."

    clean_subject = _normalize_text(subject)
    clean_title = _normalize_text(title)
    clean_type = _normalize_text(assessment_type).lower() or "quiz"
    clean_term = _normalize_text(term)
    clean_notes = _normalize_text(notes)

    if not clean_subject:
        return None, "درس نمی‌تواند خالی باشد."

    if not clean_title:
        return None, "عنوان ارزیابی نمی‌تواند خالی باشد."

    if max_score <= 0:
        return None, "حداکثر نمره باید بیشتر از صفر باشد."

    if score < 0 or score > max_score:
        return None, "نمره باید بین صفر تا حداکثر نمره باشد."

    if weight <= 0:
        return None, "وزن ارزیابی باید بیشتر از صفر باشد."

    recorded_date = _normalize_date_token(recorded_at)
    if recorded_date is None:
        return None, "تاریخ ثبت نمره معتبر نیست."

    record_id = next_counter("gradebook_record")
    now = _utcnow_iso()
    record = {
        "id": record_id,
        "class_id": class_id,
        "student_id": student_id,
        "subject": clean_subject,
        "assessment_type": clean_type,
        "title": clean_title,
        "score": round(float(score), 2),
        "max_score": round(float(max_score), 2),
        "weight": round(float(weight), 2),
        "percentage": _build_percentage(float(score), float(max_score)),
        "term": clean_term,
        "notes": clean_notes,
        "recorded_at": recorded_date,
        "created_at": now,
        "updated_at": now,
    }

    db_set(_record_key(record_id), record)
    _append_unique_value(_class_record_index_key(class_id), record_id)
    _append_unique_value(_student_record_index_key(student_id), record_id)

    return record, None


def update_grade_record(record_id: int, updates: dict) -> tuple[dict | None, str | None]:
    record = get_grade_record(record_id)
    if record is None:
        return None, "رکورد نمره پیدا نشد."

    next_class_id = record.get("class_id")
    next_student_id = record.get("student_id")

    if "class_id" in updates:
        proposed_class = _to_int(updates.get("class_id"))
        if proposed_class is None or get_class(proposed_class) is None:
            return None, "کلاس انتخاب‌شده معتبر نیست."
        next_class_id = proposed_class

    if "student_id" in updates:
        proposed_student = _to_int(updates.get("student_id"))
        if proposed_student is None:
            return None, "دانش‌آموز انتخاب‌شده معتبر نیست."
        student = get_student(proposed_student)
        if student is None:
            return None, "دانش‌آموز انتخاب‌شده پیدا نشد."
        next_student_id = proposed_student

    next_student = get_student(next_student_id)
    if next_student is None:
        return None, "دانش‌آموز انتخاب‌شده پیدا نشد."

    if next_student.get("class_id") != next_class_id:
        return None, "دانش‌آموز انتخاب‌شده در کلاس جدید عضو نیست."

    if "subject" in updates:
        subject = _normalize_text(updates.get("subject"))
        if not subject:
            return None, "نام درس معتبر نیست."
        record["subject"] = subject

    if "title" in updates:
        title = _normalize_text(updates.get("title"))
        if not title:
            return None, "عنوان ارزیابی معتبر نیست."
        record["title"] = title

    if "assessment_type" in updates:
        record["assessment_type"] = _normalize_text(updates.get("assessment_type")).lower() or "quiz"

    if "term" in updates:
        record["term"] = _normalize_text(updates.get("term"))

    if "notes" in updates:
        record["notes"] = _normalize_text(updates.get("notes"))

    if "recorded_at" in updates:
        recorded_at = _normalize_date_token(updates.get("recorded_at"))
        if recorded_at is None:
            return None, "تاریخ ثبت نمره معتبر نیست."
        record["recorded_at"] = recorded_at

    current_score = _to_float(record.get("score")) or 0.0
    current_max_score = _to_float(record.get("max_score")) or 0.0
    current_weight = _to_float(record.get("weight")) or 1.0

    if "score" in updates:
        proposed_score = _to_float(updates.get("score"))
        if proposed_score is None:
            return None, "نمره واردشده معتبر نیست."
        current_score = proposed_score

    if "max_score" in updates:
        proposed_max = _to_float(updates.get("max_score"))
        if proposed_max is None or proposed_max <= 0:
            return None, "حداکثر نمره باید بیشتر از صفر باشد."
        current_max_score = proposed_max

    if "weight" in updates:
        proposed_weight = _to_float(updates.get("weight"))
        if proposed_weight is None or proposed_weight <= 0:
            return None, "وزن ارزیابی باید بیشتر از صفر باشد."
        current_weight = proposed_weight

    if current_score < 0 or current_score > current_max_score:
        return None, "نمره باید بین صفر تا حداکثر نمره باشد."

    old_class_id = record.get("class_id")
    old_student_id = record.get("student_id")

    record["class_id"] = next_class_id
    record["student_id"] = next_student_id
    record["score"] = round(float(current_score), 2)
    record["max_score"] = round(float(current_max_score), 2)
    record["weight"] = round(float(current_weight), 2)
    record["percentage"] = _build_percentage(float(current_score), float(current_max_score))
    record["updated_at"] = _utcnow_iso()

    db_set(_record_key(record_id), record)

    if old_class_id != next_class_id:
        _remove_value_from_index(_class_record_index_key(old_class_id), record_id)
        _append_unique_value(_class_record_index_key(next_class_id), record_id)

    if old_student_id != next_student_id:
        _remove_value_from_index(_student_record_index_key(old_student_id), record_id)
        _append_unique_value(_student_record_index_key(next_student_id), record_id)

    return record, None


def delete_grade_record(record_id: int) -> bool:
    record = get_grade_record(record_id)
    if record is None:
        return False

    db_delete(_record_key(record_id))

    class_id = record.get("class_id")
    if isinstance(class_id, int):
        _remove_value_from_index(_class_record_index_key(class_id), record_id)

    student_id = record.get("student_id")
    if isinstance(student_id, int):
        _remove_value_from_index(_student_record_index_key(student_id), record_id)

    return True


def _collect_indexed_records(index_key: str) -> list[dict]:
    record_ids = _ensure_int_list(index_key)
    records: list[dict] = []
    cleaned_ids: list[int] = []

    for record_id in record_ids:
        record = get_grade_record(record_id)
        if not isinstance(record, dict):
            continue
        records.append(record)
        cleaned_ids.append(record_id)

    if cleaned_ids != record_ids:
        if cleaned_ids:
            db_set(index_key, cleaned_ids)
        else:
            db_delete(index_key)

    return records


def list_grade_records(
    class_id: int | None = None,
    student_id: int | None = None,
    subject: str | None = None,
    assessment_type: str | None = None,
) -> list[dict]:
    if isinstance(student_id, int):
        records = _collect_indexed_records(_student_record_index_key(student_id))
    elif isinstance(class_id, int):
        records = _collect_indexed_records(_class_record_index_key(class_id))
    else:
        records = []
        for key in db_keys_by_prefix("gradebook:record:"):
            if not key.endswith(":info"):
                continue
            record = db_get(key)
            if isinstance(record, dict) and isinstance(record.get("id"), int):
                records.append(record)

    filtered: list[dict] = []
    normalized_subject = _normalize_text(subject).lower()
    normalized_type = _normalize_text(assessment_type).lower()

    for record in records:
        if isinstance(class_id, int) and record.get("class_id") != class_id:
            continue
        if isinstance(student_id, int) and record.get("student_id") != student_id:
            continue
        if normalized_subject and _normalize_text(record.get("subject")).lower() != normalized_subject:
            continue
        if normalized_type and _normalize_text(record.get("assessment_type")).lower() != normalized_type:
            continue
        filtered.append(record)

    return sorted(
        filtered,
        key=lambda item: (
            _normalize_date_token(item.get("recorded_at")) or "0000-00-00",
            _safe_parse_datetime(item.get("updated_at")) or datetime.min,
            item.get("id", 0),
        ),
        reverse=True,
    )


def list_class_attendance_dates(class_id: int) -> list[str]:
    dates = _ensure_date_list(_attendance_dates_key(class_id))
    dates.sort()
    return dates


def _load_attendance_exceptions(class_id: int, attendance_date: str) -> dict[str, dict]:
    raw = db_get(_attendance_key(class_id, attendance_date), default={})
    if not isinstance(raw, dict):
        return {}

    normalized: dict[str, dict] = {}
    for student_key, payload in raw.items():
        student_id = _to_int(student_key)
        if student_id is None or not isinstance(payload, dict):
            continue

        status = _normalize_attendance_status(payload.get("status"))
        if status == "present":
            continue

        normalized[str(student_id)] = {
            "status": status,
            "note": _normalize_text(payload.get("note")),
            "updated_at": payload.get("updated_at"),
        }

    return normalized


def get_class_attendance_sheet(class_id: int, attendance_date: str | None = None) -> tuple[dict | None, str | None]:
    class_info = get_class(class_id)
    if class_info is None:
        return None, "کلاس موردنظر پیدا نشد."

    date_token = _normalize_date_token(attendance_date)
    if date_token is None:
        return None, "تاریخ حضور و غیاب معتبر نیست."

    student_map, error = _get_class_student_map(class_id)
    if error:
        return None, "کلاس موردنظر پیدا نشد."

    exceptions = _load_attendance_exceptions(class_id, date_token)

    rows: list[dict] = []
    counts = {
        "present": 0,
        "absent": 0,
        "late": 0,
        "left_early": 0,
        "excused": 0,
    }

    for student_id in sorted(student_map):
        student = student_map[student_id]
        exception = exceptions.get(str(student_id), {})
        status = _normalize_attendance_status(exception.get("status"))
        note = _normalize_text(exception.get("note"))

        if status not in counts:
            status = "present"
        counts[status] += 1

        rows.append(
            {
                "student_id": student_id,
                "full_name": student.get("full_name", ""),
                "national_id": student.get("national_id", ""),
                "status": status,
                "note": note,
            }
        )

    return (
        {
            "class_id": class_id,
            "class_name": class_info.get("name") or f"Class {class_id}",
            "attendance_date": date_token,
            "total_students": len(rows),
            "saved_exceptions": len(exceptions),
            "counts": counts,
            "students": rows,
        },
        None,
    )


def save_class_attendance(
    class_id: int,
    attendance_date: str | None,
    exceptions: list[dict],
) -> tuple[dict | None, str | None]:
    class_info = get_class(class_id)
    if class_info is None:
        return None, "کلاس موردنظر پیدا نشد."

    date_token = _normalize_date_token(attendance_date)
    if date_token is None:
        return None, "تاریخ حضور و غیاب معتبر نیست."

    student_map, error = _get_class_student_map(class_id)
    if error:
        return None, "کلاس موردنظر پیدا نشد."

    normalized_exceptions: dict[str, dict] = {}
    now = _utcnow_iso()

    # Composite logical key: (student_id, attendance_date)
    for student_id in student_map:
        student_key = str(student_id)
        payload = {
            "student_id": student_id,
            "class_id": class_id,
            "attendance_date": date_token,
            "status": "present",
            "note": "",
            "updated_at": now,
        }
        db_set(_attendance_student_record_key(student_id, date_token), payload)
        _append_unique_value(_attendance_student_dates_key(student_id), date_token)

    for item in exceptions:
        if not isinstance(item, dict):
            continue

        student_id = _to_int(item.get("student_id"))
        if student_id is None or student_id not in student_map:
            continue

        status = _normalize_attendance_status(item.get("status"))
        if status == "present":
            continue

        note = _normalize_text(item.get("note"))
        normalized_exceptions[str(student_id)] = {
            "status": status,
            "note": note,
            "updated_at": now,
        }
        db_set(
            _attendance_student_record_key(student_id, date_token),
            {
                "student_id": student_id,
                "class_id": class_id,
                "attendance_date": date_token,
                "status": status,
                "note": note,
                "updated_at": now,
            },
        )

    key = _attendance_key(class_id, date_token)
    dates_key = _attendance_dates_key(class_id)

    _append_unique_value(dates_key, date_token)

    if normalized_exceptions:
        db_set(key, normalized_exceptions)
    else:
        db_delete(key)

    return get_class_attendance_sheet(class_id, date_token)


def list_class_participation_dates(class_id: int) -> list[str]:
    dates = _ensure_date_list(_participation_dates_key(class_id))
    dates.sort()
    return dates


def _load_participation_scores(class_id: int, participation_date: str) -> dict[str, dict]:
    raw = db_get(_participation_key(class_id, participation_date), default={})
    if not isinstance(raw, dict):
        return {}

    normalized: dict[str, dict] = {}
    for student_key, payload in raw.items():
        student_id = _to_int(student_key)
        if student_id is None or not isinstance(payload, dict):
            continue

        score = _to_float(payload.get("score"))
        if score is None:
            continue

        score = max(PARTICIPATION_MIN_SCORE, min(PARTICIPATION_MAX_SCORE, score))
        normalized[str(student_id)] = {
            "score": round(score, 2),
            "note": _normalize_text(payload.get("note")),
            "updated_at": payload.get("updated_at"),
        }

    return normalized


def get_class_participation_sheet(
    class_id: int,
    participation_date: str | None = None,
) -> tuple[dict | None, str | None]:
    class_info = get_class(class_id)
    if class_info is None:
        return None, "کلاس موردنظر پیدا نشد."

    date_token = _normalize_date_token(participation_date)
    if date_token is None:
        return None, "تاریخ مشارکت معتبر نیست."

    student_map, error = _get_class_student_map(class_id)
    if error:
        return None, "کلاس موردنظر پیدا نشد."

    score_map = _load_participation_scores(class_id, date_token)

    rows: list[dict] = []
    score_values: list[float] = []

    for student_id in sorted(student_map):
        student = student_map[student_id]
        score_payload = score_map.get(str(student_id), {})
        score = _to_float(score_payload.get("score"))
        note = _normalize_text(score_payload.get("note"))

        if score is not None:
            score = round(max(PARTICIPATION_MIN_SCORE, min(PARTICIPATION_MAX_SCORE, score)), 2)
            score_values.append(score)

        rows.append(
            {
                "student_id": student_id,
                "full_name": student.get("full_name", ""),
                "national_id": student.get("national_id", ""),
                "score": score,
                "note": note,
            }
        )

    average_score = round(sum(score_values) / len(score_values), 2) if score_values else None

    return (
        {
            "class_id": class_id,
            "class_name": class_info.get("name") or f"Class {class_id}",
            "participation_date": date_token,
            "total_students": len(rows),
            "scored_students": len(score_values),
            "average_score": average_score,
            "students": rows,
        },
        None,
    )


def save_class_participation(
    class_id: int,
    participation_date: str | None,
    entries: list[dict],
) -> tuple[dict | None, str | None]:
    class_info = get_class(class_id)
    if class_info is None:
        return None, "کلاس موردنظر پیدا نشد."

    date_token = _normalize_date_token(participation_date)
    if date_token is None:
        return None, "تاریخ مشارکت معتبر نیست."

    student_map, error = _get_class_student_map(class_id)
    if error:
        return None, "کلاس موردنظر پیدا نشد."

    normalized_entries: dict[str, dict] = {}
    for item in entries:
        if not isinstance(item, dict):
            continue

        student_id = _to_int(item.get("student_id"))
        if student_id is None or student_id not in student_map:
            continue

        score = _to_float(item.get("score"))
        if score is None:
            continue

        score = max(PARTICIPATION_MIN_SCORE, min(PARTICIPATION_MAX_SCORE, score))
        normalized_entries[str(student_id)] = {
            "score": round(score, 2),
            "note": _normalize_text(item.get("note")),
            "updated_at": _utcnow_iso(),
        }

    key = _participation_key(class_id, date_token)
    dates_key = _participation_dates_key(class_id)

    if normalized_entries:
        db_set(key, normalized_entries)
        _append_unique_value(dates_key, date_token)
    else:
        db_delete(key)
        _remove_value_from_index(dates_key, date_token)

    return get_class_participation_sheet(class_id, date_token)


def _build_subject_breakdown(records: list[dict]) -> list[dict]:
    groups: dict[str, list[float]] = {}

    for record in records:
        subject = _normalize_text(record.get("subject")) or "General"
        percentage = _to_float(record.get("percentage"))
        if percentage is None:
            continue
        groups.setdefault(subject, []).append(percentage)

    breakdown = [
        {
            "subject": subject,
            "assessment_count": len(percentages),
            "average_percentage": round(sum(percentages) / len(percentages), 2),
        }
        for subject, percentages in groups.items()
        if percentages
    ]

    return sorted(
        breakdown,
        key=lambda item: item.get("average_percentage") or 0,
        reverse=True,
    )


def _build_recent_assessments(records: list[dict], limit: int = 10) -> list[dict]:
    recent: list[dict] = []

    for record in records[:limit]:
        recent.append(
            {
                "record_id": record.get("id"),
                "subject": record.get("subject"),
                "title": record.get("title"),
                "assessment_type": record.get("assessment_type"),
                "score": record.get("score"),
                "max_score": record.get("max_score"),
                "weight": record.get("weight"),
                "percentage": record.get("percentage"),
                "recorded_at": record.get("recorded_at"),
            }
        )

    return recent


def calculate_student_attendance_summary(student_id: int, class_id: int | None) -> dict:
    if not isinstance(class_id, int):
        return {
            "tracked_days": 0,
            "present": 0,
            "absent": 0,
            "late": 0,
            "left_early": 0,
            "excused": 0,
            "present_rate": None,
        }

    class_dates = list_class_attendance_dates(class_id)
    student_dates = _ensure_date_list(_attendance_student_dates_key(student_id))
    dates = sorted(set(class_dates) | set(student_dates))
    if not dates:
        return {
            "tracked_days": 0,
            "present": 0,
            "absent": 0,
            "late": 0,
            "left_early": 0,
            "excused": 0,
            "present_rate": None,
        }

    counts = {
        "present": 0,
        "absent": 0,
        "late": 0,
        "left_early": 0,
        "excused": 0,
    }

    for date_token in dates:
        stored_record = db_get(_attendance_student_record_key(student_id, date_token), default={})
        if isinstance(stored_record, dict):
            status = _normalize_attendance_status(stored_record.get("status"))
        else:
            exceptions = _load_attendance_exceptions(class_id, date_token)
            status = _normalize_attendance_status(exceptions.get(str(student_id), {}).get("status"))
        if status not in counts:
            status = "present"
        counts[status] += 1

    tracked_days = len(dates)
    present_like_days = counts.get("present", 0) + counts.get("late", 0)
    total_counted_days = present_like_days + counts.get("absent", 0) + counts.get("excused", 0)
    present_rate = round((present_like_days / total_counted_days) * 100, 2) if total_counted_days > 0 else 0

    return {
        "tracked_days": tracked_days,
        "present": counts["present"],
        "absent": counts["absent"],
        "late": counts["late"],
        "left_early": counts["left_early"],
        "excused": counts["excused"],
        "present_rate": present_rate,
    }


def calculate_student_participation_summary(student_id: int, class_id: int | None) -> dict:
    if not isinstance(class_id, int):
        return {
            "tracked_days": 0,
            "entries_count": 0,
            "average_score": None,
            "average_percentage": None,
        }

    dates = list_class_participation_dates(class_id)
    if not dates:
        return {
            "tracked_days": 0,
            "entries_count": 0,
            "average_score": None,
            "average_percentage": None,
        }

    student_key = str(student_id)
    scores: list[float] = []
    for date_token in dates:
        entries = _load_participation_scores(class_id, date_token)
        score = _to_float(entries.get(student_key, {}).get("score"))
        if score is None:
            continue
        scores.append(score)

    average_score = round(sum(scores) / len(scores), 2) if scores else None
    average_percentage = (
        round((average_score / PARTICIPATION_MAX_SCORE) * 100, 2)
        if isinstance(average_score, (int, float)) and PARTICIPATION_MAX_SCORE > 0
        else None
    )

    return {
        "tracked_days": len(dates),
        "entries_count": len(scores),
        "average_score": average_score,
        "average_percentage": average_percentage,
    }


def _derive_performance_band(
    grade_average_percentage: float | None,
    attendance_rate: float | None,
) -> str:
    if grade_average_percentage is None and attendance_rate is None:
        return "insufficient_data"

    if grade_average_percentage is None:
        if isinstance(attendance_rate, (int, float)) and attendance_rate >= 95:
            return "good"
        return "needs_attention"

    if grade_average_percentage >= 90 and (attendance_rate is None or attendance_rate >= 93):
        return "excellent"
    if grade_average_percentage >= 75 and (attendance_rate is None or attendance_rate >= 85):
        return "good"
    if grade_average_percentage >= 60:
        return "needs_attention"
    return "at_risk"


def build_student_report_card(student_id: int, class_id: int | None = None) -> dict | None:
    student = get_student(student_id)
    if not isinstance(student, dict):
        return None

    resolved_class_id = class_id if isinstance(class_id, int) else student.get("class_id")
    records = list_grade_records(class_id=resolved_class_id, student_id=student_id)

    weighted_points = 0.0
    total_weight = 0.0

    for record in records:
        percentage = _to_float(record.get("percentage"))
        weight = _to_float(record.get("weight")) or 1.0
        if percentage is None:
            continue
        weighted_points += percentage * weight
        total_weight += weight

    grade_average_percentage = round(weighted_points / total_weight, 2) if total_weight > 0 else None
    subject_breakdown = _build_subject_breakdown(records)
    attendance_summary = calculate_student_attendance_summary(student_id, resolved_class_id)
    participation_summary = calculate_student_participation_summary(student_id, resolved_class_id)

    strongest_subject = subject_breakdown[0]["subject"] if subject_breakdown else None
    weakest_subject = subject_breakdown[-1]["subject"] if len(subject_breakdown) > 1 else strongest_subject

    performance_band = _derive_performance_band(
        grade_average_percentage,
        attendance_summary.get("present_rate"),
    )

    safe_student = {key: value for key, value in student.items() if key != "password_hash"}

    class_name = None
    if isinstance(resolved_class_id, int):
        class_info = get_class(resolved_class_id)
        if isinstance(class_info, dict):
            class_name = class_info.get("name")

    return {
        "student": safe_student,
        "class_id": resolved_class_id,
        "class_name": class_name,
        "grade_average_percentage": grade_average_percentage,
        "assessment_count": len(records),
        "subject_breakdown": subject_breakdown,
        "recent_assessments": _build_recent_assessments(records, limit=10),
        "attendance_summary": attendance_summary,
        "participation_summary": participation_summary,
        "strongest_subject": strongest_subject,
        "weakest_subject": weakest_subject,
        "performance_band": performance_band,
    }


def build_class_performance_analytics(class_id: int) -> dict | None:
    class_info = get_class(class_id)
    if not isinstance(class_info, dict):
        return None

    class_students = get_class_students(class_id)
    if not class_students:
        return {
            "class": class_info,
            "total_students": 0,
            "average_grade_percentage": None,
            "average_attendance_rate": None,
            "average_participation_score": None,
            "subject_performance": [],
            "top_performers": [],
            "students_requiring_support": [],
            "latest_attendance": None,
        }

    grade_values: list[float] = []
    attendance_values: list[float] = []
    participation_values: list[float] = []
    student_rows: list[dict] = []

    for student in class_students:
        student_id = student.get("id")
        if not isinstance(student_id, int):
            continue

        report = build_student_report_card(student_id, class_id=class_id)
        if not isinstance(report, dict):
            continue

        average = _to_float(report.get("grade_average_percentage"))
        attendance_rate = _to_float(report.get("attendance_summary", {}).get("present_rate"))
        participation_average = _to_float(report.get("participation_summary", {}).get("average_score"))

        if average is not None:
            grade_values.append(average)
        if attendance_rate is not None:
            attendance_values.append(attendance_rate)
        if participation_average is not None:
            participation_values.append(participation_average)

        student_rows.append(
            {
                "student_id": student_id,
                "full_name": student.get("full_name", ""),
                "grade_average_percentage": average,
                "attendance_rate": attendance_rate,
                "participation_average": participation_average,
                "performance_band": report.get("performance_band"),
            }
        )

    subject_performance = _build_subject_breakdown(list_grade_records(class_id=class_id))

    top_performers = sorted(
        [row for row in student_rows if isinstance(row.get("grade_average_percentage"), (int, float))],
        key=lambda row: row["grade_average_percentage"],
        reverse=True,
    )[:5]

    students_requiring_support = [
        row
        for row in student_rows
        if (
            isinstance(row.get("grade_average_percentage"), (int, float))
            and row["grade_average_percentage"] < 60
        )
        or (
            isinstance(row.get("attendance_rate"), (int, float))
            and row["attendance_rate"] < 85
        )
    ]

    attendance_dates = list_class_attendance_dates(class_id)
    latest_attendance = None
    if attendance_dates:
        latest_attendance, _ = get_class_attendance_sheet(class_id, attendance_dates[-1])

    return {
        "class": class_info,
        "total_students": len(student_rows),
        "average_grade_percentage": round(sum(grade_values) / len(grade_values), 2) if grade_values else None,
        "average_attendance_rate": (
            round(sum(attendance_values) / len(attendance_values), 2) if attendance_values else None
        ),
        "average_participation_score": (
            round(sum(participation_values) / len(participation_values), 2)
            if participation_values
            else None
        ),
        "subject_performance": subject_performance,
        "top_performers": top_performers,
        "students_requiring_support": students_requiring_support,
        "latest_attendance": latest_attendance,
    }




def get_student_gradebook_timeline(student_id: int, class_id: int | None = None) -> dict:
    student = get_student(student_id)
    if student is None:
        return {"attendance_exceptions": [], "participation_records": []}

    resolved_class_id = class_id if isinstance(class_id, int) else student.get("class_id")
    if not isinstance(resolved_class_id, int):
        return {"attendance_exceptions": [], "participation_records": []}

    attendance_exceptions: list[dict] = []
    student_key = str(student_id)
    for date_token in list_class_attendance_dates(resolved_class_id):
        entry = _load_attendance_exceptions(resolved_class_id, date_token).get(student_key)
        if not isinstance(entry, dict):
            continue
        attendance_exceptions.append({
            "date": date_token,
            "status": _normalize_attendance_status(entry.get("status")),
            "note": _normalize_text(entry.get("note")),
        })

    participation_records: list[dict] = []
    for date_token in list_class_participation_dates(resolved_class_id):
        entry = _load_participation_scores(resolved_class_id, date_token).get(student_key)
        if not isinstance(entry, dict):
            continue
        participation_records.append({
            "date": date_token,
            "score": _to_float(entry.get("score")),
            "note": _normalize_text(entry.get("note")),
        })

    attendance_exceptions.sort(key=lambda i: i.get("date") or "", reverse=True)
    participation_records.sort(key=lambda i: i.get("date") or "", reverse=True)

    return {
        "attendance_exceptions": attendance_exceptions,
        "participation_records": participation_records,
    }


def get_student_attendance_log(student_id: int, class_id: int | None = None) -> list[dict]:
    student = get_student(student_id)
    if student is None:
        return []

    resolved_class_id = class_id if isinstance(class_id, int) else student.get("class_id")
    if not isinstance(resolved_class_id, int):
        return []

    student_key = str(student_id)
    rows: list[dict] = []
    tracked_dates = set(list_class_attendance_dates(resolved_class_id))
    tracked_dates.update(_ensure_date_list(_attendance_student_dates_key(student_id)))

    for date_token in tracked_dates:
        stored_record = db_get(_attendance_student_record_key(student_id, date_token), default={})
        if isinstance(stored_record, dict):
            status = _normalize_attendance_status(stored_record.get("status"))
            note = _normalize_text(stored_record.get("note"))
        else:
            entry = _load_attendance_exceptions(resolved_class_id, date_token).get(student_key) or {}
            status = _normalize_attendance_status(entry.get("status"))
            note = _normalize_text(entry.get("note"))

        rows.append(
            {
                "date": date_token,
                "status": status,
                "note": note,
            }
        )

    rows.sort(key=lambda item: item.get("date") or "", reverse=True)
    return rows
def get_student_gradebook_summary(student_id: int, class_id: int | None = None) -> dict | None:
    report = build_student_report_card(student_id, class_id=class_id)
    if not isinstance(report, dict):
        return None

    attendance_summary = report.get("attendance_summary") or {}
    participation_summary = report.get("participation_summary") or {}

    return {
        "grade_average_percentage": report.get("grade_average_percentage"),
        "assessment_count": report.get("assessment_count"),
        "attendance_rate": attendance_summary.get("present_rate"),
        "absent_count": attendance_summary.get("absent"),
        "participation_average": participation_summary.get("average_score"),
        "performance_band": report.get("performance_band"),
        "strongest_subject": report.get("strongest_subject"),
        "weakest_subject": report.get("weakest_subject"),
    }


def _collect_attendance_overview() -> dict:
    total_slots = 0
    counts = {
        "present": 0,
        "absent": 0,
        "late": 0,
        "left_early": 0,
        "excused": 0,
    }
    recorded_days = 0

    for class_info in list_classes():
        class_id = class_info.get("id")
        if not isinstance(class_id, int):
            continue

        students = get_class_students(class_id)
        total_students = len(students)
        if total_students == 0:
            continue

        for date_token in list_class_attendance_dates(class_id):
            recorded_days += 1
            total_slots += total_students
            exceptions = _load_attendance_exceptions(class_id, date_token)

            absent_like = 0
            for payload in exceptions.values():
                status = _normalize_attendance_status(payload.get("status"))
                if status in counts and status != "present":
                    counts[status] += 1
                    absent_like += 1

            counts["present"] += max(total_students - absent_like, 0)

    present_rate = round((counts["present"] / total_slots) * 100, 2) if total_slots > 0 else None

    return {
        "recorded_days": recorded_days,
        "total_slots": total_slots,
        "present_rate": present_rate,
        "counts": counts,
    }


def _collect_participation_overview() -> dict:
    entries_count = 0
    scores: list[float] = []

    for class_info in list_classes():
        class_id = class_info.get("id")
        if not isinstance(class_id, int):
            continue

        for date_token in list_class_participation_dates(class_id):
            score_map = _load_participation_scores(class_id, date_token)
            for payload in score_map.values():
                score = _to_float(payload.get("score"))
                if score is None:
                    continue
                entries_count += 1
                scores.append(score)

    average_score = round(sum(scores) / len(scores), 2) if scores else None
    average_percentage = (
        round((average_score / PARTICIPATION_MAX_SCORE) * 100, 2)
        if isinstance(average_score, (int, float)) and PARTICIPATION_MAX_SCORE > 0
        else None
    )

    return {
        "entries_count": entries_count,
        "average_score": average_score,
        "average_percentage": average_percentage,
    }


def get_gradebook_overview() -> dict:
    records = list_grade_records()

    percentages = [
        percentage
        for percentage in (_to_float(record.get("percentage")) for record in records)
        if isinstance(percentage, (int, float))
    ]

    average_score_percentage = round(sum(percentages) / len(percentages), 2) if percentages else None
    subject_distribution = _build_subject_breakdown(records)

    return {
        "total_grade_records": len(records),
        "average_score_percentage": average_score_percentage,
        "subject_distribution": subject_distribution[:8],
        "attendance": _collect_attendance_overview(),
        "participation": _collect_participation_overview(),
        "last_updated": _utcnow_iso(),
    }
