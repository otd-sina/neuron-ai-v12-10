from datetime import datetime
from backend.db.helpers import db_set, db_get, db_delete, db_list_by_prefix, next_counter


def create_grade(name: str) -> dict:
    grade_id = next_counter("grade")
    grade = {
        "id": grade_id,
        "name": name,
        "created_at": datetime.utcnow().isoformat(),
    }
    db_set(f"grade:{grade_id}:info", grade)
    db_set(f"grade:{grade_id}:classes", [])
    return grade


def get_grade(grade_id: int) -> dict | None:
    return db_get(f"grade:{grade_id}:info")


def list_grades() -> list:
    grades = db_list_by_prefix("grade:")
    valid = [g for g in grades if isinstance(g, dict) and "id" in g]
    return sorted(valid, key=lambda g: g["id"])


def create_class(grade_id: int, name: str) -> dict:
    class_id = next_counter("class")
    class_obj = {
        "id": class_id,
        "grade_id": grade_id,
        "name": name,
        "created_at": datetime.utcnow().isoformat(),
    }
    db_set(f"class:{class_id}:info", class_obj)
    db_set(f"class:{class_id}:students", [])
    db_set(f"class:{class_id}:assignments", [])

    grade_classes: list = db_get(f"grade:{grade_id}:classes", default=[])
    if class_id not in grade_classes:
        grade_classes.append(class_id)
    db_set(f"grade:{grade_id}:classes", grade_classes)

    return class_obj


def get_class(class_id: int) -> dict | None:
    return db_get(f"class:{class_id}:info")


def list_classes(grade_id: int | None = None) -> list:
    classes = db_list_by_prefix("class:")
    valid = []
    for item in classes:
        if isinstance(item, dict) and "id" in item:
            if grade_id is not None and item.get("grade_id") != grade_id:
                continue
            valid.append(item)
    return sorted(valid, key=lambda c: c["id"])


def delete_class(class_id: int) -> bool:
    class_obj = get_class(class_id)
    if class_obj is None:
        return False
    grade_id = class_obj.get("grade_id")
    db_delete(f"class:{class_id}:info")
    db_delete(f"class:{class_id}:students")
    db_delete(f"class:{class_id}:assignments")

    grade_classes: list = db_get(f"grade:{grade_id}:classes", default=[])
    if class_id in grade_classes:
        grade_classes.remove(class_id)
    db_set(f"grade:{grade_id}:classes", grade_classes)

    return True


def get_class_students(class_id: int) -> list:
    from backend.modules.students import get_student
    student_ids: list = db_get(f"class:{class_id}:students", default=[])
    students = []
    for sid in student_ids:
        student = get_student(sid)
        if student:
            safe = {k: v for k, v in student.items() if k != "password_hash"}
            students.append(safe)
    return students
