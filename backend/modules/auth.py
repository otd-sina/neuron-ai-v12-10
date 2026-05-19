import hashlib
import secrets
from datetime import datetime, timedelta
from backend.db.helpers import db_set, db_get, db_delete

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD_HASH = hashlib.sha256("admin1234".encode()).hexdigest()
SESSION_TTL_SECONDS = 3600 * 8


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def verify_admin(username: str, password: str) -> bool:
    return (
        username == ADMIN_USERNAME
        and hashlib.sha256(password.encode()).hexdigest() == ADMIN_PASSWORD_HASH
    )


def create_session(username: str) -> str:
    token = secrets.token_hex(32)
    expiry = (datetime.utcnow() + timedelta(seconds=SESSION_TTL_SECONDS)).isoformat()
    db_set(f"session:{token}", {"username": username, "expiry": expiry})
    return token


def validate_session(token: str) -> bool:
    if not token:
        return False
    session = db_get(f"session:{token}")
    if session is None:
        return False
    expiry = datetime.fromisoformat(session["expiry"])
    if datetime.utcnow() > expiry:
        db_delete(f"session:{token}")
        return False
    return True


def destroy_session(token: str) -> None:
    db_delete(f"session:{token}")
