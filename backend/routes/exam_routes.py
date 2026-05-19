from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from backend.modules.exams import store_exam_result, list_exam_results
from backend.modules.auth import validate_session

router = APIRouter(prefix="/api/exams", tags=["exams"])


def require_auth(request: Request):
    token = request.cookies.get("session_token")
    return validate_session(token)


class ExamResultCreate(BaseModel):
    student_id: int
    grade_level: str
    subject: str
    score: float
    weakness_topic: str


@router.post("")
async def save_exam_result(request: Request, data: ExamResultCreate):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    result = store_exam_result(
        student_id=data.student_id,
        grade_level=data.grade_level,
        subject=data.subject,
        score=data.score,
        weakness_topic=data.weakness_topic,
    )
    return JSONResponse(status_code=201, content={"result": result})


@router.get("")
async def get_exam_results(request: Request, student_id: int | None = None):
    if not require_auth(request):
        return JSONResponse(status_code=401, content={"message": "احراز هویت لازم است."})
    results = list_exam_results(student_id=student_id)
    return JSONResponse(content={"results": results})
