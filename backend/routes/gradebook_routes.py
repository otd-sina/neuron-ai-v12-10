from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.modules.auth import validate_session
from backend.modules.classes import list_classes, list_grades
from backend.modules.gradebook import (
    build_class_performance_analytics,
    build_student_report_card,
    create_grade_record,
    delete_grade_record,
    get_class_attendance_sheet,
    get_class_participation_sheet,
    get_gradebook_overview,
    list_grade_records,
    save_class_attendance,
    save_class_participation,
    update_grade_record,
)
from backend.modules.students import list_students

router = APIRouter(prefix="/api/gradebook", tags=["gradebook"])


def require_auth(request: Request) -> bool:
    token = request.cookies.get("session_token")
    return validate_session(token)


class GradeRecordCreatePayload(BaseModel):
    class_id: int
    student_id: int
    subject: str
    title: str
    assessment_type: str = "quiz"
    score: float = Field(ge=0)
    max_score: float = Field(gt=0)
    weight: float = Field(default=1.0, gt=0)
    recorded_at: str | None = None
    term: str | None = None
    notes: str | None = None


class GradeRecordUpdatePayload(BaseModel):
    class_id: int | None = None
    student_id: int | None = None
    subject: str | None = None
    title: str | None = None
    assessment_type: str | None = None
    score: float | None = Field(default=None, ge=0)
    max_score: float | None = Field(default=None, gt=0)
    weight: float | None = Field(default=None, gt=0)
    recorded_at: str | None = None
    term: str | None = None
    notes: str | None = None


class AttendanceExceptionPayload(BaseModel):
    student_id: int
    status: str
    note: str | None = None


class AttendanceSavePayload(BaseModel):
    class_id: int
    attendance_date: str | None = None
    exceptions: list[AttendanceExceptionPayload] = Field(default_factory=list)


class ParticipationEntryPayload(BaseModel):
    student_id: int
    score: float | None = Field(default=None, ge=0, le=5)
    note: str | None = None


class ParticipationSavePayload(BaseModel):
    class_id: int
    participation_date: str | None = None
    entries: list[ParticipationEntryPayload] = Field(default_factory=list)


@router.get("/bootstrap")
async def gradebook_bootstrap(request: Request):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})

    return JSONResponse(
        content={
            "success": True,
            "grades": list_grades(),
            "classes": list_classes(),
            "students": list_students(),
        }
    )


@router.get("/records")
async def gradebook_records(
    request: Request,
    class_id: int | None = None,
    student_id: int | None = None,
    subject: str | None = None,
    assessment_type: str | None = None,
):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})

    records = list_grade_records(
        class_id=class_id,
        student_id=student_id,
        subject=subject,
        assessment_type=assessment_type,
    )

    percentages = [
        float(record["percentage"])
        for record in records
        if isinstance(record.get("percentage"), (int, float))
    ]
    average_percentage = round(sum(percentages) / len(percentages), 2) if percentages else None

    return JSONResponse(
        content={
            "success": True,
            "records": records,
            "stats": {
                "count": len(records),
                "average_percentage": average_percentage,
            },
        }
    )


@router.post("/records")
async def add_grade_record(request: Request, payload: GradeRecordCreatePayload):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})

    record, error = create_grade_record(
        class_id=payload.class_id,
        student_id=payload.student_id,
        subject=payload.subject,
        title=payload.title,
        assessment_type=payload.assessment_type,
        score=payload.score,
        max_score=payload.max_score,
        weight=payload.weight,
        recorded_at=payload.recorded_at,
        term=payload.term,
        notes=payload.notes,
    )
    if error:
        return JSONResponse(status_code=422, content={"message": error})

    return JSONResponse(
        status_code=201,
        content={
            "success": True,
            "message": "نمره با موفقیت ثبت شد.",
            "record": record,
        },
    )


@router.put("/records/{record_id}")
async def edit_grade_record(request: Request, record_id: int, payload: GradeRecordUpdatePayload):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})

    updates = {key: value for key, value in payload.model_dump().items() if value is not None}
    if not updates:
        return JSONResponse(status_code=422, content={"message": "هیچ تغییری برای بروزرسانی ارسال نشده است."})

    record, error = update_grade_record(record_id, updates)
    if error:
        if "پیدا نشد" in error:
            return JSONResponse(status_code=404, content={"message": error})
        return JSONResponse(status_code=422, content={"message": error})

    return JSONResponse(
        content={
            "success": True,
            "message": "رکورد نمره بروزرسانی شد.",
            "record": record,
        }
    )


@router.delete("/records/{record_id}")
async def remove_grade_record(request: Request, record_id: int):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})

    success = delete_grade_record(record_id)
    if not success:
        return JSONResponse(status_code=404, content={"message": "رکورد نمره پیدا نشد."})

    return JSONResponse(content={"success": True, "message": "رکورد نمره حذف شد."})


@router.get("/attendance/sheet")
async def attendance_sheet(request: Request, class_id: int, attendance_date: str | None = None):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})

    sheet, error = get_class_attendance_sheet(class_id, attendance_date=attendance_date)
    if error:
        status_code = 404 if "کلاس" in error else 422
        return JSONResponse(status_code=status_code, content={"message": error})

    return JSONResponse(content={"success": True, "sheet": sheet})


@router.post("/attendance/sheet")
async def save_attendance_sheet(request: Request, payload: AttendanceSavePayload):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})

    sheet, error = save_class_attendance(
        class_id=payload.class_id,
        attendance_date=payload.attendance_date,
        exceptions=[item.model_dump() for item in payload.exceptions],
    )
    if error:
        status_code = 404 if "کلاس" in error else 422
        return JSONResponse(status_code=status_code, content={"message": error})

    return JSONResponse(
        content={
            "success": True,
            "message": "حضور و غیاب کلاس ذخیره شد.",
            "sheet": sheet,
        }
    )


@router.get("/participation/sheet")
async def participation_sheet(request: Request, class_id: int, participation_date: str | None = None):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})

    sheet, error = get_class_participation_sheet(class_id, participation_date=participation_date)
    if error:
        status_code = 404 if "کلاس" in error else 422
        return JSONResponse(status_code=status_code, content={"message": error})

    return JSONResponse(content={"success": True, "sheet": sheet})


@router.post("/participation/sheet")
async def save_participation_sheet(request: Request, payload: ParticipationSavePayload):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})

    sheet, error = save_class_participation(
        class_id=payload.class_id,
        participation_date=payload.participation_date,
        entries=[item.model_dump() for item in payload.entries],
    )
    if error:
        status_code = 404 if "کلاس" in error else 422
        return JSONResponse(status_code=status_code, content={"message": error})

    return JSONResponse(
        content={
            "success": True,
            "message": "امتیاز مشارکت کلاس ذخیره شد.",
            "sheet": sheet,
        }
    )


@router.get("/report-card/{student_id}")
async def student_report_card(request: Request, student_id: int, class_id: int | None = None):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})

    report = build_student_report_card(student_id, class_id=class_id)
    if report is None:
        return JSONResponse(status_code=404, content={"message": "دانش‌آموز موردنظر پیدا نشد."})

    return JSONResponse(content={"success": True, "report_card": report})


@router.get("/class-analytics/{class_id}")
async def class_gradebook_analytics(request: Request, class_id: int):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})

    analytics = build_class_performance_analytics(class_id)
    if analytics is None:
        return JSONResponse(status_code=404, content={"message": "کلاس موردنظر پیدا نشد."})

    return JSONResponse(content={"success": True, "analytics": analytics})


@router.get("/analytics/overview")
async def gradebook_analytics_overview(request: Request):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})

    return JSONResponse(content={"success": True, "overview": get_gradebook_overview()})
