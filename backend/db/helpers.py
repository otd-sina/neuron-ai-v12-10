from .database import get_db


def next_counter(name: str) -> int:
    db = get_db()
    key = f"counter:{name}"
    with db.transact():
        current = db.get(key, default=0)
        next_val = current + 1
        db.set(key, next_val)
    return next_val


def db_set(key: str, value, expire: int | None = None) -> None:
    get_db().set(key, value, expire=expire)


def db_get(key: str, default=None):
    return get_db().get(key, default=default)


def db_delete(key: str) -> None:
    db = get_db()
    try:
        del db[key]
    except KeyError:
        pass


def db_exists(key: str) -> bool:
    return key in get_db()


def db_list_by_prefix(prefix: str) -> list:
    db = get_db()
    results = []
    for key in db:
        if isinstance(key, str) and key.startswith(prefix):
            results.append(db.get(key))
    return [item for item in results if item is not None]


def db_keys_by_prefix(prefix: str) -> list[str]:
    db = get_db()
    keys = []
    for key in db:
        if isinstance(key, str) and key.startswith(prefix):
            keys.append(key)
    return keys
