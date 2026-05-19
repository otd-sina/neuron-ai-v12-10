from collections import Counter
from datetime import datetime

from backend.db.helpers import db_get, db_keys_by_prefix
from backend.modules.gradebook import build_student_report_card, get_gradebook_overview
from backend.modules.students import get_student, list_students


def _safe_parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _to_number(value) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def _resolve_grade_name(grade_id: int | None) -> str | None:
    if not isinstance(grade_id, int):
        return None

    grade = db_get(f"grade:{grade_id}:info")
    if not isinstance(grade, dict):
        return None

    name = str(grade.get("name") or "").strip()
    return name or None


def _normalize_percentage(raw_result: dict) -> float | None:
    percentage = _to_number(raw_result.get("percentage"))
    if percentage is not None:
        return round(max(0.0, min(100.0, percentage)), 2)

    score = _to_number(raw_result.get("score"))
    total = _to_number(raw_result.get("total"))
    if score is not None and total is not None and total > 0:
        derived = (score / total) * 100
        return round(max(0.0, min(100.0, derived)), 2)

    if score is None:
        return None

    # Legacy admin results may store raw scores without a `total` field.
    if 0 <= score <= 4:
        return round(score * 25, 2)
    if 0 <= score <= 20:
        return round(score * 5, 2)
    if 0 <= score <= 100:
        return round(score, 2)
    return None


def _to_gpa(percentage: float | None) -> float | None:
    if percentage is None:
        return None
    return round(max(0.0, min(4.0, percentage / 25.0)), 2)


def _extract_weak_points(raw_result: dict) -> list[str]:
    topics: list[str] = []
    seen: set[str] = set()

    weak_points = raw_result.get("weak_points")
    if isinstance(weak_points, list):
        for item in weak_points:
            topic = str(item or "").strip()
            normalized = topic.lower()
            if topic and normalized not in seen:
                topics.append(topic)
                seen.add(normalized)
    elif isinstance(weak_points, str):
        for item in weak_points.split(","):
            topic = str(item or "").strip()
            normalized = topic.lower()
            if topic and normalized not in seen:
                topics.append(topic)
                seen.add(normalized)

    weakness_topic = str(raw_result.get("weakness_topic") or "").strip()
    normalized_topic = weakness_topic.lower()
    if weakness_topic and normalized_topic not in seen:
        topics.append(weakness_topic)

    return topics


def _parse_exam_id_from_key(key: str) -> int | str | None:
    parts = key.split(":")
    if len(parts) < 4:
        return None

    exam_id_text = parts[2]
    if exam_id_text.isdigit():
        return int(exam_id_text)
    return exam_id_text


def _normalize_source(raw_result: dict, exam_id) -> str:
    source = str(raw_result.get("source") or "").strip().lower()
    if source in {"personal", "school"}:
        return source

    if raw_result.get("school_exam_id") is not None:
        return "school"

    exam_token = str(raw_result.get("exam_id") or exam_id or "").strip().lower()
    if exam_token.startswith("school-"):
        return "school"

    return "personal"


def _normalize_exam_result(student_id: int, exam_id, raw_result: dict) -> dict:
    percentage = _normalize_percentage(raw_result)
    source = _normalize_source(raw_result, exam_id)
    return {
        "exam_id": raw_result.get("exam_id") or exam_id,
        "student_id": student_id,
        "subject": str(raw_result.get("subject") or "آزمون").strip() or "آزمون",
        "score": raw_result.get("score"),
        "total": raw_result.get("total"),
        "percentage": percentage,
        "gpa": _to_gpa(percentage),
        "date": raw_result.get("created_at") or raw_result.get("timestamp"),
        "weak_points": _extract_weak_points(raw_result),
        "source": source,
    }


def list_student_exam_results(student_id: int) -> list[dict]:
    exams: list[dict] = []
    for key in db_keys_by_prefix(f"exam:{student_id}:"):
        if not key.endswith(":result"):
            continue

        raw_result = db_get(key)
        if not isinstance(raw_result, dict):
            continue

        exam_id = _parse_exam_id_from_key(key)
        exams.append(_normalize_exam_result(student_id, exam_id, raw_result))

    return sorted(
        exams,
        key=lambda exam: _safe_parse_datetime(exam.get("date")) or datetime.min,
        reverse=True,
    )


def _group_exam_results_by_student() -> dict[int, list[dict]]:
    grouped: dict[int, list[dict]] = {}

    for key in db_keys_by_prefix("exam:"):
        if not key.endswith(":result"):
            continue

        parts = key.split(":")
        if len(parts) < 4 or not parts[1].isdigit():
            continue
        student_id = int(parts[1])

        raw_result = db_get(key)
        if not isinstance(raw_result, dict):
            continue

        exam_id = _parse_exam_id_from_key(key)
        grouped.setdefault(student_id, []).append(
            _normalize_exam_result(student_id, exam_id, raw_result)
        )

    for student_id, exam_results in grouped.items():
        grouped[student_id] = sorted(
            exam_results,
            key=lambda exam: _safe_parse_datetime(exam.get("date")) or datetime.min,
            reverse=True,
        )

    return grouped


def _calculate_student_gpa(exam_results: list[dict]) -> float | None:
    percentages = [
        float(exam["percentage"])
        for exam in exam_results
        if isinstance(exam.get("percentage"), (int, float))
    ]
    if not percentages:
        return None

    average_percentage = sum(percentages) / len(percentages)
    return _to_gpa(average_percentage)


def _filter_exams_by_source(exam_results: list[dict], source: str) -> list[dict]:
    return [
        exam
        for exam in exam_results
        if str(exam.get("source") or "").strip().lower() == source
    ]


def _calculate_source_breakdown(exam_results: list[dict]) -> dict:
    breakdown: dict[str, dict] = {}

    for source in ("personal", "school"):
        filtered = _filter_exams_by_source(exam_results, source)
        percentages = [
            float(exam["percentage"])
            for exam in filtered
            if isinstance(exam.get("percentage"), (int, float))
        ]
        breakdown[source] = {
            "exam_count": len(filtered),
            "average_percentage": round(sum(percentages) / len(percentages), 2) if percentages else None,
            "average_gpa": _calculate_student_gpa(filtered),
        }

    return breakdown


def _build_weakness_breakdown(exam_results: list[dict]) -> list[dict]:
    counter: Counter[str] = Counter()
    labels: dict[str, str] = {}

    for exam in exam_results:
        weak_points = exam.get("weak_points")
        if not isinstance(weak_points, list):
            continue

        for point in weak_points:
            topic = str(point or "").strip()
            if not topic:
                continue
            normalized = topic.lower()
            counter[normalized] += 1
            if normalized not in labels:
                labels[normalized] = topic

    return [
        {"topic": labels[key], "count": count}
        for key, count in counter.most_common()
    ]


def get_dashboard_stats() -> dict:
    students = list_students()
    exam_results_by_student = _group_exam_results_by_student()
    student_gpas: list[float] = []
    student_gpas_by_source: dict[str, list[float]] = {"personal": [], "school": []}
    source_exam_counter: Counter[str] = Counter()
    weaknesses_counter: Counter[str] = Counter()
    weakness_labels: dict[str, str] = {}

    for student in students:
        student_id = student.get("id")
        if not isinstance(student_id, int):
            continue

        exam_results = exam_results_by_student.get(student_id, [])
        gpa = _calculate_student_gpa(exam_results)
        if gpa is not None:
            student_gpas.append(gpa)

        for source_key, source_exams in (
            ("personal", _filter_exams_by_source(exam_results, "personal")),
            ("school", _filter_exams_by_source(exam_results, "school")),
        ):
            source_gpa = _calculate_student_gpa(source_exams)
            if source_gpa is not None:
                student_gpas_by_source[source_key].append(source_gpa)
            source_exam_counter[source_key] += len(source_exams)

        for entry in _build_weakness_breakdown(exam_results):
            topic = entry["topic"]
            count = entry["count"]
            normalized = topic.lower()
            weaknesses_counter[normalized] += count
            if normalized not in weakness_labels:
                weakness_labels[normalized] = topic

    average_gpa = round(sum(student_gpas) / len(student_gpas), 2) if student_gpas else None
    top_weakness_topics = [
        {"topic": weakness_labels[key], "count": count}
        for key, count in weaknesses_counter.most_common(3)
    ]
    source_breakdown = {
        "personal": {
            "exam_count": source_exam_counter.get("personal", 0),
            "average_gpa": (
                round(sum(student_gpas_by_source["personal"]) / len(student_gpas_by_source["personal"]), 2)
                if student_gpas_by_source["personal"]
                else None
            ),
        },
        "school": {
            "exam_count": source_exam_counter.get("school", 0),
            "average_gpa": (
                round(sum(student_gpas_by_source["school"]) / len(student_gpas_by_source["school"]), 2)
                if student_gpas_by_source["school"]
                else None
            ),
        },
    }
    gradebook_overview = get_gradebook_overview()

    return {
        "total_students": len(students),
        "average_gpa": average_gpa,
        "top_weakness_topics": top_weakness_topics,
        "source_breakdown": source_breakdown,
        "gradebook_overview": gradebook_overview,
    }


def list_students_with_analytics() -> list[dict]:
    students = list_students()
    exam_results_by_student = _group_exam_results_by_student()
    directory: list[dict] = []

    for student in students:
        student_id = student.get("id")
        if not isinstance(student_id, int):
            continue

        exam_results = exam_results_by_student.get(student_id, [])
        grade_id = student.get("grade_id")
        grade_name = _resolve_grade_name(grade_id)

        gradebook_report = build_student_report_card(student_id, class_id=student.get("class_id"))
        gradebook_average = None
        attendance_rate = None
        if isinstance(gradebook_report, dict):
            gradebook_average = gradebook_report.get("grade_average_percentage")
            attendance_rate = (
                gradebook_report.get("attendance_summary", {}).get("present_rate")
                if isinstance(gradebook_report.get("attendance_summary"), dict)
                else None
            )

        directory.append(
            {
                "id": student_id,
                "full_name": student.get("full_name", ""),
                "grade": grade_name or (f"پایه {grade_id}" if grade_id is not None else "نامشخص"),
                "grade_id": grade_id,
                "current_gpa": _calculate_student_gpa(exam_results),
                "total_exams": len(exam_results),
                "total_personal_exams": len(_filter_exams_by_source(exam_results, "personal")),
                "total_school_exams": len(_filter_exams_by_source(exam_results, "school")),
                "gradebook_average": gradebook_average,
                "attendance_rate": attendance_rate,
            }
        )

    return sorted(directory, key=lambda item: item["id"])


def get_student_analytics(student_id: int, source: str | None = None) -> dict | None:
    student = get_student(student_id)
    if not isinstance(student, dict):
        return None

    exam_results = list_student_exam_results(student_id)
    
    # Filter by source if specified
    if source and source in ("personal", "school"):
        exam_results = _filter_exams_by_source(exam_results, source)
    
    weaknesses = _build_weakness_breakdown(exam_results)

    progress_data = sorted(
        [
            {
                "exam_id": exam.get("exam_id"),
                "date": exam.get("date"),
                "subject": exam.get("subject"),
                "percentage": exam.get("percentage"),
                "gpa": exam.get("gpa"),
                "source": exam.get("source"),
            }
            for exam in exam_results
        ],
        key=lambda exam: _safe_parse_datetime(exam.get("date")) or datetime.min,
    )

    exam_history = [
        {
            "exam_id": exam.get("exam_id"),
            "date": exam.get("date"),
            "subject": exam.get("subject"),
            "score": exam.get("score"),
            "percentage": exam.get("percentage"),
            "gpa": exam.get("gpa"),
            "source": exam.get("source"),
        }
        for exam in exam_results
    ]

    grade_id = student.get("grade_id")
    safe_student = {key: value for key, value in student.items() if key != "password_hash"}

    return {
        "student": {
            **safe_student,
            "grade": _resolve_grade_name(grade_id) or (
                f"پایه {grade_id}" if grade_id is not None else "نامشخص"
            ),
        },
        "current_gpa": _calculate_student_gpa(exam_results),
        "source_breakdown": _calculate_source_breakdown(exam_results) if not source else None,
        "progress_data": progress_data,
        "weaknesses": [item["topic"] for item in weaknesses],
        "weakness_breakdown": weaknesses,
        "exam_history": exam_history,
        "filtered_source": source,
        "gradebook_report": build_student_report_card(student_id, class_id=student.get("class_id")),
    }
