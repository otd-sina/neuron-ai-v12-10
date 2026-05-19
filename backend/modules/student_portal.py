import re
import secrets
from datetime import datetime, timedelta

from backend.db.helpers import db_delete, db_get, db_keys_by_prefix, db_set
from backend.modules.auth import hash_password
from backend.modules.gradebook import get_student_gradebook_summary


SESSION_TTL_DAYS = 7
SESSION_TTL_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60
NATIONAL_ID_PATTERN = re.compile(r"^\d{10}$")


def _utcnow() -> datetime:
    return datetime.utcnow()


def _safe_parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def normalize_national_id(national_id: str) -> str:
    return national_id.strip()


def is_valid_national_id(national_id: str) -> bool:
    return bool(NATIONAL_ID_PATTERN.fullmatch(normalize_national_id(national_id)))


def _find_student_by_national_id(national_id: str) -> dict | None:
    normalized = normalize_national_id(national_id)
    for key in db_keys_by_prefix("student:"):
        if not key.endswith(":info"):
            continue
        student = db_get(key)
        if not isinstance(student, dict):
            continue
        if student.get("national_id") == normalized:
            return student
    return None


def authenticate_student(national_id: str, password: str) -> dict | None:
    student = _find_student_by_national_id(national_id)
    if not student:
        return None
    password_hash = student.get("password_hash")
    if password_hash != hash_password(password):
        return None
    return student


def _build_session_key(student_id: int, token: str) -> str:
    return f"student:{student_id}:sessions:{token}"


def _extract_student_id_from_token(token: str) -> int | None:
    if not token or "." not in token:
        return None
    possible_id, _ = token.split(".", 1)
    if not possible_id.isdigit():
        return None
    return int(possible_id)


def create_student_session(student_id: int) -> dict:
    token = f"{student_id}.{secrets.token_urlsafe(32)}"
    now = _utcnow()
    expires_at = now + timedelta(days=SESSION_TTL_DAYS)

    session = {
        "student_id": student_id,
        "token": token,
        "created_at": now.isoformat(),
        "expires_at": expires_at.isoformat(),
        "last_activity": now.isoformat(),
    }
    db_set(_build_session_key(student_id, token), session, expire=SESSION_TTL_SECONDS)
    return session


def get_student_session(token: str) -> dict | None:
    student_id = _extract_student_id_from_token(token)
    if student_id is None:
        return None
    session = db_get(_build_session_key(student_id, token))
    if not isinstance(session, dict):
        return None
    return session


def delete_student_session(token: str) -> bool:
    student_id = _extract_student_id_from_token(token)
    if student_id is None:
        return False
    key = _build_session_key(student_id, token)
    if not db_get(key):
        return False
    db_delete(key)
    return True


def validate_and_refresh_session(token: str) -> dict | None:
    session = get_student_session(token)
    if not session:
        return None

    expires_at = _safe_parse_datetime(session.get("expires_at"))
    if expires_at is None or _utcnow() > expires_at:
        delete_student_session(token)
        return None

    now = _utcnow()
    session["last_activity"] = now.isoformat()
    session["expires_at"] = (now + timedelta(days=SESSION_TTL_DAYS)).isoformat()

    student_id = session.get("student_id")
    if not isinstance(student_id, int):
        return None

    db_set(_build_session_key(student_id, token), session, expire=SESSION_TTL_SECONDS)
    return session


def get_student_by_id(student_id: int) -> dict | None:
    student = db_get(f"student:{student_id}:info")
    if isinstance(student, dict):
        return student
    return None


def get_student_profile_for_api(student: dict) -> dict:
    grade_id = student.get("grade_id")
    class_id = student.get("class_id")

    grade_name = None
    if isinstance(grade_id, int):
        grade = db_get(f"grade:{grade_id}:info")
        if isinstance(grade, dict):
            possible_name = str(grade.get("name") or "").strip()
            if possible_name:
                grade_name = possible_name

    class_name = None
    if isinstance(class_id, int):
        class_obj = db_get(f"class:{class_id}:info")
        if isinstance(class_obj, dict):
            possible_name = str(class_obj.get("name") or "").strip()
            if possible_name:
                class_name = possible_name

    return {
        "name": student.get("full_name", ""),
        "full_name": student.get("full_name", ""),
        "national_id": student.get("national_id", ""),
        "phone": student.get("phone", ""),
        "grade": grade_id,
        "grade_id": grade_id,
        "grade_name": grade_name,
        "class_id": student.get("class_id"),
        "class_name": class_name,
        "school_name": student.get("school_name", ""),
        "created_at": student.get("created_at"),
    }


def _normalize_exam_id_token(raw_exam_id) -> str | None:
    if isinstance(raw_exam_id, int):
        return str(raw_exam_id)
    if isinstance(raw_exam_id, str):
        token = raw_exam_id.strip()
        return token or None
    return None


def _collect_exam_ids_from_history(student_id: int) -> list[str]:
    history = db_get(f"exam:{student_id}:history", default=[])
    exam_ids: list[str] = []
    seen: set[str] = set()

    if isinstance(history, list):
        for item in history:
            if isinstance(item, (int, str)):
                exam_id = _normalize_exam_id_token(item)
                if exam_id and exam_id not in seen:
                    exam_ids.append(exam_id)
                    seen.add(exam_id)
                continue
            if isinstance(item, dict):
                exam_id = _normalize_exam_id_token(item.get("exam_id"))
                if exam_id and exam_id not in seen:
                    exam_ids.append(exam_id)
                    seen.add(exam_id)

    # Backward compatibility: older data may not have exam history.
    for key in db_keys_by_prefix(f"exam:{student_id}:"):
        if not key.endswith(":result"):
            continue
        parts = key.split(":")
        if len(parts) < 4:
            continue
        exam_id_text = parts[2]
        exam_id = _normalize_exam_id_token(exam_id_text)
        if exam_id and exam_id not in seen:
            exam_ids.append(exam_id)
            seen.add(exam_id)

    return exam_ids


def get_latest_exam(student_id: int) -> dict | None:
    history = get_student_exam_history(student_id, limit=1)
    if not history:
        return None
    return history[0]


def _normalize_exam_result(raw_result: dict, exam_id_fallback: str) -> dict:
    total = raw_result.get("total")
    score = raw_result.get("score")
    percentage = raw_result.get("percentage")

    if not isinstance(percentage, (int, float)):
        if isinstance(total, (int, float)) and total > 0 and isinstance(score, (int, float)):
            percentage = round((float(score) / float(total)) * 100, 2)
        else:
            percentage = None

    source = str(raw_result.get("source") or "").strip().lower()
    school_exam_id = raw_result.get("school_exam_id")
    if source not in {"personal", "school"}:
        source = "school" if school_exam_id is not None else "personal"

    return {
        "exam_id": str(raw_result.get("exam_id") or exam_id_fallback),
        "subject": raw_result.get("subject") or "آزمون",
        "score": score,
        "total": total,
        "percentage": percentage,
        "weak_points": raw_result.get("weak_points", []),
        "created_at": raw_result.get("created_at") or raw_result.get("timestamp"),
        "source": source,
        "school_exam_id": school_exam_id,
        "exam_title": raw_result.get("exam_title"),
    }


def get_student_exam_history(student_id: int, limit: int | None = None) -> list[dict]:
    exam_ids = _collect_exam_ids_from_history(student_id)
    if not exam_ids:
        return []

    history: list[dict] = []
    for exam_id in exam_ids:
        result = db_get(f"exam:{student_id}:{exam_id}:result")
        if not isinstance(result, dict):
            continue
        history.append(_normalize_exam_result(result, exam_id))

    sorted_history = sorted(
        history,
        key=lambda item: _safe_parse_datetime(item.get("created_at")) or _utcnow(),
        reverse=True,
    )

    if isinstance(limit, int) and limit > 0:
        return sorted_history[:limit]

    return sorted_history


def _build_exam_analytics_snapshot(exam_history: list[dict]) -> dict:
    percentages: list[float] = []
    subject_performance: dict[str, list[float]] = {}
    weak_topic_counter: dict[str, int] = {}

    for exam in exam_history:
        percentage = exam.get("percentage")
        subject = str(exam.get("subject") or "").strip()

        if isinstance(percentage, (int, float)):
            percentages.append(float(percentage))
            if subject:
                subject_performance.setdefault(subject, []).append(float(percentage))

        weak_points = exam.get("weak_points")
        if isinstance(weak_points, list):
            for item in weak_points:
                topic = str(item or "").strip()
                if topic:
                    weak_topic_counter[topic] = weak_topic_counter.get(topic, 0) + 1

    average_percentage = round(sum(percentages) / len(percentages), 2) if percentages else None

    best_subject = None
    if subject_performance:
        best_subject = max(
            subject_performance.items(),
            key=lambda item: sum(item[1]) / len(item[1]) if item[1] else 0,
        )[0]

    top_weak_topic = None
    if weak_topic_counter:
        top_weak_topic = max(weak_topic_counter.items(), key=lambda item: item[1])[0]

    return {
        "exam_count": len(exam_history),
        "average_percentage": average_percentage,
        "best_subject": best_subject,
        "top_weak_topic": top_weak_topic,
    }


def get_exam_analytics_payload(exam_history: list[dict]) -> dict:
    if not exam_history:
        empty = _build_exam_analytics_snapshot([])
        return {
            **empty,
            "source_breakdown": {
                "personal": _build_exam_analytics_snapshot([]),
                "school": _build_exam_analytics_snapshot([]),
            },
        }

    personal_exams: list[dict] = []
    school_exams: list[dict] = []

    for exam in exam_history:
        source = str(exam.get("source") or "").strip().lower()
        if source == "school":
            school_exams.append(exam)
        else:
            personal_exams.append(exam)

    overall = _build_exam_analytics_snapshot(exam_history)
    return {
        **overall,
        "source_breakdown": {
            "personal": _build_exam_analytics_snapshot(personal_exams),
            "school": _build_exam_analytics_snapshot(school_exams),
        },
    }


def _calculate_due_at(assignment: dict) -> str | None:
    if assignment.get("due_date"):
        return assignment.get("due_date")

    created_at = _safe_parse_datetime(assignment.get("created_at"))
    duration_days = assignment.get("duration_days")
    if not created_at or not isinstance(duration_days, int):
        return None

    due_at = created_at + timedelta(days=duration_days)
    return due_at.isoformat()


def get_active_assignments(class_id: int) -> list[dict]:
    assignment_ids = db_get(f"class:{class_id}:assignments", default=[])
    if not isinstance(assignment_ids, list):
        return []

    active: list[dict] = []
    for assignment_id in assignment_ids:
        assignment = db_get(f"assignment:{assignment_id}:info")
        if not isinstance(assignment, dict):
            continue
        if assignment.get("class_id") != class_id:
            continue
        active.append(
            {
                "id": assignment.get("id"),
                "title": assignment.get("title", ""),
                "description": assignment.get("description", ""),
                "created_at": assignment.get("created_at"),
                "due_at": _calculate_due_at(assignment),
                "subject": assignment.get("subject"),
                "label": "تکلیف فعال",
            }
        )

    return sorted(
        active,
        key=lambda item: _safe_parse_datetime(item.get("due_at")) or _utcnow(),
    )


def build_dashboard_payload(student: dict) -> dict:
    student_id = student.get("id")
    class_id = student.get("class_id")

    latest_exam = get_latest_exam(student_id) if isinstance(student_id, int) else None
    assignments = get_active_assignments(class_id) if isinstance(class_id, int) else []
    exam_history = get_student_exam_history(student_id, limit=10) if isinstance(student_id, int) else []
    exam_analytics = get_exam_analytics_payload(exam_history)

    weak_topics: list[str] = []
    for exam in exam_history:
        points = exam.get("weak_points")
        if not isinstance(points, list):
            continue
        for point in points:
            topic = str(point or "").strip()
            if topic and topic not in weak_topics:
                weak_topics.append(topic)
            if len(weak_topics) >= 8:
                break
        if len(weak_topics) >= 8:
            break

    exam_payload = None
    if latest_exam:
        exam_payload = {
            "exam_id": latest_exam.get("exam_id"),
            "subject": latest_exam.get("subject", "آزمون"),
            "score": latest_exam.get("score"),
            "total": latest_exam.get("total"),
            "created_at": latest_exam.get("created_at"),
            "label": "آخرین آزمون",
        }

    gradebook_summary = None
    if isinstance(student_id, int):
        gradebook_summary = get_student_gradebook_summary(
            student_id,
            class_id=class_id if isinstance(class_id, int) else None,
        )

    return {
        "labels": {
            "greeting": "خوش آمدی",
            "latest_exam": "آخرین آزمون",
            "active_assignments": "تکالیف فعال",
            "quick_actions": "دسترسی سریع",
        },
        "student": get_student_profile_for_api(student),
        "latest_exam": exam_payload,
        "recent_exams": exam_history[:3],
        "exam_analytics": exam_analytics,
        "weak_topics": weak_topics,
        "active_assignments": assignments,
        "active_assignments_count": len(assignments),
        "gradebook_summary": gradebook_summary,
    }
