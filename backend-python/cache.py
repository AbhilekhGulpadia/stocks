from functools import wraps
import time
import pandas as pd

# Simple in-memory cache with TTL
cache = {}

def cached(ttl_seconds=60):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            cache_key = f"{func.__name__}:{args}:{kwargs}"
            now = time.time()
            
            if cache_key in cache:
                result, timestamp = cache[cache_key]
                if now - timestamp < ttl_seconds:
                    return result
            
            result = func(*args, **kwargs)
            cache[cache_key] = (result, now)
            return result
            
        return wrapper
    return decorator

# Clean expired cache entries periodically
def clean_cache(max_age_seconds=300):
    now = time.time()
    expired = [k for k, (_, ts) in cache.items() if now - ts > max_age_seconds]
    for k in expired:
        del cache[k]