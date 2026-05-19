from datetime import datetime
from backend.db.helpers import db_set, db_get, db_delete, db_list_by_prefix, next_counter
from backend.modules.auth import hash_password


def _create_rate_limit(student_id: int) -> None:
    db_set(
        f"student:{student_id}:rate_limit",
        {
            "student_id": student_id,
            "daily_limit": 20,
            "used_today": 0,
            "last_reset": datetime.utcnow().date().isoformat(),
        },
    )


def create_student(
    full_name: str,
    national_id: str,
    phone: str,
    password: str,
    grade_id: int,
    class_id: int,
    school_name: str | None = None,
) -> dict:
    student_id = next_counter("student")
    student = {
        "id": student_id,
        "full_name": full_name,
        "national_id": national_id,
        "phone": phone,
        "password_hash": hash_password(password),
        "grade_id": grade_id,
        "class_id": class_id,
        "school_name": str(school_name or "").strip(),
        "created_at": datetime.utcnow().isoformat(),
    }
    db_set(f"student:{student_id}:info", student)
    _create_rate_limit(student_id)

    class_students: list = db_get(f"class:{class_id}:students", default=[])
    if student_id not in class_students:
        class_students.append(student_id)
    db_set(f"class:{class_id}:students", class_students)

    return student


def get_student(student_id: int) -> dict | None:
    return db_get(f"student:{student_id}:info")


def update_student(student_id: int, updates: dict) -> dict | None:
    student = get_student(student_id)
    if student is None:
        return None
    if "password" in updates:
        updates["password_hash"] = hash_password(updates.pop("password"))
    old_class_id = student.get("class_id")
    student.update(updates)
    db_set(f"student:{student_id}:info", student)

    new_class_id = student.get("class_id")
    if old_class_id != new_class_id:
        old_members: list = db_get(f"class:{old_class_id}:students", default=[])
        if student_id in old_members:
            old_members.remove(student_id)
        db_set(f"class:{old_class_id}:students", old_members)

        new_members: list = db_get(f"class:{new_class_id}:students", default=[])
        if student_id not in new_members:
            new_members.append(student_id)
        db_set(f"class:{new_class_id}:students", new_members)

    return student


def delete_student(student_id: int) -> bool:
    student = get_student(student_id)
    if student is None:
        return False
    class_id = student.get("class_id")
    db_delete(f"student:{student_id}:info")
    db_delete(f"student:{student_id}:rate_limit")

    members: list = db_get(f"class:{class_id}:students", default=[])
    if student_id in members:
        members.remove(student_id)
    db_set(f"class:{class_id}:students", members)

    return True


def list_students(grade_id: int | None = None, class_id: int | None = None) -> list:
    students = db_list_by_prefix("student:") 
    valid = []
    for item in students:
        if isinstance(item, dict) and "id" in item:
            if grade_id is not None and item.get("grade_id") != grade_id:
                continue
            if class_id is not None and item.get("class_id") != class_id:
                continue
            safe = {k: v for k, v in item.items() if k != "password_hash"}
            valid.append(safe)
    return sorted(valid, key=lambda s: s["id"])
