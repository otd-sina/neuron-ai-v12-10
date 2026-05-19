from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from backend.modules.classes import (
    create_grade,
    get_grade,
    list_grades,
    create_class,
    get_class,
    list_classes,
    delete_class,
    get_class_students,
)
from backend.modules.auth import validate_session

router = APIRouter(tags=["classes"])


def require_auth(request: Request):
    token = request.cookies.get("session_token")
    return validate_session(token)


class GradeCreate(BaseModel):
    name: str


class ClassCreate(BaseModel):
    grade_id: int
    name: str


@router.get("/api/grades")
async def get_grades(request: Request):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    grades = list_grades()
    return JSONResponse(content={"grades": grades})


@router.post("/api/grades")
async def add_grade(request: Request, data: GradeCreate):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    grade = create_grade(name=data.name)
    return JSONResponse(status_code=201, content={"grade": grade})


@router.get("/api/grades/{grade_id}")
async def get_grade_detail(request: Request, grade_id: int):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    grade = get_grade(grade_id)
    if grade is None:
        return JSONResponse(status_code=404, content={"message": "پایه یافت نشد."})
    return JSONResponse(content={"grade": grade})


@router.get("/api/classes")
async def get_classes(request: Request, grade_id: int | None = None):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    classes = list_classes(grade_id=grade_id)
    return JSONResponse(content={"classes": classes})


@router.post("/api/classes")
async def add_class(request: Request, data: ClassCreate):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    class_obj = create_class(grade_id=data.grade_id, name=data.name)
    return JSONResponse(status_code=201, content={"class": class_obj})


@router.get("/api/classes/{class_id}")
async def get_class_detail(request: Request, class_id: int):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    class_obj = get_class(class_id)
    if class_obj is None:
        return JSONResponse(status_code=404, content={"message": "کلاس یافت نشد."})
    return JSONResponse(content={"class": class_obj})


@router.delete("/api/classes/{class_id}")
async def remove_class(request: Request, class_id: int):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    success = delete_class(class_id)
    if not success:
        return JSONResponse(status_code=404, content={"message": "کلاس یافت نشد."})
    return JSONResponse(content={"message": "کلاس با موفقیت حذف شد."})


@router.get("/api/classes/{class_id}/students")
async def get_students_in_class(request: Request, class_id: int):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    students = get_class_students(class_id)
    return JSONResponse(content={"students": students})
