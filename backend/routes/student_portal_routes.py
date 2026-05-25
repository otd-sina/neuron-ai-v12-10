from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.db.helpers import db_get, db_set, next_counter
from backend.middleware.student_auth import require_student_auth
from backend.modules.gradebook import (
    build_student_report_card,
    get_student_attendance_log,
    get_student_gradebook_timeline,
)
from backend.modules.student_portal import (
    authenticate_student,
    build_dashboard_payload,
    create_student_session,
    delete_student_session,
    get_active_assignments,
    get_exam_analytics_payload,
    get_student_exam_history,
    get_student_profile_for_api,
    is_valid_national_id,
    normalize_national_id,
)
from backend.modules.teacher_messages import list_student_messages
from backend.modules.school_exams import (
    build_school_result_key,
    evaluate_exam_status,
    get_exam_window,
    get_school_exam_info,
    get_school_exam_questions,
    list_student_school_exams,
    make_school_exam_attempt_id,
    parse_school_exam_id,
    student_matches_exam,
    utcnow_iso as school_utcnow_iso,
)
from backend.services.ai_service import (
    call_openai_api,
    extract_json_payload,
    generate_system_prompt,
)

router = APIRouter(prefix="/api/student", tags=["student-portal"])

EXAM_QUESTIONS_TTL_SECONDS = 60 * 60
EXAM_RESULT_TTL_SECONDS = 365 * 24 * 60 * 60
DEFAULT_DAILY_RATE_LIMIT = 20

SUBJECTS = [
    {"id": "math", "name": "ریاضی", "icon": "calculator", "theme_color": "#3B82F6"},
    {"id": "physics", "name": "فیزیک", "icon": "atom", "theme_color": "#F97316"},
    {"id": "chemistry", "name": "شیمی", "icon": "flask", "theme_color": "#EF4444"},
    {"id": "biology", "name": "زیست‌شناسی", "icon": "dna", "theme_color": "#22C55E"},
    {"id": "persian_literature", "name": "ادبیات فارسی", "icon": "book-open", "theme_color": "#10B981"},
    {"id": "arabic", "name": "عربی", "icon": "language", "theme_color": "#0F766E"},
    {"id": "english", "name": "زبان انگلیسی", "icon": "globe", "theme_color": "#06B6D4"},
    {"id": "history", "name": "تاریخ", "icon": "scroll", "theme_color": "#F59E0B"},
    {"id": "geography", "name": "جغرافیا", "icon": "map", "theme_color": "#8B5CF6"},
]
SUBJECT_BY_ID = {subject["id"]: subject for subject in SUBJECTS}
SUBJECT_BY_NAME = {str(subject["name"]).strip().lower(): subject for subject in SUBJECTS}

BOT_TYPES = [
    {
        "type": "general_tutor",
        "name": "معلم هوشمند",
        "description": "برای پرسیدن سوالات درسی و دریافت توضیح مرحله‌به‌مرحله در هر مبحث.",
        "icon": "question-circle",
    },
    {
        "type": "exam_generator",
        "name": "آزمون‌ساز هوشمند",
        "description": "برای ساخت آزمون تمرینی با سطح سختی دلخواه و تعداد سوال مشخص.",
        "icon": "exam-paper",
    },
    {
        "type": "homework_helper",
        "name": "دستیار تکالیف",
        "description": "برای دریافت راهنمایی در انجام تکالیف بدون ارائه پاسخ مستقیم.",
        "icon": "notebook",
    },
]

DIFFICULTY_MAP = {
    "easy": "آسان",
    "medium": "متوسط",
    "hard": "سخت",
}


class StudentLoginPayload(BaseModel):
    national_id: str
    password: str


class AIGeneralPayload(BaseModel):
    subject_id: str
    message: str


class AIExamStartPayload(BaseModel):
    subject_id: str
    difficulty: str | None = "medium"
    question_count: int = Field(default=10, ge=1, le=20)


class AIExamSubmitPayload(BaseModel):
    exam_id: str
    answers: dict[str, str]


class SchoolExamSubmitPayload(BaseModel):
    answers: dict[str, Any]


class AIHomeworkPayload(BaseModel):
    subject_id: str
    message: str
    homework_id: str | None = None


def _utcnow() -> datetime:
    return datetime.utcnow()


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _normalize_text(value: Any) -> str:
    return str(value or "").strip().lower()


def _get_subject(subject_id: str) -> dict | None:
    if not subject_id:
        return None
    return SUBJECT_BY_ID.get(subject_id)


def _get_grade_label(student: dict) -> str:
    grade_id = student.get("grade_id")
    if isinstance(grade_id, int):
        grade_info = db_get(f"grade:{grade_id}:info")
        if isinstance(grade_info, dict):
            grade_name = str(grade_info.get("name") or "").strip()
            if grade_name:
                return grade_name
        return f"پایه {grade_id}"

    grade = student.get("grade")
    if grade is not None:
        return str(grade)

    return "نامشخص"


def _calculate_percentage(exam_result: dict) -> float | None:
    if not isinstance(exam_result, dict):
        return None

    percentage = exam_result.get("percentage")
    if isinstance(percentage, (int, float)):
        return float(percentage)

    score = exam_result.get("score")
    total = exam_result.get("total")
    if isinstance(score, (int, float)) and isinstance(total, (int, float)) and total > 0:
        return float(score) / float(total) * 100

    return None


def _build_past_performance(student_id: int, subject_name: str | None = None) -> dict | None:
    history = db_get(f"exam:{student_id}:history", default=[])
    if not isinstance(history, list) or not history:
        return None

    percentages: list[float] = []
    for item in history:
        exam_id = None
        if isinstance(item, int):
            exam_id = str(item)
        elif isinstance(item, str):
            exam_id = item.strip()
        elif isinstance(item, dict):
            possible_exam_id = item.get("exam_id")
            if possible_exam_id is not None:
                exam_id = str(possible_exam_id)

        if not exam_id:
            continue

        exam_result = db_get(f"exam:{student_id}:{exam_id}:result")
        if not isinstance(exam_result, dict):
            continue

        if subject_name:
            stored_subject = _normalize_text(exam_result.get("subject"))
            if stored_subject and stored_subject != _normalize_text(subject_name):
                continue

        percentage = _calculate_percentage(exam_result)
        if percentage is not None:
            percentages.append(percentage)

    if not percentages:
        return None

    avg_score = round(sum(percentages) / len(percentages), 2)
    return {
        "avg_score": avg_score,
        "exam_count": len(percentages),
    }


def _consume_rate_limit(student_id: int) -> tuple[bool, dict]:
    key = f"student:{student_id}:rate_limit"
    today = _utcnow().date().isoformat()

    data = db_get(key, default=None)
    if not isinstance(data, dict):
        data = {
            "student_id": student_id,
            "daily_limit": DEFAULT_DAILY_RATE_LIMIT,
            "used_today": 0,
            "last_reset": today,
        }

    daily_limit = data.get("daily_limit")
    used_today = data.get("used_today")
    last_reset = data.get("last_reset")

    if not isinstance(daily_limit, int) or daily_limit < 1:
        daily_limit = DEFAULT_DAILY_RATE_LIMIT
    if not isinstance(used_today, int) or used_today < 0:
        used_today = 0

    if last_reset != today:
        used_today = 0

    if used_today >= daily_limit:
        data.update({"daily_limit": daily_limit, "used_today": used_today, "last_reset": today})
        db_set(key, data)
        return False, data

    used_today += 1
    data.update({"daily_limit": daily_limit, "used_today": used_today, "last_reset": today})
    db_set(key, data)
    return True, data


def _api_failure_to_response(result: dict) -> JSONResponse:
    error_code = result.get("error_code")
    if error_code == "rate_limited":
        return JSONResponse(
            status_code=429,
            content={"message": "تعداد درخواست‌ها زیاد است. لطفاً کمی بعد دوباره تلاش کن."},
        )

    if error_code == "auth_error":
        return JSONResponse(
            status_code=503,
            content={"message": "سرویس هوش مصنوعی موقتاً در دسترس نیست. لطفاً بعداً دوباره تلاش کن."},
        )

    return JSONResponse(
        status_code=503,
        content={"message": "در حال حاضر پاسخ‌گویی هوش مصنوعی با اختلال مواجه است. کمی بعد دوباره تلاش کن."},
    )


def _normalize_options(raw_options: Any) -> dict[str, str] | None:
    if isinstance(raw_options, dict):
        options = {
            "A": str(raw_options.get("A") or raw_options.get("a") or "").strip(),
            "B": str(raw_options.get("B") or raw_options.get("b") or "").strip(),
            "C": str(raw_options.get("C") or raw_options.get("c") or "").strip(),
            "D": str(raw_options.get("D") or raw_options.get("d") or "").strip(),
        }
    elif isinstance(raw_options, list) and len(raw_options) >= 4:
        options = {
            "A": str(raw_options[0]).strip(),
            "B": str(raw_options[1]).strip(),
            "C": str(raw_options[2]).strip(),
            "D": str(raw_options[3]).strip(),
        }
    else:
        return None

    if not all(options.values()):
        return None
    return options


def _parse_exam_questions(raw_ai_output: str, expected_count: int) -> list[dict]:
    payload = extract_json_payload(raw_ai_output)
    if isinstance(payload, dict):
        raw_questions = payload.get("questions")
    elif isinstance(payload, list):
        raw_questions = payload
    else:
        raw_questions = None

    if not isinstance(raw_questions, list):
        return []

    cleaned: list[dict] = []
    for item in raw_questions:
        if not isinstance(item, dict):
            continue

        question_text = str(item.get("question") or "").strip()
        options = _normalize_options(item.get("options"))
        correct_answer = str(item.get("correct_answer") or item.get("answer") or "").strip().upper()
        explanation = str(item.get("explanation") or "").strip()
        topic = str(item.get("topic") or "مبحث نامشخص").strip()

        if not question_text or options is None or correct_answer not in {"A", "B", "C", "D"}:
            continue

        cleaned.append(
            {
                "id": len(cleaned) + 1,
                "question": question_text,
                "options": options,
                "correct_answer": correct_answer,
                "explanation": explanation or "توضیحی برای این سوال ثبت نشده است.",
                "topic": topic,
            }
        )

        if len(cleaned) >= expected_count:
            break

    return cleaned


def _normalize_difficulty(difficulty: str | None) -> tuple[str, str] | None:
    normalized = _normalize_text(difficulty or "medium")
    if normalized in DIFFICULTY_MAP:
        return normalized, DIFFICULTY_MAP[normalized]

    aliases = {
        "اسان": "easy",
        "آسان": "easy",
        "متوسط": "medium",
        "سخت": "hard",
    }
    if normalized in aliases:
        key = aliases[normalized]
        return key, DIFFICULTY_MAP[key]

    return None


def _normalize_selected_option_index(raw_value: Any) -> int | None:
    if isinstance(raw_value, bool):
        return None

    if isinstance(raw_value, int):
        return raw_value if 0 <= raw_value <= 3 else None

    text = str(raw_value or "").strip().upper()
    if text in {"A", "B", "C", "D"}:
        return {"A": 0, "B": 1, "C": 2, "D": 3}[text]

    if text.isdigit():
        number = int(text)
        if 0 <= number <= 3:
            return number
        if 1 <= number <= 4:
            return number - 1

    return None


def _to_option_label(option_index: int | None) -> str:
    if option_index == 0:
        return "A"
    if option_index == 1:
        return "B"
    if option_index == 2:
        return "C"
    if option_index == 3:
        return "D"
    return "-"


def _public_school_questions(questions: list[dict]) -> list[dict]:
    sanitized: list[dict] = []
    for item in questions:
        if not isinstance(item, dict):
            continue
        sanitized.append(
            {
                "id": item.get("id"),
                "question": item.get("question"),
                "options": item.get("options"),
                "difficulty": item.get("difficulty"),
            }
        )
    return sanitized


def _subject_matches_assignment(assignment: dict, subject: dict) -> bool:
    assignment_subject = assignment.get("subject")
    if assignment_subject is None:
        return True

    normalized_assignment_subject = _normalize_text(assignment_subject)
    if normalized_assignment_subject in {_normalize_text(subject["id"]), _normalize_text(subject["name"])}:
        return True

    return False


def _resolve_assignment_subject(assignment: dict) -> dict:
    assignment_subject = assignment.get("subject")
    if assignment_subject is not None:
        normalized = _normalize_text(assignment_subject)
        if normalized in SUBJECT_BY_ID:
            return SUBJECT_BY_ID[normalized]
        possible_subject = SUBJECT_BY_NAME.get(normalized)
        if possible_subject:
            return possible_subject

    return SUBJECT_BY_ID["math"]


def _sort_assignments_latest(assignments: list[dict]) -> list[dict]:
    def assignment_sort_key(item: dict) -> datetime:
        for field in ("due_date", "due_at", "created_at"):
            parsed = _safe_parse_datetime(item.get(field))
            if parsed:
                return parsed

        duration_days = item.get("duration_days")
        created_at = _safe_parse_datetime(item.get("created_at"))
        if created_at and isinstance(duration_days, int):
            return created_at + timedelta(days=duration_days)

        return datetime.min

    return sorted(assignments, key=assignment_sort_key, reverse=True)


def _build_homework_assignment_context(
    class_id: int,
    subject: dict,
    homework_id: str | None,
) -> tuple[dict | None, str | None]:
    assignment_ids = db_get(f"class:{class_id}:assignments", default=[])
    if not isinstance(assignment_ids, list) or not assignment_ids:
        return None, "در حال حاضر تکلیف فعالی برای کلاس شما ثبت نشده است."

    assignments: list[dict] = []
    for assignment_id in assignment_ids:
        assignment = db_get(f"assignment:{assignment_id}:info")
        if isinstance(assignment, dict):
            assignments.append(assignment)

    if not assignments:
        return None, "در حال حاضر تکلیف فعالی برای کلاس شما ثبت نشده است."

    sorted_assignments = _sort_assignments_latest(assignments)

    if homework_id:
        normalized_homework_id = homework_id.strip()
        if not normalized_homework_id:
            return None, "شناسه تکلیف نامعتبر است."

        target_assignment = db_get(f"assignment:{normalized_homework_id}:info")
        if not isinstance(target_assignment, dict):
            try:
                target_assignment = db_get(f"assignment:{int(normalized_homework_id)}:info")
            except ValueError:
                target_assignment = None

        if not isinstance(target_assignment, dict):
            return None, "تکلیف درخواستی پیدا نشد."

        if target_assignment.get("class_id") != class_id:
            return None, "این تکلیف متعلق به کلاس شما نیست."

        if not _subject_matches_assignment(target_assignment, subject):
            subject_name = target_assignment.get("subject") or "درس دیگری"
            return None, f"این تکلیف مربوط به درس «{subject_name}» است. لطفاً درس درست را انتخاب کن."

        return target_assignment, None

    subject_assignments = [item for item in sorted_assignments if _subject_matches_assignment(item, subject)]
    if not subject_assignments:
        return None, f"برای درس {subject['name']} تکلیف فعالی پیدا نشد."

    return subject_assignments[0], None


@router.post("/login")
async def student_login(payload: StudentLoginPayload):
    national_id = normalize_national_id(payload.national_id)
    password = payload.password

    if not is_valid_national_id(national_id):
        return JSONResponse(
            status_code=422,
            content={"message": "کد ملی باید دقیقاً ۱۰ رقم باشد."},
        )

    if len(password) < 6:
        return JSONResponse(
            status_code=422,
            content={"message": "رمز عبور باید حداقل ۶ کاراکتر باشد."},
        )

    student = authenticate_student(national_id=national_id, password=password)
    if not student:
        return JSONResponse(
            status_code=401,
            content={"message": "کد ملی یا رمز عبور اشتباه است."},
        )

    student_id = student.get("id")
    if not isinstance(student_id, int):
        return JSONResponse(
            status_code=500,
            content={"message": "ساختار اطلاعات دانش‌آموز معتبر نیست."},
        )

    session = create_student_session(student_id)

    return JSONResponse(
        content={
            "success": True,
            "message": "ورود با موفقیت انجام شد.",
            "token": session["token"],
            "student": get_student_profile_for_api(student),
            "expires_at": session["expires_at"],
        }
    )




@router.get("/gradebook")
async def student_gradebook(request: Request):
    auth = require_student_auth(request)
    if auth is not None:
        return auth

    student_id = request.state.student_id
    student = request.state.student

    report_card = build_student_report_card(
        student_id,
        class_id=student.get("class_id") if isinstance(student, dict) else None,
    )


@router.get("/gradebook/attendance")
async def student_gradebook_attendance(request: Request):
    auth = require_student_auth(request)
    if auth is not None:
        return auth

    student_id = request.state.student_id
    student = request.state.student
    report_card = build_student_report_card(
        student_id,
        class_id=student.get("class_id") if isinstance(student, dict) else None,
    ) or {}
    return JSONResponse(
        content={
            "success": True,
            "attendance_log": get_student_attendance_log(
                student_id,
                class_id=student.get("class_id") if isinstance(student, dict) else None,
            ),
            "attendance_summary": report_card.get("attendance_summary") or {},
        }
    )


@router.get("/gradebook/participation")
async def student_gradebook_participation(request: Request):
    auth = require_student_auth(request)
    if auth is not None:
        return auth

    student_id = request.state.student_id
    student = request.state.student
    timeline = get_student_gradebook_timeline(
        student_id,
        class_id=student.get("class_id") if isinstance(student, dict) else None,
    )
    report_card = build_student_report_card(
        student_id,
        class_id=student.get("class_id") if isinstance(student, dict) else None,
    ) or {}
    return JSONResponse(
        content={
            "success": True,
            "records": timeline.get("participation_records", []),
            "summary": report_card.get("participation_summary") or {},
        }
    )


@router.get("/gradebook/grades")
async def student_gradebook_grades(request: Request):
    auth = require_student_auth(request)
    if auth is not None:
        return auth

    student_id = request.state.student_id
    student = request.state.student
    report_card = build_student_report_card(
        student_id,
        class_id=student.get("class_id") if isinstance(student, dict) else None,
    ) or {}
    return JSONResponse(
        content={
            "success": True,
            "recent_assessments": report_card.get("recent_assessments", []),
            "subject_breakdown": report_card.get("subject_breakdown", []),
            "grade_average_percentage": report_card.get("grade_average_percentage"),
        }
    )


@router.get("/messages")
async def student_messages(request: Request):
    auth = require_student_auth(request)
    if auth is not None:
        return auth

    return JSONResponse(
        content={
            "success": True,
            "messages": list_student_messages(request.state.student_id),
        }
    )
    timeline = get_student_gradebook_timeline(
        student_id,
        class_id=student.get("class_id") if isinstance(student, dict) else None,
    )

    return JSONResponse(
        content={
            "success": True,
            "report_card": report_card,
            "attendance_log": get_student_attendance_log(
                student_id,
                class_id=student.get("class_id") if isinstance(student, dict) else None,
            ),
            "attendance_exceptions": timeline.get("attendance_exceptions", []),
            "participation_records": timeline.get("participation_records", []),
        }
    )
@router.post("/logout")
async def student_logout(request: Request):
    auth_error = require_student_auth(request)
    if auth_error:
        return auth_error

    deleted = delete_student_session(request.state.student_token)
    if not deleted:
        return JSONResponse(
            status_code=401,
            content={"message": "نشست معتبر برای خروج یافت نشد."},
        )

    return JSONResponse(content={"success": True, "message": "خروج با موفقیت انجام شد."})


@router.get("/me")
async def student_me(request: Request):
    auth_error = require_student_auth(request)
    if auth_error:
        return auth_error

    return JSONResponse(
        content={
            "success": True,
            "student": get_student_profile_for_api(request.state.student),
        }
    )


@router.get("/dashboard")
async def student_dashboard(request: Request):
    auth_error = require_student_auth(request)
    if auth_error:
        return auth_error

    dashboard = build_dashboard_payload(request.state.student)
    return JSONResponse(
        content={
            "success": True,
            "message": "اطلاعات داشبورد با موفقیت دریافت شد.",
            "dashboard": dashboard,
        }
    )


@router.get("/assignments")
async def student_assignments(request: Request):
    auth_error = require_student_auth(request)
    if auth_error:
        return auth_error

    student = request.state.student
    class_id = student.get("class_id")

    if not isinstance(class_id, int):
        return JSONResponse(
            content={
                "success": True,
                "assignments": [],
                "message": "کلاس معتبری برای دانش‌آموز ثبت نشده است.",
            }
        )

    assignments = get_active_assignments(class_id)
    payload: list[dict] = []

    for assignment in assignments:
        subject = _resolve_assignment_subject(assignment)
        payload.append(
            {
                "id": assignment.get("id"),
                "title": assignment.get("title", ""),
                "description": assignment.get("description", ""),
                "due_at": assignment.get("due_at"),
                "created_at": assignment.get("created_at"),
                "subject": assignment.get("subject"),
                "subject_id": subject["id"],
                "subject_name": subject["name"],
                "subject_theme_color": subject.get("theme_color"),
                "bot_type": "homework_helper",
            }
        )

    return JSONResponse(
        content={
            "success": True,
            "assignments": payload,
        }
    )


@router.get("/exams")
async def student_exams(request: Request):
    auth_error = require_student_auth(request)
    if auth_error:
        return auth_error

    student_id = request.state.student_id
    student = request.state.student
    exams = get_student_exam_history(student_id)
    analytics = get_exam_analytics_payload(exams)
    school_exams = list_student_school_exams(student, student_id)

    weak_topics: list[str] = []
    for exam in exams:
        points = exam.get("weak_points")
        if not isinstance(points, list):
            continue
        for point in points:
            topic = str(point or "").strip()
            if topic and topic not in weak_topics:
                weak_topics.append(topic)
            if len(weak_topics) >= 10:
                break
        if len(weak_topics) >= 10:
            break

    return JSONResponse(
        content={
            "success": True,
            "exams": exams,
            "analytics": analytics,
            "weak_topics": weak_topics,
            "school_exams": school_exams,
            "server_time": school_utcnow_iso(),
        }
    )


@router.get("/subjects")
async def student_subjects(request: Request):
    auth_error = require_student_auth(request)
    if auth_error:
        return auth_error

    return JSONResponse(
        content={
            "success": True,
            "subjects": SUBJECTS,
        }
    )


@router.get("/bots")
async def student_bots(request: Request):
    auth_error = require_student_auth(request)
    if auth_error:
        return auth_error

    return JSONResponse(
        content={
            "success": True,
            "bots": BOT_TYPES,
        }
    )


@router.get("/chat/history")
async def student_chat_history(request: Request, subject_id: str, bot_type: str):
    auth_error = require_student_auth(request)
    if auth_error:
        return auth_error

    return JSONResponse(content={"history": []})


@router.post("/ai/general")
async def ai_general(request: Request, payload: AIGeneralPayload):
    auth_error = require_student_auth(request)
    if auth_error:
        return auth_error

    subject = _get_subject(payload.subject_id)
    if not subject:
        return JSONResponse(status_code=422, content={"message": "درس انتخاب‌شده معتبر نیست."})

    message = payload.message.strip()
    if not message:
        return JSONResponse(status_code=422, content={"message": "پیام نمی‌تواند خالی باشد."})

    student_id = request.state.student_id
    allowed, _ = _consume_rate_limit(student_id)
    if not allowed:
        return JSONResponse(
            status_code=429,
            content={"message": "سقف مجاز درخواست روزانه شما تکمیل شده است. فردا دوباره تلاش کن."},
        )

    grade_label = _get_grade_label(request.state.student)
    past_performance = _build_past_performance(student_id, subject["name"])
    system_prompt = generate_system_prompt(
        grade=grade_label,
        subject=subject["name"],
        bot_type="general_tutor",
        past_performance=past_performance,
    )

    ai_result = call_openai_api(
        system_prompt=system_prompt,
        user_message=message,
        temperature=0.35,
        max_tokens=1000,
    )

    if not ai_result.get("success"):
        return _api_failure_to_response(ai_result)

    return JSONResponse(
        content={
            "response": ai_result["content"],
            "timestamp": _utcnow_iso(),
        }
    )


@router.post("/ai/exam/start")
async def ai_exam_start(request: Request, payload: AIExamStartPayload):
    auth_error = require_student_auth(request)
    if auth_error:
        return auth_error

    subject = _get_subject(payload.subject_id)
    if not subject:
        return JSONResponse(status_code=422, content={"message": "درس انتخاب‌شده معتبر نیست."})

    difficulty = _normalize_difficulty(payload.difficulty)
    if not difficulty:
        return JSONResponse(status_code=422, content={"message": "سطح سختی نامعتبر است."})

    difficulty_key, difficulty_label = difficulty
    question_count = payload.question_count

    student_id = request.state.student_id
    allowed, _ = _consume_rate_limit(student_id)
    if not allowed:
        return JSONResponse(
            status_code=429,
            content={"message": "سقف مجاز درخواست روزانه شما تکمیل شده است. فردا دوباره تلاش کن."},
        )

    grade_label = _get_grade_label(request.state.student)
    past_performance = _build_past_performance(student_id, subject["name"])

    system_prompt = generate_system_prompt(
        grade=grade_label,
        subject=subject["name"],
        bot_type="exam_generator",
        past_performance=past_performance,
    )

    user_prompt = f"""
برای دانش‌آموز {grade_label} در درس {subject['name']} یک آزمون {difficulty_label} با {question_count} سوال چهارگزینه‌ای تولید کن.
خروجی باید فقط JSON معتبر باشد و دقیقاً از این قالب پیروی کند:
{{
  "questions": [
    {{
      "question": "متن سوال",
      "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}},
      "correct_answer": "A یا B یا C یا D",
      "explanation": "توضیح پاسخ صحیح",
      "topic": "مبحث سوال"
    }}
  ]
}}
از نوشتن هر متن اضافه خارج از JSON خودداری کن.
""".strip()

    ai_result = call_openai_api(
        system_prompt=system_prompt,
        user_message=user_prompt,
        temperature=0.45,
        max_tokens=2500,
    )

    if not ai_result.get("success"):
        return _api_failure_to_response(ai_result)

    questions = _parse_exam_questions(ai_result["content"], question_count)
    if len(questions) < question_count:
        return JSONResponse(
            status_code=502,
            content={"message": "فرمت آزمون تولیدشده معتبر نبود. لطفاً دوباره تلاش کن."},
        )

    exam_id = str(next_counter("exam"))
    created_at = _utcnow_iso()
    exam_payload = {
        "exam_id": exam_id,
        "student_id": student_id,
        "subject_id": subject["id"],
        "subject": subject["name"],
        "difficulty": difficulty_key,
        "question_count": question_count,
        "questions": questions,
        "created_at": created_at,
    }
    db_set(
        f"exam:{student_id}:{exam_id}:questions",
        exam_payload,
        expire=EXAM_QUESTIONS_TTL_SECONDS,
    )

    public_questions = [
        {
            "id": question["id"],
            "question": question["question"],
            "options": question["options"],
            "topic": question["topic"],
        }
        for question in questions
    ]

    return JSONResponse(
        content={
            "exam_id": exam_id,
            "questions": public_questions,
            "timestamp": created_at,
        }
    )


@router.post("/ai/exam/submit")
async def ai_exam_submit(request: Request, payload: AIExamSubmitPayload):
    auth_error = require_student_auth(request)
    if auth_error:
        return auth_error

    exam_id = payload.exam_id.strip()
    if not exam_id:
        return JSONResponse(status_code=422, content={"message": "شناسه آزمون نامعتبر است."})

    student_id = request.state.student_id
    exam = db_get(f"exam:{student_id}:{exam_id}:questions")
    if not isinstance(exam, dict):
        return JSONResponse(
            status_code=404,
            content={"message": "آزمون یافت نشد یا زمان آن به پایان رسیده است."},
        )

    questions = exam.get("questions")
    if not isinstance(questions, list) or not questions:
        return JSONResponse(
            status_code=500,
            content={"message": "اطلاعات سوالات آزمون ناقص است."},
        )

    answers = payload.answers if isinstance(payload.answers, dict) else {}

    score = 0
    weak_points: list[str] = []
    seen_topics: set[str] = set()
    explanations: list[dict] = []

    for question in questions:
        question_id = question.get("id")
        if question_id is None:
            continue

        student_answer = str(answers.get(str(question_id), "")).strip().upper()
        correct_answer = str(question.get("correct_answer", "")).strip().upper()
        is_correct = student_answer == correct_answer and correct_answer in {"A", "B", "C", "D"}

        if is_correct:
            score += 1
        else:
            topic = str(question.get("topic") or "مبحث نامشخص").strip()
            if topic and topic not in seen_topics:
                weak_points.append(topic)
                seen_topics.add(topic)

        explanations.append(
            {
                "question_id": question_id,
                "correct_answer": correct_answer,
                "student_answer": student_answer,
                "is_correct": is_correct,
                "explanation": question.get("explanation", "توضیحی برای این سوال ثبت نشده است."),
            }
        )

    total = len(questions)
    percentage = round((score / total) * 100, 2) if total > 0 else 0.0
    timestamp = _utcnow_iso()

    result = {
        "exam_id": exam_id,
        "score": score,
        "total": total,
        "percentage": percentage,
        "weak_points": weak_points,
        "explanations": explanations,
        "subject": exam.get("subject"),
        "timestamp": timestamp,
        "created_at": timestamp,
        "source": "personal",
    }

    db_set(
        f"exam:{student_id}:{exam_id}:result",
        result,
        expire=EXAM_RESULT_TTL_SECONDS,
    )

    history_key = f"exam:{student_id}:history"
    history = db_get(history_key, default=[])
    if not isinstance(history, list):
        history = []

    history.append(
        {
            "exam_id": exam_id,
            "timestamp": timestamp,
            "subject": exam.get("subject"),
            "source": "personal",
        }
    )
    db_set(history_key, history)

    return JSONResponse(content=result)


@router.get("/school-exams/{exam_id}")
async def get_school_exam_for_student(request: Request, exam_id: str):
    auth_error = require_student_auth(request)
    if auth_error:
        return auth_error

    school_exam_id = parse_school_exam_id(exam_id)
    if school_exam_id is None:
        return JSONResponse(status_code=422, content={"message": "شناسه آزمون مدرسه نامعتبر است."})

    exam_info = get_school_exam_info(school_exam_id)
    questions = get_school_exam_questions(school_exam_id)
    if not isinstance(exam_info, dict) or not isinstance(questions, list):
        return JSONResponse(status_code=404, content={"message": "آزمون مدرسه یافت نشد."})

    student = request.state.student
    student_id = request.state.student_id
    if not student_matches_exam(student, exam_info):
        return JSONResponse(status_code=403, content={"message": "این آزمون برای شما فعال نیست."})

    status = evaluate_exam_status(exam_info)
    if status.get("status") != "live":
        if status.get("status") == "scheduled":
            return JSONResponse(
                status_code=403,
                content={"message": "این آزمون هنوز شروع نشده است.", "status": status},
            )
        return JSONResponse(
            status_code=403,
            content={"message": "زمان مجاز این آزمون به پایان رسیده است.", "status": status},
        )

    existing_result = db_get(build_school_result_key(student_id, school_exam_id))
    if isinstance(existing_result, dict):
        return JSONResponse(
            status_code=409,
            content={
                "message": "نتیجه این آزمون قبلاً ثبت شده است.",
                "result": existing_result,
            },
        )

    return JSONResponse(
        content={
            "success": True,
            "exam": {
                "exam_id": school_exam_id,
                "title": exam_info.get("title"),
                "subject": exam_info.get("subject"),
                "focus_area": exam_info.get("focus_area"),
                "duration": exam_info.get("duration"),
                "start_time": exam_info.get("start_time"),
                "end_time": status.get("end_time"),
                "question_count": exam_info.get("question_count") or len(questions),
                "difficulty_matrix": exam_info.get("difficulty_matrix"),
            },
            "questions": _public_school_questions(questions),
            "server_time": school_utcnow_iso(),
            "status": status,
        }
    )


@router.post("/school-exams/{exam_id}/submit")
async def submit_school_exam(request: Request, exam_id: str, payload: SchoolExamSubmitPayload):
    auth_error = require_student_auth(request)
    if auth_error:
        return auth_error

    school_exam_id = parse_school_exam_id(exam_id)
    if school_exam_id is None:
        return JSONResponse(status_code=422, content={"message": "شناسه آزمون مدرسه نامعتبر است."})

    exam_info = get_school_exam_info(school_exam_id)
    questions = get_school_exam_questions(school_exam_id)
    if not isinstance(exam_info, dict) or not isinstance(questions, list):
        return JSONResponse(status_code=404, content={"message": "آزمون مدرسه یافت نشد."})

    student = request.state.student
    student_id = request.state.student_id
    if not student_matches_exam(student, exam_info):
        return JSONResponse(status_code=403, content={"message": "این آزمون برای شما فعال نیست."})

    status = evaluate_exam_status(exam_info)
    status_name = status.get("status")
    start_time = status.get("start_time")
    end_time = status.get("end_time")

    if status_name == "scheduled":
        return JSONResponse(
            status_code=403,
            content={
                "code": "school_exam_not_started",
                "message": "این آزمون هنوز شروع نشده است و امکان ارسال پاسخ وجود ندارد.",
                "start_time": start_time,
                "server_time": school_utcnow_iso(),
            },
        )

    if status_name != "live":
        return JSONResponse(
            status_code=403,
            content={
                "code": "school_exam_submission_window_closed",
                "message": "مهلت ارسال این آزمون تمام شده است. بعد از زمان پایان، ثبت پاسخ به‌صورت سخت‌گیرانه مسدود می‌شود.",
                "end_time": end_time,
                "server_time": school_utcnow_iso(),
            },
        )

    _, strict_end_time = get_exam_window(exam_info)
    if strict_end_time is not None:
        current_utc = datetime.now(timezone.utc)
        if current_utc > strict_end_time:
            return JSONResponse(
                status_code=403,
                content={
                    "code": "school_exam_submission_window_closed",
                    "message": "مهلت ارسال این آزمون تمام شده است. بعد از زمان پایان، ثبت پاسخ به‌صورت سخت‌گیرانه مسدود می‌شود.",
                    "end_time": strict_end_time.isoformat(),
                    "server_time": school_utcnow_iso(),
                },
            )

    result_key = build_school_result_key(student_id, school_exam_id)
    existing_result = db_get(result_key)
    if isinstance(existing_result, dict):
        return JSONResponse(
            status_code=409,
            content={
                "message": "نتیجه این آزمون قبلاً ثبت شده است.",
                "result": existing_result,
            },
        )

    answers = payload.answers if isinstance(payload.answers, dict) else {}

    score = 0
    explanations: list[dict] = []
    weak_points: list[str] = []
    seen_weak_points: set[str] = set()

    # Build a topic map from focus_area for school exams
    # Extract topics from the focus_area field (e.g., "فصل ۱: مبانی ریاضی، فصل ۲: هندسه")
    focus_area = exam_info.get("focus_area", "")
    topic_keywords = []
    if focus_area:
        # Split by common delimiters and extract meaningful topics
        for part in focus_area.replace("،", ",").replace("؛", ",").split(","):
            cleaned = part.strip()
            if cleaned:
                topic_keywords.append(cleaned)

    for question in questions:
        if not isinstance(question, dict):
            continue

        question_id = question.get("id")
        if question_id is None:
            continue

        raw_student_answer = answers.get(str(question_id), answers.get(question_id))
        student_answer_index = _normalize_selected_option_index(raw_student_answer)
        correct_answer_index = _normalize_selected_option_index(question.get("correct_answer_index"))

        is_correct = (
            student_answer_index is not None
            and correct_answer_index is not None
            and student_answer_index == correct_answer_index
        )

        if is_correct:
            score += 1
        else:
            # For school exams, extract topic from focus_area or use subject as fallback
            # Use the focus_area as the weakness topic since school exams are focused on specific areas
            if topic_keywords:
                # Use the first topic keyword as the weakness (or could use all)
                for topic in topic_keywords:
                    if topic not in seen_weak_points:
                        weak_points.append(topic)
                        seen_weak_points.add(topic)
                        break  # Only add one topic per wrong answer to avoid duplication
            else:
                # Fallback to subject if no focus_area topics available
                subject = exam_info.get("subject", "مبحث نامشخص")
                if subject not in seen_weak_points:
                    weak_points.append(subject)
                    seen_weak_points.add(subject)

        explanations.append(
            {
                "question_id": question_id,
                "question": question.get("question"),
                "options": question.get("options"),
                "student_answer_index": student_answer_index,
                "student_answer_label": _to_option_label(student_answer_index),
                "correct_answer_index": correct_answer_index,
                "correct_answer_label": _to_option_label(correct_answer_index),
                "is_correct": is_correct,
                "explanation": question.get("explanation", "توضیحی ثبت نشده است."),
            }
        )

    total = len([q for q in questions if isinstance(q, dict)])
    percentage = round((score / total) * 100, 2) if total > 0 else 0.0
    timestamp = school_utcnow_iso()
    attempt_exam_id = make_school_exam_attempt_id(school_exam_id)

    result = {
        "exam_id": attempt_exam_id,
        "school_exam_id": school_exam_id,
        "source": "school",
        "exam_title": exam_info.get("title"),
        "subject": exam_info.get("subject"),
        "score": score,
        "total": total,
        "percentage": percentage,
        "weak_points": weak_points,
        "explanations": explanations,
        "timestamp": timestamp,
        "created_at": timestamp,
    }

    if strict_end_time is not None and datetime.now(timezone.utc) > strict_end_time:
        return JSONResponse(
            status_code=403,
            content={
                "code": "school_exam_submission_window_closed",
                "message": "مهلت ارسال این آزمون تمام شده است. ثبت پاسخ بعد از پایان زمان مجاز نیست.",
                "end_time": strict_end_time.isoformat(),
                "server_time": school_utcnow_iso(),
            },
        )

    db_set(result_key, result, expire=EXAM_RESULT_TTL_SECONDS)

    history_key = f"exam:{student_id}:history"
    history = db_get(history_key, default=[])
    if not isinstance(history, list):
        history = []
    history.append(
        {
            "exam_id": attempt_exam_id,
            "school_exam_id": school_exam_id,
            "source": "school",
            "timestamp": timestamp,
            "subject": exam_info.get("subject"),
        }
    )
    db_set(history_key, history)

    return JSONResponse(content=result)


@router.post("/ai/homework")
async def ai_homework(request: Request, payload: AIHomeworkPayload):
    auth_error = require_student_auth(request)
    if auth_error:
        return auth_error

    subject = _get_subject(payload.subject_id)
    if not subject:
        return JSONResponse(status_code=422, content={"message": "درس انتخاب‌شده معتبر نیست."})

    message = payload.message.strip()
    if not message:
        return JSONResponse(status_code=422, content={"message": "پیام نمی‌تواند خالی باشد."})

    student = request.state.student
    class_id = student.get("class_id")
    if not isinstance(class_id, int):
        return JSONResponse(
            status_code=422,
            content={"message": "اطلاعات کلاس دانش‌آموز معتبر نیست."},
        )

    assignment, assignment_error = _build_homework_assignment_context(
        class_id=class_id,
        subject=subject,
        homework_id=payload.homework_id,
    )

    if assignment_error:
        if assignment_error.startswith("در حال حاضر تکلیف فعالی") or assignment_error.startswith("برای درس"):
            return JSONResponse(
                content={
                    "response": assignment_error,
                    "assignment_title": "",
                    "timestamp": _utcnow_iso(),
                }
            )

        if assignment_error == "این تکلیف متعلق به کلاس شما نیست.":
            return JSONResponse(status_code=403, content={"message": assignment_error})

        status_code = 404 if "پیدا نشد" in assignment_error else 422
        return JSONResponse(status_code=status_code, content={"message": assignment_error})

    student_id = request.state.student_id
    allowed, _ = _consume_rate_limit(student_id)
    if not allowed:
        return JSONResponse(
            status_code=429,
            content={"message": "سقف مجاز درخواست روزانه شما تکمیل شده است. فردا دوباره تلاش کن."},
        )

    grade_label = _get_grade_label(student)
    past_performance = _build_past_performance(student_id, subject["name"])
    system_prompt = generate_system_prompt(
        grade=grade_label,
        subject=subject["name"],
        bot_type="homework_helper",
        past_performance=past_performance,
    )

    due_date = assignment.get("due_date") or assignment.get("due_at") or "نامشخص"
    homework_prompt = f"""
اطلاعات تکلیف:
- عنوان: {assignment.get('title', 'بدون عنوان')}
- توضیحات: {assignment.get('description', 'بدون توضیح')}
- مهلت تحویل: {due_date}

سوال دانش‌آموز:
{message}

یادآوری: پاسخ نهایی مستقیم نده؛ فقط راهنمایی و سرنخ آموزشی ارائه کن.
""".strip()

    ai_result = call_openai_api(
        system_prompt=system_prompt,
        user_message=homework_prompt,
        temperature=0.3,
        max_tokens=1000,
    )

    if not ai_result.get("success"):
        return _api_failure_to_response(ai_result)

    return JSONResponse(
        content={
            "response": ai_result["content"],
            "assignment_title": assignment.get("title", "تکلیف کلاس"),
            "timestamp": _utcnow_iso(),
        }
    )
