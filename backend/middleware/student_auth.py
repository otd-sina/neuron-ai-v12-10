from fastapi import Request
from fastapi.responses import JSONResponse

from backend.modules.student_portal import get_student_by_id, validate_and_refresh_session


def _unauthorized_response(message: str) -> JSONResponse:
    return JSONResponse(status_code=401, content={"message": message})


def require_student_auth(request: Request) -> JSONResponse | None:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return _unauthorized_response("برای دسترسی به این بخش باید وارد شوید.")

    token = auth_header.replace("Bearer ", "", 1).strip()
    if not token:
        return _unauthorized_response("توکن ورود نامعتبر است.")

    session = validate_and_refresh_session(token)
    if not session:
        return _unauthorized_response("نشست شما منقضی شده است. لطفاً دوباره وارد شوید.")

    student_id = session.get("student_id")
    if not isinstance(student_id, int):
        return _unauthorized_response("توکن ورود نامعتبر است.")

    student = get_student_by_id(student_id)
    if not student:
        return _unauthorized_response("دانش‌آموز مرتبط با این نشست یافت نشد.")

    request.state.student_id = student_id
    request.state.student_token = token
    request.state.student_session = session
    request.state.student = student
    return None
