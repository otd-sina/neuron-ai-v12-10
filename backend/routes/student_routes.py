from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from backend.modules.students import (
    create_student,
    get_student,
    update_student,
    delete_student,
    list_students,
)
from backend.modules.auth import validate_session

router = APIRouter(prefix="/api/students", tags=["students"])


def require_auth(request: Request):
    token = request.cookies.get("session_token")
    if not validate_session(token):
        return False
    return True


class StudentCreate(BaseModel):
    full_name: str
    national_id: str
    phone: str
    password: str
    grade_id: int
    class_id: int
    school_name: str | None = None


class StudentUpdate(BaseModel):
    full_name: str | None = None
    national_id: str | None = None
    phone: str | None = None
    password: str | None = None
    grade_id: int | None = None
    class_id: int | None = None
    school_name: str | None = None


@router.get("")
async def get_students(request: Request, grade_id: int | None = None, class_id: int | None = None):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    students = list_students(grade_id=grade_id, class_id=class_id)
    return JSONResponse(content={"students": students})


@router.post("")
async def add_student(request: Request, data: StudentCreate):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    student = create_student(
        full_name=data.full_name,
        national_id=data.national_id,
        phone=data.phone,
        password=data.password,
        grade_id=data.grade_id,
        class_id=data.class_id,
        school_name=data.school_name,
    )
    safe = {k: v for k, v in student.items() if k != "password_hash"}
    return JSONResponse(status_code=201, content={"student": safe})


@router.get("/{student_id}")
async def get_student_detail(request: Request, student_id: int):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    student = get_student(student_id)
    if student is None:
        return JSONResponse(status_code=404, content={"message": "دانش‌آموز یافت نشد."})
    safe = {k: v for k, v in student.items() if k != "password_hash"}
    return JSONResponse(content={"student": safe})


@router.put("/{student_id}")
async def edit_student(request: Request, student_id: int, data: StudentUpdate):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    student = update_student(student_id, updates)
    if student is None:
        return JSONResponse(status_code=404, content={"message": "دانش‌آموز یافت نشد."})
    safe = {k: v for k, v in student.items() if k != "password_hash"}
    return JSONResponse(content={"student": safe})


@router.delete("/{student_id}")
async def remove_student(request: Request, student_id: int):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    success = delete_student(student_id)
    if not success:
        return JSONResponse(status_code=404, content={"message": "دانش‌آموز یافت نشد."})
    return JSONResponse(content={"message": "دانش‌آموز با موفقیت حذف شد."})
