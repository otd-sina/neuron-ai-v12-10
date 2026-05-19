# Neuron AI — Developer Onboarding & Architecture Guide

This document is the technical onboarding map for **Neuron AI**. It explains how the platform is wired end-to-end so a new developer can ship features without reverse-reading the whole repository.

---

## 1. Project Overview & Business Logic

### What Neuron AI is

Neuron AI is an educational platform with two major surfaces:

- **Admin/Teacher panel** for school operations (students, classes, assignments, official school exams, analytics).
- **Student portal** for learning operations (AI tutor, AI practice exams, assignment support, exam analytics, official school exam participation).

The system combines:

- CRUD school management workflows.
- AI-powered personalized learning loops.
- Time-bound official exam workflows.
- Lightweight analytics over student exam history.

### Main actors and core flows

#### Actor A: Admin / Teacher

1. **Authentication**
   - Logs in at `/` (`frontend/pages/login.html`) via `/api/auth/login`.
   - Receives server cookie `session_token` (HTTP-only, 8h TTL).

2. **School setup**
   - Creates grades and classes.
   - Registers students and assigns each student to grade/class.

3. **Assignment publishing**
   - Creates assignments per class with duration (1–7 days).
   - Assignments are stored with TTL, auto-expiring from cache.

4. **Official school exam creation**
   - Creates time-bound exams (grade-wide or class-specific).
   - Defines `focus_area`, difficulty matrix, and schedule.
   - AI generates normalized MCQs; exam is persisted and indexed by grade/class.

5. **Analytics**
   - Views global analytics, at-risk students, weakness topics.
   - Opens per-student analytics split by source (`personal` vs `school` exams).

#### Actor B: Student

1. **Authentication**
   - Logs in with national ID + password at `/student/login`.
   - Receives token in response body, stored in browser `localStorage`.
   - Uses `Authorization: Bearer <token>` for portal APIs.

2. **Daily learning**
   - Opens dashboard (latest exams, active assignments, weak topics).
   - Selects a subject and bot mode (general tutor / exam generator / homework helper).

3. **Practice exams (AI-generated)**
   - Starts AI exam by subject + difficulty + question count.
   - Submits answers; system computes score, weak points, explanations.
   - Result is stored and appended to exam history.

4. **Official school exams**
   - Sees school exams targeted to own grade/class.
   - Can enter only during `live` window and only once.
   - Submission is hard-locked after exam end time.

5. **Performance feedback**
   - Sees analytics and weak topics generated from cumulative exam results.

---

## 2. Tech Stack & Technologies

## Backend

- **Python 3.x**
- **FastAPI** (`backend/app.py`)
- **Pydantic v2** for request payload models
- **DiskCache** for key-value persistence (`data/neuron_db`)
- **OpenAI Python SDK** (configured for `https://api.gapgpt.app/v1`) for AI tasks
- **Uvicorn** as ASGI runtime (`run.py`)

## Frontend

- **HTML5** pages/templates
- **Vanilla JavaScript** (no SPA framework)
- **CSS3** with modular styles in `frontend/static/css`
- **Fetch API** for all client-server communication
- **Browser localStorage** for student session and local caching

### Why DiskCache is used

DiskCache is used as a fast, file-backed K/V layer to avoid operational overhead of a full RDBMS while still supporting:

- Simple object persistence (dict/list payloads).
- TTL-based lifecycle for temporary data:
  - assignments,
  - student sessions,
  - AI-generated exam question sets.
- Low-friction counters (`counter:*`) for IDs.
- Easy iteration by key prefixes for analytics and lookups.

This architecture fits the project’s current scale: stateful, structured data with moderate consistency needs and heavy “object by key” access patterns.

### State management model

- **Server-side state**: DiskCache keys (source of truth for users, exams, assignments, sessions).
- **Client-side state**:
  - Admin: cookie-based session only.
  - Student: bearer token + cached dashboard/exam snapshots in `localStorage`.
- **No global in-memory app state** beyond singleton DB handle and cached OpenAI client.

---

## 3. System Architecture

### High-level request path

1. Browser loads static HTML from FastAPI routes (`backend/app.py`).
2. JS modules call JSON APIs (`/api/...`) via Fetch.
3. Route handlers validate auth + payload.
4. Business logic modules (`backend/modules/*`) process operations.
5. Persistence reads/writes go through DB helpers (`backend/db/helpers.py`).
6. For AI actions, service layer calls model API and normalizes output.

### Authentication & authorization flow

#### Admin flow

- Login endpoint: `/api/auth/login` (form post).
- Session token stored in cache key `session:{token}` with expiry metadata.
- Token sent as cookie `session_token`.
- Protected admin routes call `validate_session()` and reject with 401 otherwise.

#### Student flow

- Login endpoint: `/api/student/login` (JSON).
- Session token format: `<student_id>.<random>` stored at `student:{id}:sessions:{token}` with TTL.
- Protected student routes require `Authorization: Bearer ...`.
- `backend/middleware/student_auth.py` validates session, refreshes TTL, and injects:
  - `request.state.student_id`
  - `request.state.student`
  - `request.state.student_session`

### AI interaction layer

Primary file: `backend/services/ai_service.py`

Flow:

1. Build contextual system prompt (`generate_system_prompt`) using:
   - grade,
   - subject,
   - bot type,
   - past performance snapshot.
2. Call model via `call_openai_api(...)` with retry policy.
3. Normalize output:
   - plain response for general/homework tutor,
   - strict JSON extraction for exam generation (`extract_json_payload`).
4. Route-level validation parses/cleans generated question sets.
5. Persist generated exam/questions/result objects in DiskCache.

For official school exams, generation/validation is stricter in:
- `backend/modules/school_exams.py` (difficulty distribution enforcement, schema normalization).

---

## 4. Database Schema (DiskCache Structure)

DiskCache path: `data/neuron_db`  
Pattern style: `namespace:{id}:subkey`

### Core counters

```json
{
  "counter:grade": 3,
  "counter:class": 7,
  "counter:student": 120,
  "counter:assignment": 44,
  "counter:exam": 892,
  "counter:school_exam": 16
}
```

### Users schema (Admin + Student)

Admin identity is hardcoded in code (`backend/modules/auth.py`), while admin sessions are persisted:

```json
{
  "key": "session:<token>",
  "value": {
    "username": "admin",
    "expiry": "2026-05-14T18:00:00.000000"
  }
}
```

Student profile + auth/rate-limit state:

```json
{
  "student:<student_id>:info": {
    "id": 25,
    "full_name": "....",
    "national_id": "1234567890",
    "phone": "09xxxxxxxxx",
    "password_hash": "<sha256>",
    "grade_id": 10,
    "class_id": 3,
    "school_name": "....",
    "created_at": "2026-05-14T09:20:11.123456"
  },
  "student:<student_id>:sessions:<token>": {
    "student_id": 25,
    "token": "25.xxxxx",
    "created_at": "2026-05-14T09:30:00",
    "expires_at": "2026-05-21T09:30:00",
    "last_activity": "2026-05-14T10:01:22"
  },
  "student:<student_id>:rate_limit": {
    "student_id": 25,
    "daily_limit": 20,
    "used_today": 7,
    "last_reset": "2026-05-14"
  }
}
```

### Practice exams schema (personal AI exams)

```json
{
  "exam:<student_id>:<exam_id>:questions": {
    "exam_id": "901",
    "student_id": 25,
    "subject_id": "math",
    "subject": "ریاضی",
    "difficulty": "medium",
    "question_count": 10,
    "questions": [
      {
        "id": 1,
        "question": "...",
        "options": {"A": "...", "B": "...", "C": "...", "D": "..."},
        "correct_answer": "B",
        "explanation": "...",
        "topic": "..."
      }
    ],
    "created_at": "2026-05-14T10:05:00+00:00"
  }
}
```

Notes:
- `:questions` key TTL = 1 hour (`EXAM_QUESTIONS_TTL_SECONDS`).

### School exams schema (official exams created by admins)

```json
{
  "school_exam:<school_exam_id>:info": {
    "id": 16,
    "title": "آزمون میان‌ترم ریاضی",
    "subject": "ریاضی",
    "grade_id": 10,
    "class_id": 3,
    "start_time": "2026-05-15T08:00:00+00:00",
    "duration": 90,
    "difficulty_matrix": {"easy": 8, "medium": 8, "hard": 3, "gifted": 1},
    "focus_area": "فصل 1 تا 3",
    "question_count": 20,
    "created_at": "2026-05-14T11:00:00+00:00"
  },
  "school_exam:<school_exam_id>:questions": [
    {
      "id": 1,
      "question": "...",
      "options": ["...", "...", "...", "..."],
      "correct_answer_index": 2,
      "explanation": "...",
      "difficulty": "medium"
    }
  ],
  "grade:<grade_id>:school_exams": [16, 17],
  "class:<class_id>:school_exams": [16]
}
```

### Exam results schema (practice + school)

```json
{
  "exam:<student_id>:<exam_id>:result": {
    "exam_id": "901",
    "source": "personal",
    "subject": "ریاضی",
    "score": 7,
    "total": 10,
    "percentage": 70.0,
    "weak_points": ["کسرها", "معادلات"],
    "explanations": [],
    "created_at": "2026-05-14T10:12:00+00:00"
  },
  "exam:<student_id>:school-<school_exam_id>:result": {
    "exam_id": "school-16",
    "school_exam_id": 16,
    "source": "school",
    "exam_title": "آزمون میان‌ترم ریاضی",
    "subject": "ریاضی",
    "score": 15,
    "total": 20,
    "percentage": 75.0,
    "weak_points": ["فصل 2"],
    "explanations": [],
    "created_at": "2026-05-15T09:35:00+00:00"
  },
  "exam:<student_id>:history": [
    {"exam_id": "901", "source": "personal", "timestamp": "...", "subject": "ریاضی"},
    {"exam_id": "school-16", "school_exam_id": 16, "source": "school", "timestamp": "...", "subject": "ریاضی"}
  ]
}
```

### Analytics schema (derived, not persisted as dedicated table)

Analytics payloads are computed on-demand from `exam:*:result` keys:

```json
{
  "current_gpa": 2.94,
  "source_breakdown": {
    "personal": {"exam_count": 5, "average_percentage": 73.2, "average_gpa": 2.93},
    "school": {"exam_count": 2, "average_percentage": 78.0, "average_gpa": 3.12}
  },
  "weakness_breakdown": [
    {"topic": "کسرها", "count": 4},
    {"topic": "هندسه", "count": 3}
  ],
  "progress_data": [
    {"exam_id": "901", "date": "...", "subject": "ریاضی", "percentage": 70.0, "gpa": 2.8, "source": "personal"}
  ]
}
```

### Key relationships

- `student:{id}:info.class_id` -> `class:{class_id}:info`.
- `class:{id}:students` holds student IDs.
- `assignment:{id}:info.class_id` + `class:{id}:assignments` index assignments.
- `school_exam:{id}:info.grade_id/class_id` + grade/class exam index keys drive visibility.
- `exam:{student_id}:history` links student to both personal and school exam result records.
- School exam attempt IDs are namespaced as `school-<exam_id>` to coexist with numeric personal exam IDs.

---

## 5. File Structure & Relation Tags (Crucial)

Use these tags as “jump points” when implementing or debugging.

### [Feature: App Bootstrap & Route Registration]
- **Backend App Entry:** `backend/app.py`
- **Run Script:** `run.py`
- **Dependencies:** `requirements.txt`

### [Feature: Admin Authentication]
- **Backend Auth Logic:** `backend/modules/auth.py`
- **Backend Auth Routes:** `backend/routes/auth_routes.py`
- **Admin Shared Utilities (logout/check):** `frontend/static/js/common.js`
- **Admin Login UI:** `frontend/pages/login.html`

### [Feature: Student Authentication & Session Lifecycle]
- **Backend Student Auth Core:** `backend/modules/student_portal.py`
- **Auth Middleware:** `backend/middleware/student_auth.py`
- **Student Auth Routes:** `backend/routes/student_portal_routes.py` (`/login`, `/logout`, `/me`)
- **Student Login UI:** `frontend/student/login.html`
- **Student Login Logic:** `frontend/static/js/auth.js`

### [Feature: Grade/Class Management]
- **Backend Domain Logic:** `backend/modules/classes.py`
- **Backend API Routes:** `backend/routes/class_routes.py`
- **Admin UI:** `frontend/pages/classes.html` (inline JS)

### [Feature: Student Management]
- **Backend Domain Logic:** `backend/modules/students.py`
- **Backend API Routes:** `backend/routes/student_routes.py`
- **Admin UI:** `frontend/pages/students.html` (inline JS)

### [Feature: Assignment Management]
- **Backend Domain Logic:** `backend/modules/assignments.py`
- **Backend API Routes:** `backend/routes/assignment_routes.py`
- **Admin UI:** `frontend/pages/assignments.html` (inline JS)
- **Student Assignment View:** `frontend/student/assignments.html`
- **Student Assignment Logic:** `frontend/static/js/student_assignments.js`

### [Feature: AI General Tutor]
- **AI Service:** `backend/services/ai_service.py`
- **Student AI Route:** `backend/routes/student_portal_routes.py` (`/ai/general`)
- **Chat Frontend:** `frontend/static/js/student_chat.js`
- **Chat Template:** `frontend/templates/student_chat.html`

### [Feature: AI Practice Exam Generation & Submission]
- **AI Service + JSON extraction:** `backend/services/ai_service.py`
- **Exam Start/Submit Routes:** `backend/routes/student_portal_routes.py` (`/ai/exam/start`, `/ai/exam/submit`)
- **Legacy/Admin exam storage helpers:** `backend/modules/exams.py`
- **Chat Exam UX:** `frontend/static/js/student_chat.js`
- **Exam rendering styles:** `frontend/static/css/pages/student_flow.css`, `frontend/static/css/student.css`

### [Feature: Official School Exam Creation (Admin)]
- **Core School Exam Logic:** `backend/modules/school_exams.py`
- **Admin School Exam API:** `backend/routes/school_exam_routes.py`
- **Admin UI Page:** `frontend/pages/create-exam.html`
- **Admin UI Logic:** `frontend/static/js/admin_create_exam.js`

### [Feature: Student School Exam Participation (Live Window)]
- **Student School Exam APIs:** `backend/routes/student_portal_routes.py` (`/school-exams/{id}`, `/school-exams/{id}/submit`)
- **School Exam Status/Window Logic:** `backend/modules/school_exams.py`
- **Student Exams UI:** `frontend/student/exams.html`
- **Student Exams Logic (timer, lock, submit):** `frontend/static/js/student_exams.js`

### [Feature: Student Dashboard & Profile]
- **Dashboard payload builder:** `backend/modules/student_portal.py` (`build_dashboard_payload`)
- **Dashboard route:** `backend/routes/student_portal_routes.py` (`/dashboard`)
- **Dashboard UI + logic:** `frontend/student/dashboard.html`, `frontend/static/js/dashboard.js`
- **Profile route/UI/logic:** `backend/routes/student_portal_routes.py` (`/me`), `frontend/student/profile.html`, `frontend/static/js/student_profile.js`

### [Feature: Admin Analytics Dashboard]
- **Analytics domain logic:** `backend/modules/admin_analytics.py`
- **Analytics routes:** `backend/routes/admin_analytics_routes.py`
- **Admin Analytics UI:** `frontend/pages/dashboard.html`
- **Admin Analytics JS:** `frontend/static/js/admin_analytics_dashboard.js`

### [Feature: Student Analytics / Exam History]
- **Student analytics aggregation:** `backend/modules/student_portal.py` (`get_exam_analytics_payload`)
- **Student exams API:** `backend/routes/student_portal_routes.py` (`/exams`)
- **Student exam analytics UI:** `frontend/student/exams.html`
- **Student exam analytics JS:** `frontend/static/js/student_exams.js`

### [Feature: DiskCache Access Layer]
- **DB Connection:** `backend/db/database.py`
- **DB Utilities:** `backend/db/helpers.py`
- **Cache Storage Directory:** `data/neuron_db`

---

## 6. Development Workflow & Best Practices

### A) How to add a new feature (frontend-to-backend pipeline)

1. **Define contract first**
   - Add/extend request/response model in route file (Pydantic model + JSON shape).
2. **Implement domain logic in `backend/modules/*`**
   - Keep routes thin; move business rules into module functions.
3. **Persist with helper APIs**
   - Use `db_get/db_set/db_delete/next_counter`.
   - Define explicit key naming pattern.
4. **Expose endpoint in route file**
   - Add auth guard (`validate_session` or `require_student_auth`).
5. **Wire frontend page**
   - Add Fetch call + error handling + loading state.
   - Keep token/cookie behavior consistent with actor type.
6. **Backfill analytics/history links if feature emits results**
   - Append to `exam:{student_id}:history` when adding new exam-like entities.

### B) How to modify AI prompts or evaluation logic

#### Prompt tuning
- Global persona and bot-role prompts: `backend/services/ai_service.py`
  - `generate_system_prompt()`
- School exam-specific generation strictness: `backend/modules/school_exams.py`
  - `build_school_exam_system_prompt()`
  - `_build_school_exam_user_prompt()`

#### Output validation/evaluation logic
- Practice exam parsing: `backend/routes/student_portal_routes.py` (`_parse_exam_questions`)
- School exam parsing + difficulty validation: `backend/modules/school_exams.py` (`parse_school_exam_questions`)
- Score/weakness computation:
  - personal exams: `backend/routes/student_portal_routes.py` (`ai_exam_submit`)
  - school exams: `backend/routes/student_portal_routes.py` (`submit_school_exam`)

Best practice: Any prompt change should be paired with parser/validator review, especially for JSON schema assumptions.

### C) Cache management and clearing logic

#### Current automatic TTL cleanup
- `assignment:{id}:info` expires by `duration_days`.
- `student:{id}:sessions:{token}` expires (7 days, sliding refresh).
- `exam:{student_id}:{exam_id}:questions` expires after 1 hour.
- Exam results currently expire after 1 year.

#### Manual cleanup options (safe patterns)
- Remove a single key via helper `db_delete`.
- Remove index drift by reloading listings (some modules self-heal indexes, e.g., assignments).
- For local dev reset: stop server, clear `data/neuron_db/*`, restart.

#### Consistency guidance
- Whenever deleting an entity, also delete/update its index keys:
  - class memberships,
  - class/grade school exam index,
  - class assignment index,
  - exam history references when needed.

---

## Quick Start for New Developers

1. Read `backend/app.py` for route topology.
2. Read `backend/routes/student_portal_routes.py` for core student product behavior.
3. Read `backend/modules/school_exams.py` + `backend/services/ai_service.py` for AI-intensive exam flow.
4. Read `frontend/static/js/student_chat.js` and `frontend/static/js/student_exams.js` for student runtime UX.
5. Read `backend/modules/admin_analytics.py` + `frontend/static/js/admin_analytics_dashboard.js` for analytics pipeline.

### A complete project tree

  neuron-ai-v10/
  ├── .vscode/
  │   └── settings.json
  ├── backend/
  │   ├── app.py
  │   ├── __init__.py
  │   ├── db/
  │   │   ├── database.py
  │   │   ├── helpers.py
  │   │   └── __init__.py
  │   ├── middleware/
  │   │   ├── student_auth.py
  │   │   └── __init__.py
  │   ├── modules/
  │   │   ├── admin_analytics.py
  │   │   ├── assignments.py
  │   │   ├── auth.py
  │   │   ├── classes.py
  │   │   ├── exams.py
  │   │   ├── school_exams.py
  │   │   ├── students.py
  │   │   ├── student_portal.py
  │   │   └── __init__.py
  │   ├── routes/
  │   │   ├── admin_analytics_routes.py
  │   │   ├── assignment_routes.py
  │   │   ├── auth_routes.py
  │   │   ├── class_routes.py
  │   │   ├── exam_routes.py
  │   │   ├── school_exam_routes.py
  │   │   ├── student_portal_routes.py
  │   │   ├── student_routes.py
  │   │   └── __init__.py
  │   └── services/
  │       ├── ai_service.py
  │       └── __init__.py
  ├── data/
  │   └── neuron_db/
  │       └── cache.db
  ├── frontend/
  │   ├── assets/
  │   │   └── fonts/
  │   │       └── vazir-font-v16.1.0/
  │   │           ├── CHANGELOG.md
  │   │           ├── LICENSE
  │   │           └── README.md
  │   ├── pages/
  │   │   ├── assignments.html
  │   │   ├── classes.html
  │   │   ├── create-exam.html
  │   │   ├── dashboard.html
  │   │   ├── login.html
  │   │   └── students.html
  │   ├── static/
  │   │   ├── css/
  │   │   │   ├── animations/
  │   │   │   │   ├── effects.css
  │   │   │   │   ├── keyframes.css
  │   │   │   │   └── transitions.css
  │   │   │   ├── base/
  │   │   │   │   ├── base.css
  │   │   │   │   ├── fonts.css
  │   │   │   │   ├── reset.css
  │   │   │   │   ├── typography.css
  │   │   │   │   └── variables.css
  │   │   │   ├── components/
  │   │   │   │   ├── badge.css
  │   │   │   │   ├── button.css
  │   │   │   │   ├── card.css
  │   │   │   │   ├── input.css
  │   │   │   │   ├── navbar.css
  │   │   │   │   └── sidebar.css
  │   │   │   ├── layout/
  │   │   │   │   ├── container.css
  │   │   │   │   ├── grid.css
  │   │   │   │   └── spacing.css
  │   │   │   ├── pages/
  │   │   │   │   ├── about.css
  │   │   │   │   ├── admin_analytics.css
  │   │   │   │   ├── chat.css
  │   │   │   │   ├── dashboard.css
  │   │   │   │   ├── login.css
  │   │   │   │   ├── profile.css
  │   │   │   │   └── student_flow.css
  │   │   │   ├── utilities/
  │   │   │   │   ├── accessibility.css
  │   │   │   │   ├── colors.css
  │   │   │   │   ├── display.css
  │   │   │   │   └── responsive.css
  │   │   │   ├── main.css
  │   │   │   └── student.css
  │   │   └── js/
  │   │       ├── admin_analytics_dashboard.js
  │   │       ├── admin_create_exam.js
  │   │       ├── auth.js
  │   │       ├── common.js
  │   │       ├── dashboard.js
  │   │       ├── student_assignments.js
  │   │       ├── student_bots.js
  │   │       ├── student_chat.js
  │   │       ├── student_exams.js
  │   │       ├── student_navigation.js
  │   │       ├── student_profile.js
  │   │       └── student_subjects.js
  │   ├── student/
  │   │   ├── about.html
  │   │   ├── assignments.html
  │   │   ├── dashboard.html
  │   │   ├── exams.html
  │   │   ├── login.html
  │   │   └── profile.html
  │   └── templates/
  │       ├── student_bots.html
  │       ├── student_chat.html
  │       └── student_subjects.html
  ├── README.md
  ├── requirements.txt
  └── run.py

If you follow the relation tags above, you can usually implement a feature by touching only 2–4 files, not 40+.
### اجرا
```bash
python run.py
```

سپس:
- مدیر: `http://127.0.0.1:8000/`
- ورود دانش‌آموز: `http://127.0.0.1:8000/student/login`
