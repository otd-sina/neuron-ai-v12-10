from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.db.helpers import db_delete, db_get, db_keys_by_prefix, db_set
from backend.modules.auth import validate_session
from backend.modules.school_exams import (
    create_school_exam,
    evaluate_exam_status,
    list_school_exams,
    resolve_class_name,
    resolve_grade_name,
)

router = APIRouter(prefix="/api/school-exams", tags=["school-exams"])


def require_auth(request: Request) -> bool:
    token = request.cookies.get("session_token")
    return validate_session(token)


class DifficultyMatrixPayload(BaseModel):
    easy: int = Field(default=0, ge=0)
    medium: int = Field(default=0, ge=0)
    hard: int = Field(default=0, ge=0)
    gifted: int = Field(default=0, ge=0)


class SchoolExamCreatePayload(BaseModel):
    title: str
    subject: str
    grade_id: int
    class_id: int | None = None
    start_time: str
    duration: int = Field(ge=1, le=240)
    focus_area: str
    total_questions: int = Field(ge=1, le=50)
    difficulty_matrix: DifficultyMatrixPayload


@router.post("")
async def create_exam(request: Request, payload: SchoolExamCreatePayload):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})

    difficulty_matrix = payload.difficulty_matrix.model_dump()
    difficulty_total = sum(difficulty_matrix.values())
    if difficulty_total != payload.total_questions:
        return JSONResponse(
            status_code=422,
            content={
                "message": "جمع ماتریس سختی باید دقیقاً با تعداد کل سوال برابر باشد.",
            },
        )

    exam, error = create_school_exam(
        title=payload.title,
        subject=payload.subject,
        grade_id=payload.grade_id,
        class_id=payload.class_id,
        start_time=payload.start_time,
        duration=payload.duration,
        focus_area=payload.focus_area,
        difficulty_matrix=difficulty_matrix,
    )

    if error or not exam:
        status_code = 502 if "هوش مصنوعی" in str(error) or "خروجی" in str(error) else 422
        return JSONResponse(status_code=status_code, content={"message": error or "خطا در ساخت آزمون"})

    response_exam = {
        **exam,
        "grade_name": resolve_grade_name(exam["grade_id"]),
        "class_name": resolve_class_name(exam.get("class_id")),
    }

    return JSONResponse(
        status_code=201,
        content={
            "success": True,
            "exam": response_exam,
            "message": "آزمون مدرسه با موفقیت ایجاد شد.",
        },
    )


@router.get("")
async def get_exams(request: Request, grade_id: int | None = None, class_id: int | None = None):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})

    exams = list_school_exams(grade_id=grade_id, class_id=class_id)
    payload: list[dict] = []

    for exam in exams:
        status = evaluate_exam_status(exam)
        payload.append(
            {
                **exam,
                "grade_name": resolve_grade_name(exam.get("grade_id")),
                "class_name": resolve_class_name(exam.get("class_id")),
                "status": status.get("status"),
                "end_time": status.get("end_time"),
            }
        )

    return JSONResponse(content={"exams": payload})



@router.delete("/{exam_id}")
async def delete_exam(request: Request, exam_id: int):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})

    exam_info = db_get(f"school_exam:{exam_id}:info")
    if not isinstance(exam_info, dict):
        return JSONResponse(status_code=404, content={"message": "آزمون یافت نشد."})

    grade_id = exam_info.get("grade_id")
    class_id = exam_info.get("class_id")

    db_delete(f"school_exam:{exam_id}:info")
    db_delete(f"school_exam:{exam_id}:questions")

    if isinstance(class_id, int):
        index_key = f"class:{class_id}:school_exams"
    else:
        index_key = f"grade:{grade_id}:school_exams"

    indexed_ids = db_get(index_key, default=[])
    if isinstance(indexed_ids, list) and exam_id in indexed_ids:
        indexed_ids.remove(exam_id)
        if indexed_ids:
            db_set(index_key, indexed_ids)
        else:
            db_delete(index_key)

    for key in db_keys_by_prefix(f"exam:"):
        if f":{exam_id}:result" in key:
            db_delete(key)

    return JSONResponse(
        status_code=200,
        content={
            "success": True,
            "message": f"آزمون «{exam_info.get('title')}» با موفقیت حذف شد.",
        },
    )
