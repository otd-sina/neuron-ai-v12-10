import os
import diskcache

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "neuron_db")

_cache = None


def get_db() -> diskcache.Cache:
    global _cache
    if _cache is None:
        _cache = diskcache.Cache(DB_PATH)
    return _cache


def close_db():
    global _cache
    if _cache is not None:
        _cache.close()
        _cache = None
