from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from backend.db.helpers import db_get, db_keys_by_prefix, db_set, next_counter
from backend.services.ai_service import call_openai_api, extract_json_payload

SCHOOL_EXAM_PREFIX = "school-"
DIFFICULTY_KEYS = ("easy", "medium", "hard", "gifted")
PERSIAN_DIFFICULTY_LABELS = {
    "easy": "آسان",
    "medium": "متوسط",
    "hard": "سخت",
    "gifted": "تیزهوشان",
}
MAX_QUESTIONS = 50


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def utcnow_iso() -> str:
    return utcnow().isoformat()


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    text = str(value).strip()
    if not text:
        return None

    if text.endswith("Z"):
        text = text[:-1] + "+00:00"

    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


def make_school_exam_attempt_id(school_exam_id: int | str) -> str:
    return f"{SCHOOL_EXAM_PREFIX}{school_exam_id}"


def parse_school_exam_id(raw_exam_id: Any) -> int | None:
    if isinstance(raw_exam_id, int):
        return raw_exam_id

    raw_text = str(raw_exam_id or "").strip()
    if not raw_text:
        return None

    if raw_text.isdigit():
        return int(raw_text)

    if raw_text.startswith(SCHOOL_EXAM_PREFIX):
        suffix = raw_text[len(SCHOOL_EXAM_PREFIX) :]
        if suffix.isdigit():
            return int(suffix)

    return None


def build_school_result_key(student_id: int, school_exam_id: int) -> str:
    return f"exam:{student_id}:{make_school_exam_attempt_id(school_exam_id)}:result"


def normalize_difficulty_matrix(raw_matrix: dict[str, Any]) -> dict[str, int] | None:
    if not isinstance(raw_matrix, dict):
        return None

    normalized: dict[str, int] = {}
    for key in DIFFICULTY_KEYS:
        value = raw_matrix.get(key)
        if isinstance(value, bool):
            return None
        if isinstance(value, str):
            value = value.strip()
            if not value.isdigit():
                return None
            value = int(value)
        if not isinstance(value, int) or value < 0:
            return None
        normalized[key] = value

    return normalized


def resolve_grade_name(grade_id: int) -> str:
    grade = db_get(f"grade:{grade_id}:info")
    if isinstance(grade, dict):
        grade_name = str(grade.get("name") or "").strip()
        if grade_name:
            return grade_name
    return f"پایه {grade_id}"


def resolve_class_name(class_id: int | None) -> str | None:
    if not isinstance(class_id, int):
        return None
    class_obj = db_get(f"class:{class_id}:info")
    if isinstance(class_obj, dict):
        class_name = str(class_obj.get("name") or "").strip()
        if class_name:
            return class_name
    return f"کلاس {class_id}"


def validate_exam_target(grade_id: int, class_id: int | None) -> str | None:
    grade = db_get(f"grade:{grade_id}:info")
    if not isinstance(grade, dict):
        return "پایه انتخاب‌شده معتبر نیست."

    if class_id is None:
        return None

    class_obj = db_get(f"class:{class_id}:info")
    if not isinstance(class_obj, dict):
        return "کلاس انتخاب‌شده معتبر نیست."

    if class_obj.get("grade_id") != grade_id:
        return "کلاس انتخاب‌شده متعلق به این پایه نیست."

    return None


def build_school_exam_system_prompt() -> str:
    return """
تو طراح ارشد آزمون در یک مدرسه هستی و باید آزمونی رسمی، معتبر و حرفه‌ای طراحی کنی.
قواعد غیرقابل‌نقض:
1) فقط و فقط JSON معتبر برگردان. هیچ متن اضافه، توضیح یا Markdown ننویس.
2) تمرکز آزمون باید دقیقاً مطابق focus_area باشد و از خروج از محدوده جلوگیری شود.
3) هر سوال باید چهارگزینه‌ای استاندارد با ۴ گزینه کاملاً متمایز باشد.
4) correct_answer_index باید فقط یک عدد صحیح بین 0 تا 3 باشد.
5) explanation باید آموزشی، کوتاه، دقیق و قابل‌فهم برای دانش‌آموز باشد.
6) برای کنترل توزیع سطح دشواری، مقدار difficulty هر سوال باید دقیقاً یکی از easy, medium, hard, gifted باشد.
7) تعداد سوال‌ها و توزیع سطح دشواری باید دقیقاً با خواسته کاربر برابر باشد.
""".strip()


def _build_school_exam_user_prompt(
    *,
    title: str,
    subject: str,
    grade_name: str,
    class_name: str,
    focus_area: str,
    difficulty_matrix: dict[str, int],
    total_questions: int,
) -> str:
    return f"""
عنوان آزمون: {title}
درس: {subject}
پایه: {grade_name}
دامنه اجرا: {class_name}
focus_area: {focus_area}

تعداد کل سوال: {total_questions}
توزیع سختی (الزامی و دقیق):
- easy ({PERSIAN_DIFFICULTY_LABELS['easy']}): {difficulty_matrix['easy']}
- medium ({PERSIAN_DIFFICULTY_LABELS['medium']}): {difficulty_matrix['medium']}
- hard ({PERSIAN_DIFFICULTY_LABELS['hard']}): {difficulty_matrix['hard']}
- gifted ({PERSIAN_DIFFICULTY_LABELS['gifted']}): {difficulty_matrix['gifted']}

فرمت خروجی باید دقیقاً چنین باشد:
{{
  "questions": [
    {{
      "question": "متن سوال",
      "options": ["گزینه 1", "گزینه 2", "گزینه 3", "گزینه 4"],
      "correct_answer_index": 0,
      "explanation": "توضیح آموزشی پاسخ صحیح",
      "difficulty": "easy"
    }}
  ]
}}

نکات سخت‌گیرانه:
- دقیقاً {total_questions} سوال تولید کن.
- options برای هر سوال دقیقاً 4 مورد باشد.
- سوال‌ها را خارج از focus_area نساز.
- difficulty هر سوال را الزامی ثبت کن.
""".strip()


def _normalize_difficulty(raw_value: Any) -> str | None:
    text = str(raw_value or "").strip().lower()
    aliases = {
        "easy": "easy",
        "اسان": "easy",
        "آسان": "easy",
        "medium": "medium",
        "متوسط": "medium",
        "hard": "hard",
        "سخت": "hard",
        "gifted": "gifted",
        "تیزهوشان": "gifted",
        "تيزهوشان": "gifted",
        "tizhooshan": "gifted",
    }
    return aliases.get(text)


def _normalize_options(raw_options: Any) -> list[str] | None:
    if isinstance(raw_options, list) and len(raw_options) == 4:
        options = [str(item or "").strip() for item in raw_options]
    elif isinstance(raw_options, dict):
        options = [
            str(raw_options.get("A") or raw_options.get("a") or "").strip(),
            str(raw_options.get("B") or raw_options.get("b") or "").strip(),
            str(raw_options.get("C") or raw_options.get("c") or "").strip(),
            str(raw_options.get("D") or raw_options.get("d") or "").strip(),
        ]
    else:
        return None

    if not all(options):
        return None

    return options


def _normalize_correct_answer_index(raw_value: Any) -> int | None:
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


def parse_school_exam_questions(
    raw_output: str,
    total_questions: int,
    difficulty_matrix: dict[str, int],
) -> list[dict]:
    payload = extract_json_payload(raw_output)

    if isinstance(payload, dict):
        raw_questions = payload.get("questions")
    elif isinstance(payload, list):
        raw_questions = payload
    else:
        raw_questions = None

    if not isinstance(raw_questions, list):
        return []

    cleaned: list[dict] = []
    difficulty_counter = {key: 0 for key in DIFFICULTY_KEYS}

    for item in raw_questions:
        if not isinstance(item, dict):
            continue

        question_text = str(item.get("question") or item.get("text") or "").strip()
        options = _normalize_options(item.get("options"))
        correct_answer_index = _normalize_correct_answer_index(
            item.get("correct_answer_index", item.get("correct_index", item.get("correct_answer")))
        )
        explanation = str(item.get("explanation") or "").strip()
        difficulty = _normalize_difficulty(item.get("difficulty"))

        if (
            not question_text
            or not options
            or correct_answer_index is None
            or not explanation
            or difficulty is None
        ):
            continue

        cleaned.append(
            {
                "id": len(cleaned) + 1,
                "question": question_text,
                "options": options,
                "correct_answer_index": correct_answer_index,
                "explanation": explanation,
                "difficulty": difficulty,
            }
        )
        difficulty_counter[difficulty] += 1

        if len(cleaned) >= total_questions:
            break

    if len(cleaned) != total_questions:
        return []

    for key in DIFFICULTY_KEYS:
        if difficulty_counter.get(key, 0) != difficulty_matrix.get(key, 0):
            return []

    return cleaned


def generate_school_exam_questions(
    *,
    title: str,
    subject: str,
    grade_name: str,
    class_name: str,
    focus_area: str,
    difficulty_matrix: dict[str, int],
    total_questions: int,
) -> tuple[list[dict] | None, str | None]:
    system_prompt = build_school_exam_system_prompt()
    base_user_prompt = _build_school_exam_user_prompt(
        title=title,
        subject=subject,
        grade_name=grade_name,
        class_name=class_name,
        focus_area=focus_area,
        difficulty_matrix=difficulty_matrix,
        total_questions=total_questions,
    )

    last_error = ""
    for attempt in range(2):
        user_prompt = base_user_prompt
        if attempt == 1:
            user_prompt += "\n\nپاسخ قبلی معتبر نبود. این بار دقیقاً و فقط طبق JSON خواسته‌شده پاسخ بده."

        ai_result = call_openai_api(
            system_prompt=system_prompt,
            user_message=user_prompt,
            temperature=0.2,
            max_tokens=3500,
        )

        if not ai_result.get("success"):
            last_error = ai_result.get("error") or "خطا در ارتباط با سرویس هوش مصنوعی"
            continue

        questions = parse_school_exam_questions(
            ai_result.get("content") or "",
            total_questions=total_questions,
            difficulty_matrix=difficulty_matrix,
        )
        if questions:
            return questions, None

        last_error = "خروجی تولیدشده با قالب حرفه‌ای آزمون همخوانی نداشت."

    return None, last_error or "ساخت آزمون با خطا مواجه شد."


def _append_school_exam_to_index(grade_id: int, class_id: int | None, exam_id: int) -> None:
    if isinstance(class_id, int):
        index_key = f"class:{class_id}:school_exams"
    else:
        index_key = f"grade:{grade_id}:school_exams"

    indexed_ids = db_get(index_key, default=[])
    if not isinstance(indexed_ids, list):
        indexed_ids = []

    if exam_id not in indexed_ids:
        indexed_ids.append(exam_id)

    db_set(index_key, indexed_ids)


def create_school_exam(
    *,
    title: str,
    subject: str,
    grade_id: int,
    class_id: int | None,
    start_time: str,
    duration: int,
    focus_area: str,
    difficulty_matrix: dict[str, int],
) -> tuple[dict | None, str | None]:
    title = str(title or "").strip()
    subject = str(subject or "").strip()
    focus_area = str(focus_area or "").strip()

    if not title:
        return None, "عنوان آزمون الزامی است."
    if not subject:
        return None, "نام درس الزامی است."
    if not focus_area:
        return None, "بازه یا محدوده focus_area الزامی است."

    normalized_matrix = normalize_difficulty_matrix(difficulty_matrix)
    if not normalized_matrix:
        return None, "ماتریس سختی معتبر نیست."

    total_questions = sum(normalized_matrix.values())
    if total_questions < 1 or total_questions > MAX_QUESTIONS:
        return None, f"تعداد کل سوال‌ها باید بین ۱ تا {MAX_QUESTIONS} باشد."

    if not isinstance(duration, int) or duration < 1 or duration > 240:
        return None, "مدت آزمون باید بین ۱ تا ۲۴۰ دقیقه باشد."

    target_error = validate_exam_target(grade_id, class_id)
    if target_error:
        return None, target_error

    parsed_start_time = parse_datetime(start_time)
    if parsed_start_time is None:
        return None, "زمان شروع معتبر نیست."

    grade_name = resolve_grade_name(grade_id)
    class_name = resolve_class_name(class_id) or "همه کلاس‌های پایه"

    questions, generation_error = generate_school_exam_questions(
        title=title,
        subject=subject,
        grade_name=grade_name,
        class_name=class_name,
        focus_area=focus_area,
        difficulty_matrix=normalized_matrix,
        total_questions=total_questions,
    )
    if not questions:
        return None, generation_error or "ساخت سوالات آزمون ناموفق بود."

    exam_id = next_counter("school_exam")
    created_at = utcnow_iso()

    info = {
        "id": exam_id,
        "title": title,
        "subject": subject,
        "grade_id": grade_id,
        "class_id": class_id,
        "start_time": parsed_start_time.isoformat(),
        "duration": duration,
        "difficulty_matrix": normalized_matrix,
        "focus_area": focus_area,
        "question_count": total_questions,
        "created_at": created_at,
    }

    db_set(f"school_exam:{exam_id}:info", info)
    db_set(f"school_exam:{exam_id}:questions", questions)

    _append_school_exam_to_index(grade_id, class_id, exam_id)

    return info, None


def get_school_exam_info(exam_id: int) -> dict | None:
    exam = db_get(f"school_exam:{exam_id}:info")
    if isinstance(exam, dict):
        return exam
    return None


def get_school_exam_questions(exam_id: int) -> list[dict] | None:
    questions = db_get(f"school_exam:{exam_id}:questions")
    if isinstance(questions, list):
        return questions
    return None


def list_school_exams(grade_id: int | None = None, class_id: int | None = None) -> list[dict]:
    exams: list[dict] = []
    for key in db_keys_by_prefix("school_exam:"):
        if not key.endswith(":info"):
            continue
        info = db_get(key)
        if not isinstance(info, dict):
            continue

        if isinstance(grade_id, int) and info.get("grade_id") != grade_id:
            continue
        if class_id is not None:
            if class_id == -1 and info.get("class_id") is not None:
                continue
            if class_id != -1 and info.get("class_id") != class_id:
                continue

        exams.append(info)

    def sort_key(item: dict) -> datetime:
        parsed_start = parse_datetime(item.get("start_time"))
        return parsed_start or datetime.min.replace(tzinfo=timezone.utc)

    return sorted(exams, key=sort_key, reverse=True)


def student_matches_exam(student: dict, exam_info: dict) -> bool:
    student_grade_id = student.get("grade_id")
    student_class_id = student.get("class_id")

    if exam_info.get("grade_id") != student_grade_id:
        return False

    target_class_id = exam_info.get("class_id")
    if target_class_id is None:
        return True

    return student_class_id == target_class_id


def get_exam_window(exam_info: dict) -> tuple[datetime | None, datetime | None]:
    start_time = parse_datetime(exam_info.get("start_time"))
    duration = exam_info.get("duration")

    if start_time is None or not isinstance(duration, int) or duration < 1:
        return None, None

    end_time = start_time + timedelta(minutes=duration)
    return start_time, end_time


def evaluate_exam_status(exam_info: dict, *, now: datetime | None = None) -> dict:
    now_value = now or utcnow()
    start_time, end_time = get_exam_window(exam_info)
    if start_time is None or end_time is None:
        return {
            "status": "invalid",
            "seconds_until_start": None,
            "seconds_until_end": None,
            "start_time": exam_info.get("start_time"),
            "end_time": None,
        }

    if now_value < start_time:
        return {
            "status": "scheduled",
            "seconds_until_start": max(0, int((start_time - now_value).total_seconds())),
            "seconds_until_end": max(0, int((end_time - now_value).total_seconds())),
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
        }

    if now_value <= end_time:
        return {
            "status": "live",
            "seconds_until_start": 0,
            "seconds_until_end": max(0, int((end_time - now_value).total_seconds())),
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
        }

    return {
        "status": "expired",
        "seconds_until_start": 0,
        "seconds_until_end": 0,
        "start_time": start_time.isoformat(),
        "end_time": end_time.isoformat(),
    }


def list_student_school_exams(student: dict, student_id: int) -> list[dict]:
    grade_id = student.get("grade_id")
    class_id = student.get("class_id")

    if not isinstance(grade_id, int):
        return []

    grade_exam_ids = db_get(f"grade:{grade_id}:school_exams", default=[])
    class_exam_ids = db_get(f"class:{class_id}:school_exams", default=[]) if isinstance(class_id, int) else []

    exam_ids: list[int] = []
    for raw_id in [*(grade_exam_ids if isinstance(grade_exam_ids, list) else []), *(class_exam_ids if isinstance(class_exam_ids, list) else [])]:
        if isinstance(raw_id, int):
            exam_ids.append(raw_id)
        elif isinstance(raw_id, str) and raw_id.isdigit():
            exam_ids.append(int(raw_id))

    exams: list[dict] = []
    now_value = utcnow()

    for exam_id in sorted(set(exam_ids)):
        info = get_school_exam_info(exam_id)
        if not info or not student_matches_exam(student, info):
            continue

        status_data = evaluate_exam_status(info, now=now_value)
        result_exists = isinstance(db_get(build_school_result_key(student_id, exam_id)), dict)

        exams.append(
            {
                "exam_id": exam_id,
                "title": info.get("title"),
                "subject": info.get("subject"),
                "grade_id": info.get("grade_id"),
                "class_id": info.get("class_id"),
                "class_name": resolve_class_name(info.get("class_id")),
                "start_time": info.get("start_time"),
                "duration": info.get("duration"),
                "difficulty_matrix": info.get("difficulty_matrix"),
                "focus_area": info.get("focus_area"),
                "question_count": info.get("question_count"),
                "created_at": info.get("created_at"),
                "status": status_data.get("status"),
                "seconds_until_start": status_data.get("seconds_until_start"),
                "seconds_until_end": status_data.get("seconds_until_end"),
                "end_time": status_data.get("end_time"),
                "already_submitted": result_exists,
                "can_enter": status_data.get("status") == "live" and not result_exists,
            }
        )

    def sort_key(item: dict) -> datetime:
        parsed_start = parse_datetime(item.get("start_time"))
        return parsed_start or datetime.min.replace(tzinfo=timezone.utc)

    return sorted(exams, key=sort_key)
