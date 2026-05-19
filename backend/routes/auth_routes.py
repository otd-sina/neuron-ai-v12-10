from fastapi import APIRouter, Request, Response, Form
from fastapi.responses import JSONResponse, RedirectResponse
from backend.modules.auth import verify_admin, create_session, destroy_session, validate_session

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
async def login(
    response: Response,
    username: str = Form(...),
    password: str = Form(...),
):
    if not verify_admin(username, password):
        return JSONResponse(
            status_code=401,
            content={"success": False, "message": "نام کاربری یا رمز عبور اشتباه است."},
        )
    token = create_session(username)
    resp = JSONResponse(content={"success": True, "message": "ورود موفق"})
    resp.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        max_age=3600 * 8,
        samesite="lax",
    )
    return resp


@router.post("/logout")
async def logout(request: Request):
    token = request.cookies.get("session_token")
    if token:
        destroy_session(token)
    resp = JSONResponse(content={"success": True, "message": "خروج موفق"})
    resp.delete_cookie("session_token")
    return resp


@router.get("/check")
async def check_session(request: Request):
    token = request.cookies.get("session_token")
    if validate_session(token):
        return JSONResponse(content={"authenticated": True})
    return JSONResponse(status_code=401, content={"authenticated": False})
