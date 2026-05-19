import os
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from backend.routes.auth_routes import router as auth_router
from backend.routes.student_routes import router as student_router
from backend.routes.class_routes import router as class_router
from backend.routes.assignment_routes import router as assignment_router
from backend.routes.admin_analytics_routes import router as admin_analytics_router
from backend.routes.exam_routes import router as exam_router
from backend.routes.school_exam_routes import router as school_exam_router
from backend.routes.student_portal_routes import router as student_portal_router
from backend.routes.gradebook_routes import router as gradebook_router

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
STATIC_DIR = os.path.join(FRONTEND_DIR, "static")
ASSETS_DIR = os.path.join(FRONTEND_DIR, "assets")
PAGES_DIR = os.path.join(FRONTEND_DIR, "pages")
STUDENT_PAGES_DIR = os.path.join(FRONTEND_DIR, "student")
TEMPLATES_DIR = os.path.join(FRONTEND_DIR, "templates")

app = FastAPI(title="Neuron AI - Admin Panel", version="1.0.0")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

app.include_router(auth_router)
app.include_router(student_router)
app.include_router(class_router)
app.include_router(assignment_router)
app.include_router(admin_analytics_router)
app.include_router(exam_router)
app.include_router(school_exam_router)
app.include_router(student_portal_router)
app.include_router(gradebook_router)


@app.get("/", response_class=HTMLResponse)
async def root():
    with open(os.path.join(PAGES_DIR, "login.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/admin/dashboard", response_class=HTMLResponse)
async def dashboard():
    with open(os.path.join(PAGES_DIR, "dashboard.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/admin/students", response_class=HTMLResponse)
async def students_page():
    with open(os.path.join(PAGES_DIR, "students.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/admin/classes", response_class=HTMLResponse)
async def classes_page():
    with open(os.path.join(PAGES_DIR, "classes.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/admin/assignments", response_class=HTMLResponse)
async def assignments_page():
    with open(os.path.join(PAGES_DIR, "assignments.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/admin/create-exam", response_class=HTMLResponse)
async def create_exam_page():
    with open(os.path.join(PAGES_DIR, "create-exam.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/admin/gradebook", response_class=HTMLResponse)
async def gradebook_page():
    with open(os.path.join(PAGES_DIR, "gradebook.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/student")
async def student_root():
    return RedirectResponse(url="/student/login")


@app.get("/student/login", response_class=HTMLResponse)
async def student_login_page():
    with open(os.path.join(STUDENT_PAGES_DIR, "login.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/student/dashboard", response_class=HTMLResponse)
async def student_dashboard_page():
    with open(os.path.join(STUDENT_PAGES_DIR, "dashboard.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/student/assignments", response_class=HTMLResponse)
async def student_assignments_page():
    with open(os.path.join(STUDENT_PAGES_DIR, "assignments.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/student/exams", response_class=HTMLResponse)
async def student_exams_page():
    with open(os.path.join(STUDENT_PAGES_DIR, "exams.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())




@app.get("/student/gradebook", response_class=HTMLResponse)
async def student_gradebook_page():
    with open(os.path.join(STUDENT_PAGES_DIR, "gradebook.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/student/profile", response_class=HTMLResponse)
async def student_profile_page():
    with open(os.path.join(STUDENT_PAGES_DIR, "profile.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/student/about", response_class=HTMLResponse)
async def student_about_page():
    with open(os.path.join(STUDENT_PAGES_DIR, "about.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/student/about.html", response_class=HTMLResponse)
async def student_about_page_alias():
    with open(os.path.join(STUDENT_PAGES_DIR, "about.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/student/subjects", response_class=HTMLResponse)
async def student_subjects_page():
    with open(os.path.join(TEMPLATES_DIR, "student_subjects.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/student/bots", response_class=HTMLResponse)
async def student_bots_page():
    with open(os.path.join(TEMPLATES_DIR, "student_bots.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/student/chat", response_class=HTMLResponse)
async def student_chat_page():
    with open(os.path.join(TEMPLATES_DIR, "student_chat.html"), encoding="utf-8") as f:
        return HTMLResponse(content=f.read())
