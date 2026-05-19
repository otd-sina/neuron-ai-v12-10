from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from backend.modules.admin_analytics import (
    get_dashboard_stats,
    get_student_analytics,
    list_students_with_analytics,
)
from backend.modules.auth import validate_session

router = APIRouter(prefix="/api/admin", tags=["admin-analytics"])


def require_auth(request: Request) -> bool:
    token = request.cookies.get("session_token")
    return validate_session(token)


@router.get("/dashboard-stats")
async def dashboard_stats(request: Request):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    return JSONResponse(content=get_dashboard_stats())


@router.get("/students")
async def admin_students(request: Request):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    students = list_students_with_analytics()
    return JSONResponse(content={"students": students})


@router.get("/students/{student_id}/analytics")
async def admin_student_analytics(request: Request, student_id: int, source: str | None = None):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})

    analytics = get_student_analytics(student_id, source=source)
    if analytics is None:
        return JSONResponse(status_code=404, content={"message": "دانش‌آموز یافت نشد."})
    return JSONResponse(content=analytics)
