from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from backend.modules.assignments import (
    create_assignment,
    get_assignment,
    delete_assignment,
    list_assignments,
    get_class_assignments,
)
from backend.modules.auth import validate_session

router = APIRouter(prefix="/api/assignments", tags=["assignments"])


def require_auth(request: Request):
    token = request.cookies.get("session_token")
    return validate_session(token)


class AssignmentCreate(BaseModel):
    class_id: int
    title: str
    description: str
    duration_days: int


@router.get("")
async def get_assignments(request: Request, class_id: int | None = None):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    if class_id is not None:
        assignments = get_class_assignments(class_id)
    else:
        assignments = list_assignments()
    return JSONResponse(content={"assignments": assignments})


@router.post("")
async def add_assignment(request: Request, data: AssignmentCreate):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    if data.duration_days < 1 or data.duration_days > 7:
        return JSONResponse(status_code=422, content={"message": "مدت زمان تکلیف باید بین ۱ تا ۷ روز باشد."})
    assignment = create_assignment(
        class_id=data.class_id,
        title=data.title,
        description=data.description,
        duration_days=data.duration_days,
    )
    return JSONResponse(status_code=201, content={"assignment": assignment})


@router.get("/{assignment_id}")
async def get_assignment_detail(request: Request, assignment_id: int):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    assignment = get_assignment(assignment_id)
    if assignment is None:
        return JSONResponse(status_code=404, content={"message": "تکلیف یافت نشد."})
    return JSONResponse(content={"assignment": assignment})


@router.delete("/{assignment_id}")
async def remove_assignment(request: Request, assignment_id: int):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    success = delete_assignment(assignment_id)
    if not success:
        return JSONResponse(status_code=404, content={"message": "تکلیف یافت نشد."})
    return JSONResponse(content={"message": "تکلیف با موفقیت حذف شد."})
