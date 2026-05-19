from datetime import datetime
from backend.db.helpers import db_set, db_get, db_list_by_prefix, next_counter


def _safe_parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def store_exam_result(
    student_id: int,
    grade_level: str,
    subject: str,
    score: float,
    weakness_topic: str,
) -> dict:
    exam_id = next_counter("exam")
    result = {
        "exam_id": exam_id,
        "student_id": student_id,
        "grade_level": grade_level,
        "subject": subject,
        "score": score,
        "weakness_topic": weakness_topic,
        "source": "personal",
        "created_at": datetime.utcnow().isoformat(),
    }
    db_set(f"exam:{student_id}:{exam_id}:result", result)

    history_key = f"exam:{student_id}:history"
    history: list = db_get(history_key, default=[])
    if not isinstance(history, list):
        history = []
    history.append(exam_id)
    db_set(history_key, history)

    return result


def get_exam_result(student_id: int, exam_id: int) -> dict | None:
    return db_get(f"exam:{student_id}:{exam_id}:result")


def list_exam_results(student_id: int | None = None) -> list:
    results = db_list_by_prefix("exam:")
    valid = []
    for item in results:
        if isinstance(item, dict) and "exam_id" in item:
            if student_id is not None and item.get("student_id") != student_id:
                continue
            valid.append(item)

    return sorted(
        valid,
        key=lambda result: _safe_parse_datetime(result.get("created_at")) or datetime.min,
        reverse=True,
    )
